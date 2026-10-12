import { AttributionControl, Map, NavigationControl, setWorkerUrl } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { centres, loadJson, makeNamer } from './data.js';
import { renderPanel } from './panel.js';
import './style.css';

// MapLibre 6 needs to be told where its background worker lives when bundled by Vite.
setWorkerUrl(workerUrl);

// Colours live in style.css; the map reads them so there's one place to change them.
const css = getComputedStyle(document.documentElement);
const color = (name) => css.getPropertyValue(name).trim();
const RAMP = [0, 1, 2, 3, 4].map((i) => color(`--ramp-${i}`));

const [countries, speeches, topics] = await Promise.all([
  loadJson('countries.geojson'),
  loadJson('speeches.json'),
  loadJson('topics.json'),
]);
const nameOf = makeNamer(countries);
const centreOf = centres(countries);
const continentOf = {
  ...Object.fromEntries(countries.features.map((f) => [f.properties.iso3, f.properties.continent])),
  // Speakers with no shape on today's map.
  CSK: 'Europe', DDR: 'Europe', YUG: 'Europe', YMD: 'Asia', EU: 'Europe',
};
const [FIRST_YEAR, LAST_YEAR] = speeches.years;

// Each topic gets its own colour scale, fixed across all years so that sliding
// through time shows real change. The top of the scale is the 95th percentile
// of every country-year, so one unusual speech doesn't wash everything else out.
const scaleTop = {};
const worldAverage = {};
topics.forEach((t, i) => {
  const values = [];
  const sums = {};
  for (const byYear of Object.values(speeches.shares)) {
    for (const [year, shares] of Object.entries(byYear)) {
      values.push(shares[i]);
      sums[year] ??= [0, 0];
      sums[year][0] += shares[i];
      sums[year][1] += 1;
    }
  }
  values.sort((a, b) => a - b);
  scaleTop[t.id] = Math.max(10, values[Math.floor(values.length * 0.95)]);
  worldAverage[t.id] = Object.fromEntries(Object.entries(sums).map(([y, [sum, n]]) => [y, sum / n / 10]));
});

// What's on screen. Kept in the address bar so any view can be shared as a link.
// Climate is the opening view: it changes the most visibly over time.
const state = { topic: 'climate', year: LAST_YEAR, country: null };
const params = new URLSearchParams(location.hash.slice(1));
if (topics.some((t) => t.id === params.get('topic'))) state.topic = params.get('topic');
if (+params.get('year') >= FIRST_YEAR && +params.get('year') <= LAST_YEAR) state.year = +params.get('year');
if (speeches.shares[params.get('country')] || centreOf[params.get('country')]) state.country = params.get('country');

function saveToUrl() {
  const p = new URLSearchParams({ topic: state.topic, year: state.year });
  if (state.country) p.set('country', state.country);
  history.replaceState(null, '', `#${p}`);
}

// A self-contained map style: just ocean, our country shapes and a soft
// atmosphere. No third-party tile server, so nothing can break or rate-limit us.
const style = {
  version: 8,
  projection: { type: 'globe' },
  sky: {
    'sky-color': color('--space'),
    'horizon-color': color('--atmosphere'),
    'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 5, 1, 7, 0],
  },
  sources: {
    countries: { type: 'geojson', data: countries, promoteId: 'iso3' },
  },
  layers: [
    { id: 'ocean', type: 'background', paint: { 'background-color': color('--ocean') } },
    { id: 'country-fill', type: 'fill', source: 'countries', paint: { 'fill-color': fillColor() } },
    {
      id: 'country-border',
      type: 'line',
      source: 'countries',
      paint: { 'line-color': color('--border'), 'line-width': 0.6 },
    },
    {
      id: 'country-outline',
      type: 'line',
      source: 'countries',
      paint: {
        // White, not gold: gold is also the top of the colour scale and would vanish.
        'line-color': ['case', ['boolean', ['feature-state', 'selected'], false], '#ffffff', 'rgba(255,255,255,0.7)'],
        'line-width': [
          'case',
          ['boolean', ['feature-state', 'selected'], false], 2.5,
          ['boolean', ['feature-state', 'hover'], false], 1.4,
          0,
        ],
      },
    },
  ],
};

// Countries with no speech that year are grey; the rest shade along the ramp.
function fillColor() {
  const top = scaleTop[state.topic];
  const share = ['coalesce', ['feature-state', 'share'], -1];
  return [
    'case',
    ['<', share, 0], color('--land'),
    ['interpolate', ['linear'], share, ...RAMP.flatMap((c, i) => [(top * i) / (RAMP.length - 1), c])],
  ];
}

const map = new Map({
  container: 'map',
  style,
  center: [15, 25],
  zoom: 1.6,
  attributionControl: false,
});
// Controls sit bottom-left so the country panel (right side) never covers them.
map.addControl(new NavigationControl({ visualizePitch: true }), 'bottom-left');
map.addControl(
  new AttributionControl({ compact: true, customAttribution: 'Speeches: UN General Debate Corpus · Borders: Natural Earth' }),
  'bottom-left',
);

function setState(id, featureState) {
  if (id !== null && centreOf[id]) map.setFeatureState({ source: 'countries', id }, featureState);
}

// ---- Colouring the map --------------------------------------------------

function paintYear() {
  const index = topics.findIndex((t) => t.id === state.topic);
  for (const [iso, byYear] of Object.entries(speeches.shares)) {
    const shares = byYear[state.year];
    setState(iso, { share: shares ? shares[index] : -1 });
  }
}

function paintTopic() {
  map.setPaintProperty('country-fill', 'fill-color', fillColor());
  document.getElementById('legend-max').textContent = `${Math.round(scaleTop[state.topic] / 10)}%+`;
  paintYear();
}

map.on('load', () => {
  paintTopic();
  if (state.country) selectCountry(state.country, { fly: true });
});

// ---- Topic picker -------------------------------------------------------

const topicSelect = document.getElementById('topic');
topicSelect.append(...topics.map((t) => new Option(t.label, t.id)));
topicSelect.value = state.topic;
topicSelect.addEventListener('change', () => setTopic(topicSelect.value));

function setTopic(id) {
  state.topic = id;
  topicSelect.value = id;
  paintTopic();
  refreshPanel();
  saveToUrl();
}

// ---- Year slider and play button ----------------------------------------

const slider = document.getElementById('year');
const yearLabel = document.getElementById('year-label');
slider.min = FIRST_YEAR;
slider.max = LAST_YEAR;
slider.value = state.year;
yearLabel.textContent = state.year;
document.getElementById('year-min').textContent = FIRST_YEAR;
document.getElementById('year-max').textContent = LAST_YEAR;
slider.addEventListener('input', () => setYear(+slider.value));

function setYear(year) {
  state.year = year;
  slider.value = year;
  yearLabel.textContent = year;
  paintYear();
  refreshPanel();
  saveToUrl();
}

const playButton = document.getElementById('play');
let timer = null;

function stopPlaying() {
  clearInterval(timer);
  timer = null;
  playButton.textContent = '▶';
  playButton.setAttribute('aria-label', 'Play through the years');
}

playButton.addEventListener('click', () => {
  if (timer) return stopPlaying();
  if (state.year === LAST_YEAR) setYear(FIRST_YEAR);
  playButton.textContent = '❚❚';
  playButton.setAttribute('aria-label', 'Pause');
  timer = setInterval(() => {
    if (state.year >= LAST_YEAR) return stopPlaying();
    setYear(state.year + 1);
  }, 450);
});
slider.addEventListener('pointerdown', stopPlaying);

// ---- Hover tooltip ------------------------------------------------------

const tooltip = document.getElementById('tooltip');
let hoveredId = null;

function tooltipText(iso) {
  const name = nameOf(iso, state.year);
  const shares = speeches.shares[iso]?.[state.year];
  if (!speeches.shares[iso]) return `${name} · no speeches`;
  if (!shares) return `${name} · no speech in ${state.year}`;
  const index = topics.findIndex((t) => t.id === state.topic);
  return `${name} · ${topics[index].label}: ${(shares[index] / 10).toFixed(1)}%`;
}

map.on('mousemove', 'country-fill', (e) => {
  const feature = e.features[0];
  if (feature.id !== hoveredId) {
    setState(hoveredId, { hover: false });
    hoveredId = feature.id;
    setState(hoveredId, { hover: true });
  }
  map.getCanvas().style.cursor = 'pointer';
  tooltip.textContent = tooltipText(feature.id);
  tooltip.style.transform = `translate(${e.point.x + 14}px, ${e.point.y + 14}px)`;
  tooltip.hidden = false;
});

map.on('mouseleave', 'country-fill', () => {
  setState(hoveredId, { hover: false });
  hoveredId = null;
  map.getCanvas().style.cursor = '';
  tooltip.hidden = true;
});

// The label would otherwise hang in mid-air while the globe spins away under it.
map.on('movestart', () => {
  tooltip.hidden = true;
});

// ---- Country panel ------------------------------------------------------

const panel = document.getElementById('panel');
const panelBody = document.getElementById('panel-body');
const details = {}; // iso3 -> loaded detail file, fetched the first time it's needed

map.on('click', 'country-fill', (e) => selectCountry(e.features[0].id, { fly: true }));

function selectCountry(iso, { fly }) {
  setState(state.country, { selected: false });
  state.country = iso;
  setState(iso, { selected: true });
  panel.hidden = false;
  panel.scrollTop = 0;
  refreshPanel();
  saveToUrl();

  if (fly && centreOf[iso]) {
    map.flyTo({ center: centreOf[iso], zoom: Math.max(map.getZoom(), 2.5), speed: 0.8 });
  }
  if (speeches.shares[iso] && !(iso in details)) {
    details[iso] = null;
    loadJson(`countries/${iso}.json`)
      .catch(() => ({ years: {} }))
      .then((detail) => {
        details[iso] = detail;
        if (state.country === iso) refreshPanel();
      });
  }
}

function refreshPanel() {
  if (!state.country) return;
  renderPanel(panelBody, {
    iso: state.country,
    year: state.year,
    topic: state.topic,
    topics,
    speeches,
    detail: details[state.country],
    continent: continentOf[state.country],
    nameOf,
    worldSeries: worldAverage[state.topic],
    onTopic: setTopic,
    onYear: setYear,
    onCountry: (iso) => selectCountry(iso, { fly: true }),
  });
}

function closePanel() {
  setState(state.country, { selected: false });
  state.country = null;
  panel.hidden = true;
  saveToUrl();
}

document.getElementById('panel-close').addEventListener('click', closePanel);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !about.open) closePanel();
});

// ---- About dialog -------------------------------------------------------

const about = document.getElementById('about');
document.getElementById('about-open').addEventListener('click', () => about.showModal());
document.getElementById('about-close').addEventListener('click', () => about.close());
// Clicking the dimmed backdrop (outside the dialog box) closes it too.
about.addEventListener('click', (e) => {
  if (e.target === about) about.close();
});

// Handy for poking at the map from the browser console while developing.
if (import.meta.env.DEV) window.map = map;
