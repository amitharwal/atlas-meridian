// Everything the map can be coloured by: World Bank indicators and UN speech
// topics. Each layer knows how to look up a country's value, how to format it
// and where its colour scale should start and stop.
import { loadJson, speakerLabel } from './data.js';
import { formatter } from './format.js';

// Indicator figures often lag a year or two behind. Rather than turning the map
// grey for the latest years, show the most recent figure up to this many years
// old (longer for surveys run every few years; see `carry` in build_indicators.py).
const CARRY_FORWARD_YEARS = 2;

// The picker's group for everything from the UN speeches.
export const UN_GROUP = 'At the UN';

// How each topic reads inside a sentence ("…spent 14% of their speech on climate").
const SHORT = {
  peace: 'peace and conflict',
  nuclear: 'nuclear weapons',
  terrorism: 'terrorism',
  human_rights: 'human rights',
  democracy: 'democracy',
  climate: 'climate',
  development: 'development',
  trade: 'trade',
  debt: 'debt',
  decolonisation: 'decolonisation',
  un_reform: 'UN reform',
  health: 'health',
  migration: 'migration',
  food_water: 'food and water',
  gender: 'gender equality',
  technology: 'technology',
};

const percentile = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];

// Colour stops must strictly increase, even where several percentiles are equal.
function increasing(stops) {
  return stops.map((s, i) => s + i * 1e-6);
}

// `speeches` is the speech data (speeches.json), or a function that loads it:
// the map only fetches it once a speech map or a country needs it. `years` is
// the span of the speeches, needed before they arrive.
export function makeLayers({ topics, speeches, indicators, years }) {
  const layers = {};
  let shares = {}; // iso3 -> year -> topic shares, once the speeches are in
  let loading = null;
  // Every speech map is worked out at once when the speeches arrive.
  const loadSpeeches = () =>
    (loading ??= Promise.resolve(typeof speeches === 'function' ? speeches() : speeches).then((data) => {
      shares = data.shares;
      for (const topic of topics) fillTopic(layers[topic.id]);
    }));

  function fillTopic(layer) {
    const values = [];
    const sums = {};
    for (const byYear of Object.values(shares)) {
      for (const [year, row] of Object.entries(byYear)) {
        values.push(row[layer.index] / 10);
        sums[year] ??= [0, 0];
        sums[year][0] += row[layer.index] / 10;
        sums[year][1] += 1;
      }
    }
    values.sort((a, b) => a - b);
    // Fixed across all years so sliding through time shows real change. The top
    // is the 95th percentile, so one unusual speech doesn't wash out the rest.
    const top = Math.max(1, percentile(values, 0.95));
    layer.stops = [0, 0.25, 0.5, 0.75, 1].map((f) => f * top);
    layer.world = Object.fromEntries(Object.entries(sums).map(([y, [sum, n]]) => [y, sum / n]));
    layer.ready = true;
  }

  topics.forEach((topic, i) => {
    layers[topic.id] = {
      kind: 'topic',
      id: topic.id,
      index: i,
      label: topic.label,
      group: UN_GROUP,
      short: SHORT[topic.id] ?? topic.label.toLowerCase(),
      format: (v) => `${v.toFixed(1)}%`,
      legendFormat: (v) => `${Math.round(v)}%`,
      worldLabel: 'World average',
      ready: false,
      load: loadSpeeches,
      value(iso, year) {
        const row = shares[iso]?.[year];
        return row ? { value: row[i] / 10, year } : null;
      },
    };
  });

  for (const indicator of indicators) {
    if (layers[indicator.id]) throw new Error(`Indicator id "${indicator.id}" clashes with a topic`);
    const layer = {
      kind: 'indicator',
      ...indicator,
      format: formatter(indicator),
      carry: indicator.carry ?? CARRY_FORWARD_YEARS,
      worldLabel: 'World median',
      ready: false,
      data: null,
      loading: null,
      load() {
        layer.loading ??= loadJson(`indicators/${indicator.id}.json`).then((file) => {
          const all = [];
          const byYear = {};
          for (const series of Object.values(file.values)) {
            for (const [year, v] of Object.entries(series)) {
              all.push(v);
              (byYear[year] ??= []).push(v);
            }
          }
          all.sort((a, b) => a - b);
          layer.stops = increasing([0.05, 0.25, 0.5, 0.75, 0.95].map((p) => percentile(all, p)));
          layer.world = Object.fromEntries(
            Object.entries(byYear).map(([y, vs]) => [y, percentile(vs.sort((a, b) => a - b), 0.5)]),
          );
          layer.data = file.values;
          layer.ready = true;
        });
        return layer.loading;
      },
      value(iso, year) {
        const series = layer.data?.[iso];
        if (!series) return null;
        for (let y = year; y >= year - layer.carry; y--) {
          if (series[y] !== undefined) return { value: series[y], year: y };
        }
        return null;
      },
      // The full series for charts, without carrying anything forward.
      series(iso) {
        return layer.data?.[iso] ?? {};
      },
    };
    layers[indicator.id] = layer;
  }

  layers.speaker = speakerLayer(years[1]);
  layers.mentions = mentionsLayer(loadSpeeches, (iso, year) => Boolean(shares[iso]?.[year]));
  return layers;
}

// Who talks about whom: each country shaded by how many times its speech
// named one chosen country (the "target"). Counts come from
// pipeline/build_mentions.py, one small file per target. `spoke(iso, year)`
// says whether a country gave a speech that year, once `loadSpeeches` is done.
function mentionsLayer(loadSpeeches, spoke) {
  const cache = {};
  const layer = {
    kind: 'mentions',
    id: 'mentions',
    group: UN_GROUP,
    label: 'Who talks about whom',
    target: null,
    stops: [0, 1, 3, 6, 10],
    legendLabels: ['0', '10+'],
    format: (v) => `${v} mention${v === 1 ? '' : 's'}`,
    worldLabel: 'Countries mentioning it',
    ready: false,
    data: null,
    world: {},
    // Switch to another target country; resolves once its counts are in.
    async setTarget(iso) {
      layer.target = iso;
      layer.ready = false;
      cache[iso] ??= loadJson(`mentions/${iso}.json`).catch(() => ({}));
      const [data] = await Promise.all([cache[iso], loadSpeeches()]);
      if (layer.target !== iso) return; // switched again while this loaded
      layer.data = data;
      layer.world = Object.fromEntries(Object.entries(data).map(([y, bySpeaker]) => [y, Object.keys(bySpeaker).length]));
      layer.ready = true;
    },
    load() {
      return layer.setTarget(layer.target);
    },
    // Every country that spoke that year gets a value (0 if it didn't mention the target).
    value(iso, year) {
      if (iso === layer.target || !spoke(iso, year)) return null;
      return { value: layer.data?.[year]?.[iso] ?? 0, year };
    },
    // How many countries mentioned the target in a year.
    mentioners(year) {
      return Object.keys(layer.data?.[year] ?? {}).length;
    },
  };
  return layer;
}

// How senior the person who gave the speech was. Ranks come from
// pipeline/build_speakers.py; titles are recorded consistently from 1994.
export const RANK_LABELS = ['Minister or diplomat', 'Foreign minister', 'Deputy leader', 'Head of state or government'];

function speakerLayer(lastYear) {
  const layer = {
    kind: 'speaker',
    id: 'speaker',
    group: UN_GROUP,
    label: 'Who gave the speech',
    years: [1994, lastYear],
    // Ranks 0–3 spread across the whole colour scale.
    stops: [0, 0.75, 1.5, 2.25, 3],
    legendLabels: ['Diplomat', 'Leader'],
    format: (v) => RANK_LABELS[v],
    worldLabel: 'Share given by leaders',
    ready: false,
    data: null,
    loading: null,
    load() {
      layer.loading ??= loadJson('speakers.json').then((data) => {
        // The world line: % of ranked speeches given by a head of state or government.
        const byYear = {};
        for (const years of Object.values(data)) {
          for (const [year, [, , rank]] of Object.entries(years)) {
            if (rank === null) continue;
            byYear[year] ??= [0, 0];
            byYear[year][0] += rank === 3;
            byYear[year][1] += 1;
          }
        }
        layer.world = Object.fromEntries(
          Object.entries(byYear).filter(([, [, n]]) => n >= 50).map(([y, [leaders, n]]) => [y, (100 * leaders) / n]),
        );
        layer.data = data;
        layer.ready = true;
      });
      return layer.loading;
    },
    value(iso, year) {
      const rank = layer.data?.[iso]?.[year]?.[2];
      return rank === null || rank === undefined ? null : { value: rank, year };
    },
    // "Prime Minister Frank Bainimarama", or just the name before titles were recorded.
    speaker(iso, year) {
      return speakerLabel(layer.data?.[iso]?.[year]);
    },
  };
  return layer;
}

// The speech topic and indicator that go together, whichever one is chosen.
// The speaker layer has no topic of its own, so the card keeps showing the
// last topic the reader chose (`fallbackTopic`).
export function pairOf(layers, layer, fallbackTopic = 'climate') {
  if (layer.kind === 'indicator') return { topic: layers[layer.pairs], indicator: layer };
  if (layer.kind === 'speaker' || layer.kind === 'mentions') return pairOf(layers, layers[fallbackTopic]);
  const indicator = Object.values(layers).find((l) => l.kind === 'indicator' && l.pairs === layer.id);
  return { topic: layer, indicator };
}

// Every speaker with a value for this year, highest first.
export function ranking(layer, year, codes) {
  const rows = [];
  for (const iso of codes) {
    const found = layer.value(iso, year);
    if (found) rows.push({ iso, ...found });
  }
  return rows.sort((a, b) => b.value - a.value);
}

// The years the map can show for a layer: its own span (statistics start in
// 1960 or later, speakers' titles in 1994) within the timeline's `[first, last]`.
export function yearRange(layer, [first, last]) {
  if (!layer.years) return [first, last];
  return [Math.max(first, layer.years[0]), Math.min(last, layer.years[1])];
}

// The year with the highest world figure, for "peak year" facts.
export function peakYear(layer) {
  let best = null;
  for (const [year, v] of Object.entries(layer.world ?? {})) {
    if (!best || v > best.value) best = { year: +year, value: v };
  }
  return best;
}
