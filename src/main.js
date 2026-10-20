import { AttributionControl, Map, Marker, NavigationControl, setWorkerUrl } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { feature } from 'topojson-client';
import { drawSparkline } from './chart.js';
import { loadJson, makeNamer, shapeInfo, slugOf } from './data.js';
import { grouped } from './format.js';
import { makeLayers, pairOf, ranking, UN_GROUP, yearRange } from './layers.js';
import { fillNav } from './nav.js';
import { renderCard, renderRankings } from './panel.js';
import { makeCombobox } from './combobox.js';
import { makeSearch } from './search.js';
import './style.css';

fillNav('./');

// MapLibre 6 needs to be told where its background worker lives when bundled by Vite.
setWorkerUrl(workerUrl);

// Colours live in style.css; the map reads them so there's one place to change them.
const css = getComputedStyle(document.documentElement);
const color = (name) => css.getPropertyValue(name).trim();
let RAMP = [0, 1, 2, 3, 4].map((i) => color(`--ramp-${i}`));

// Moments marked on the timeline. Clicking one jumps to that year.
const EVENTS = [
  [1960, 'Year of Africa: 17 new members'],
  [1962, 'Cuban Missile Crisis'],
  [1973, 'Oil crisis'],
  [1989, 'Fall of the Berlin Wall'],
  [2001, '9/11 attacks'],
  [2008, 'Global financial crisis'],
  [2015, 'Paris Agreement and the SDGs'],
  [2020, 'COVID-19 pandemic'],
];

const loading = document.getElementById('loading');
let topology, topics, indicators;
try {
  [topology, topics, indicators] = await Promise.all([
    loadJson('countries.topo.json'),
    loadJson('topics.json'),
    loadJson('indicators/index.json'),
  ]);
} catch (error) {
  loading.textContent = "Couldn't load the data. Please check your connection and refresh the page.";
  loading.classList.add('is-error');
  throw error;
}
// The UN speeches are the biggest file, and the map opens on a statistic, so
// they're fetched once something needs them (a speech map, or a country's card)
// or once the map is up. Until then the years they span come from the page
// (filled in when the site is built), and no country has any speeches.
const slider = document.getElementById('year');
let speeches = { years: [+slider.min, +slider.max], shares: {} };
let speechesLoading = null;
const loadSpeeches = () => (speechesLoading ??= loadJson('speeches.json'));

// The shapes arrive packed as TopoJSON (much smaller); unpack them to GeoJSON.
const countries = feature(topology, topology.objects.countries);
const layers = makeLayers({ topics, speeches: loadSpeeches, indicators, years: speeches.years });
const nameOf = makeNamer(countries);
// Any code we have a name for: a place on the map, or a former UN member.
const isPlace = (iso) => Boolean(iso) && iso !== 'ATA' && nameOf(iso, 9999) !== iso;
const { centreOf, dots } = shapeInfo(countries);
const smallPlaces = new Set(dots.features.map((f) => f.properties.iso3));
const continentOf = {
  ...Object.fromEntries(countries.features.map((f) => [f.properties.iso3, f.properties.continent])),
  // Speakers with no shape on today's map.
  CSK: 'Europe', DDR: 'Europe', YUG: 'Europe', YMD: 'Asia', EU: 'Europe',
};
const [FIRST_YEAR, LAST_YEAR] = speeches.years;
const phone = matchMedia('(max-width: 640px)');

// What's on screen. Kept in the address bar so any view can be shared as a link.
// Life expectancy is the opening view: easy to read, and almost every country has it.
const DEFAULT_LAYER = 'life_exp';
const state = { layer: DEFAULT_LAYER, year: LAST_YEAR, country: null, details: false, lastTopic: 'climate' };
const params = new URLSearchParams(location.hash.slice(1));
if (layers[params.get('layer')]) state.layer = params.get('layer');
// "Who talks about whom" needs a country to be about.
if (state.layer === 'mentions') {
  const target = params.get('target');
  if (isPlace(target)) layers.mentions.target = target;
  else state.layer = DEFAULT_LAYER;
}
if (layers[state.layer].kind === 'topic') state.lastTopic = state.layer;
if (+params.get('year') >= FIRST_YEAR && +params.get('year') <= LAST_YEAR) state.year = +params.get('year');
// With no year in the link, open on the latest year the chosen measure has.
else if (layers[state.layer].years) state.year = Math.min(LAST_YEAR, layers[state.layer].years[1]);
if (isPlace(params.get('country'))) state.country = params.get('country');

function saveToUrl() {
  const p = new URLSearchParams({ layer: state.layer, year: state.year });
  if (state.layer === 'mentions') p.set('target', layers.mentions.target);
  if (state.country) p.set('country', state.country);
  history.replaceState(null, '', `#${p}`);
}

// ---- The map ------------------------------------------------------------

const has = ['boolean', ['feature-state', 'has'], false];
const selected = ['boolean', ['feature-state', 'selected'], false];
const hovered = ['boolean', ['feature-state', 'hover'], false];

// In "who talks about whom", the country being talked about is painted solid.
function rampColor(stops) {
  return [
    'case',
    ['boolean', ['feature-state', 'target'], false], color('--target'),
    ['interpolate', ['linear'], ['coalesce', ['feature-state', 'value'], 0], ...RAMP.flatMap((c, i) => [stops[i], c])],
  ];
}

// The name shown on the layer button. Speech topics say so, since "Climate
// change & environment" could otherwise be mistaken for a statistic.
function titleOf(layer) {
  if (layer.kind === 'mentions') return `Mentions of ${nameOf(layer.target, 9999)}`;
  if (layer.kind === 'topic') return `UN speeches: ${layer.label}`;
  return layer.label;
}

// The opening view: centred on Europe and Africa, close enough that the
// screen is never wider than one copy of the world (no Alaska twice), and
// tall enough to show from Cape Horn to Scandinavia between the controls.
const mercatorY = (lat) => (1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2;
const latitudeAt = (y) => (360 / Math.PI) * Math.atan(Math.exp(Math.PI * (1 - 2 * y))) - 90;

// The closest you can zoom out before the world starts repeating across the screen.
const noRepeatZoom = () => Math.log2((innerWidth * 1.05) / 512);

function homeView() {
  const [north, south] = [72, -50];
  const top = phone.matches ? 180 : 120; // below the menu bar and the top-left panel
  const bottom = phone.matches ? 80 : 90;
  const span = mercatorY(south) - mercatorY(north);
  const fitHeight = Math.log2((innerHeight - top - bottom) / (span * 512));
  const zoom = Math.max(fitHeight, noRepeatZoom());
  // Centre between the two latitudes, nudged for the uneven space above and below.
  const scale = 512 * 2 ** zoom;
  const middle = (mercatorY(north) + mercatorY(south)) / 2 + (bottom - top) / 2 / scale;
  return { center: [15, latitudeAt(middle)], zoom };
}

// Antarctica has no data and would be a huge empty band along the bottom.
const notAntarctica = ['!=', ['get', 'iso3'], 'ATA'];

// A self-contained map style: just our country shapes on a plain background.
// No third-party tile server, so nothing can break or rate-limit us.
const style = {
  version: 8,
  sources: {
    countries: { type: 'geojson', data: countries, promoteId: 'iso3' },
    dots: { type: 'geojson', data: dots, promoteId: 'iso3' },
  },
  layers: [
    { id: 'ocean', type: 'background', paint: { 'background-color': color('--ocean') } },
    // Countries with data are painted over the striped "no data" layer (added on load).
    {
      id: 'country-fill',
      type: 'fill',
      source: 'countries',
      filter: notAntarctica,
      paint: { 'fill-color': color('--land'), 'fill-opacity': ['case', has, 1, 0] },
    },
    { id: 'country-border', type: 'line', source: 'countries', filter: notAntarctica, paint: { 'line-color': color('--border'), 'line-width': 0.5 } },
    // The selected country gets a white edge under a dark outline, so it stands
    // out against both light and dark neighbours.
    {
      id: 'country-halo',
      type: 'line',
      source: 'countries',
      paint: { 'line-color': color('--halo'), 'line-width': 6, 'line-opacity': ['case', selected, 1, 0] },
    },
    {
      id: 'country-outline',
      type: 'line',
      source: 'countries',
      paint: {
        'line-color': color('--select'),
        'line-opacity': ['case', selected, 1, hovered, 0.6, 0],
        'line-width': ['case', selected, 2.2, 1.2],
      },
    },
    // Dots for places too small to see or click; only shown where there's data.
    {
      id: 'country-dots',
      type: 'circle',
      source: 'dots',
      paint: {
        'circle-color': color('--land'),
        'circle-opacity': ['case', has, 1, 0],
        'circle-stroke-opacity': ['case', has, 1, 0],
        // (Zoom has to be the outer rule, so "selected" is repeated at each step.)
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, ['case', selected, 7, 3], 4, ['case', selected, 8, 5], 7, ['case', selected, 9, 6]],
        'circle-stroke-color': ['case', selected, color('--select'), hovered, color('--select'), color('--border')],
        'circle-stroke-width': ['case', selected, 2.5, hovered, 1.5, 1],
      },
    },
  ],
};

const home = homeView();
const map = new Map({
  container: 'map',
  style,
  center: home.center,
  zoom: home.zoom,
  // Wrap around at the date line, so Pacific countries like Fiji can sit mid-screen.
  renderWorldCopies: true,
  attributionControl: false,
});
const homeZoom = home.zoom;
// Don't let people zoom out to where the world repeats; a phone may go a bit
// further out than its opening view to see more at once.
const updateMinZoom = () => map.setMinZoom(Math.max(noRepeatZoom(), homeZoom - 1));
updateMinZoom();
map.on('resize', updateMinZoom);
// Bottom left, so the country card on the right never covers them.
map.addControl(new NavigationControl({ showCompass: false }), 'bottom-left');
map.addControl(
  new AttributionControl({ compact: true, customAttribution: 'Data: World Bank (CC BY 4.0) · Speeches: UN General Debate Corpus · Borders: Natural Earth' }),
  'bottom-left',
);

// The part of the map not covered by floating panels, as padding for camera
// moves, so whatever we fly to lands where it can actually be seen.
function clearArea() {
  const box = (el) => (el && !el.hidden ? el.getBoundingClientRect() : null);
  const panel = box(document.querySelector('.control-group'));
  const cardBox = box(document.getElementById('card'));
  const bar = box(document.getElementById('timeline'));
  // On phones the card sits above the year bar and can grow once its quote
  // loads, so plan for its full height (45% of the screen, see style.css).
  const cardTop = phone.matches && cardBox ? Math.min(cardBox.top, (bar?.top ?? innerHeight) - 10 - innerHeight * 0.45) : null;
  const bottomEdge = Math.min(...[bar?.top, cardTop].filter((v) => v != null), innerHeight);
  const padding = { top: 16, bottom: innerHeight - bottomEdge + 12, left: 16, right: 16 };
  if (phone.matches) padding.top = (panel?.bottom ?? 0) + 12;
  else if (cardBox) padding.right = innerWidth - cardBox.left + 12;
  // Never squeeze the clear area to nothing on very small screens.
  padding.bottom = Math.min(padding.bottom, innerHeight - padding.top - 80);
  return padding;
}

function setState(id, featureState) {
  if (id === null || !centreOf[id]) return;
  map.setFeatureState({ source: 'countries', id }, featureState);
  if (smallPlaces.has(id)) map.setFeatureState({ source: 'dots', id }, featureState);
}

// Diagonal stripes for "no data", drawn once and handed to the map as an image.
function hatchImage() {
  const size = 6;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = color('--land');
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = color('--hatch');
  ctx.lineWidth = 1.5;
  for (const offset of [-size, 0, size]) {
    ctx.beginPath();
    ctx.moveTo(offset, size);
    ctx.lineTo(offset + size, 0);
    ctx.stroke();
  }
  return ctx.getImageData(0, 0, size, size);
}

// ---- Colouring the map --------------------------------------------------

function paintYear() {
  const layer = layers[state.layer];
  const target = layer.kind === 'mentions' ? layer.target : null;
  for (const iso of Object.keys(centreOf)) {
    const found = layer.value(iso, state.year);
    if (iso === target) setState(iso, { has: true, value: 0, target: true });
    else setState(iso, found ? { has: true, value: found.value, target: false } : { has: false, target: false });
  }
}

const legend = document.getElementById('legend');
const legendTicks = [...document.querySelectorAll('.legend-tick')];

// Short numbers for under the colour bar: no units like " yrs", and two
// significant figures, so three fit side by side.
const shortNumber = new Intl.NumberFormat('en', { notation: 'compact', maximumSignificantDigits: 2 });
function tickFormat(layer) {
  if (layer.kind === 'topic') return (v) => `${Math.round(v)}%`;
  if (layer.kind === 'mentions') return (v) => String(Math.round(v));
  // (An indicator's own `format` is replaced by its formatting function, so read it from the list.)
  const format = indicators.find((i) => i.id === layer.id)?.format;
  if (format === 'usd') return (v) => `${v < 0 ? '−' : ''}$${shortNumber.format(Math.abs(v))}`;
  if (format === 'pct') return (v) => `${shortNumber.format(v)}%`;
  return (v) => shortNumber.format(v);
}
const spark = document.getElementById('spark');

function paintLayer() {
  const layer = layers[state.layer];
  map.setPaintProperty('country-fill', 'fill-color', rampColor(layer.stops));
  map.setPaintProperty('country-dots', 'circle-color', rampColor(layer.stops));
  const format = layer.legendFormat ?? layer.format;
  const [low, high] = layer.legendLabels ?? [format(layer.stops[0]), `${format(layer.stops.at(-1))}+`];
  document.getElementById('legend-min').textContent = low;
  document.getElementById('legend-max').textContent = high;
  // The values at the three middle shades, under the colour bar. (Not for
  // "who gave the speech", whose shades are ranks, named at either end.)
  legendTicks.forEach((tick, i) => {
    tick.textContent = layer.kind === 'speaker' ? '' : tickFormat(layer)(layer.stops[i + 1]);
  });
  const legendTarget = document.getElementById('legend-target');
  legendTarget.hidden = layer.kind !== 'mentions';
  if (layer.kind === 'mentions') document.getElementById('legend-target-name').textContent = nameOf(layer.target, 9999);
  layerLabel.textContent = titleOf(layer);
  legend.title =
    layer.kind === 'mentions'
      ? `How many times each country's speech named ${nameOf(layer.target, 9999)} that year`
      : layer.kind === 'topic'
      ? "Share of each country's UN speech spent on this topic"
      : layer.kind === 'speaker'
        ? 'How senior the person who gave the speech was. Titles are recorded from 1994.'
        : `${layer.label} (${layer.unit}). Source: ${layer.source}, via the World Bank`;
  drawSparkline(spark, layer.world, speeches.years);
  showCoverage();
  paintYear();
  refreshRankings();
}

const mapReady = new Promise((resolve) => map.on('load', resolve));

// Follow the device's light/dark setting while the page is open: re-read the
// colours from style.css and repaint the map with them.
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', async () => {
  await mapReady;
  RAMP = [0, 1, 2, 3, 4].map((i) => color(`--ramp-${i}`));
  map.setPaintProperty('ocean', 'background-color', color('--ocean'));
  map.setPaintProperty('country-border', 'line-color', color('--border'));
  map.setPaintProperty('country-halo', 'line-color', color('--halo'));
  map.setPaintProperty('country-outline', 'line-color', color('--select'));
  map.setPaintProperty('country-dots', 'circle-stroke-color', [
    'case', selected, color('--select'), hovered, color('--select'), color('--border'),
  ]);
  map.updateImage('hatch', hatchImage());
  if (layers[state.layer].ready) paintLayer();
});

mapReady.then(async () => {
  // Start with the credits folded into the ⓘ button so they don't sit over the map.
  document.querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show');
  map.addImage('hatch', hatchImage());
  map.addLayer(
    {
      id: 'country-nodata',
      type: 'fill',
      source: 'countries',
      filter: notAntarctica,
      paint: { 'fill-pattern': 'hatch', 'fill-opacity': ['case', has, 0, 1] },
    },
    'country-fill',
  );
  await layers[state.layer].load?.();
  keepYearInRange(layers[state.layer]);
  paintLayer();
  loading.hidden = true;
  if (state.country) selectCountry(state.country);
  // Now the map is up, fetch the speeches in the background. (Loading one
  // speech map fills in all of them, which the card's UN line needs.)
  Promise.all([loadSpeeches(), layers[topics[0].id].load()])
    .then(([data]) => {
      speeches = data;
      find = makeSearch(searchCodes(), nameOf);
      if (state.country) {
        loadDetails(state.country);
        refreshCard();
      }
    })
    .catch(() => {}); // a speech map will say so if it's needed
});

// ---- Pop-overs: only one open at a time -----------------------------------

const picker = document.getElementById('picker');
const layerButton = document.getElementById('layer-button');
const rankings = document.getElementById('rankings');
const rankButton = document.getElementById('rank-button');
const card = document.getElementById('card');

function closePopovers(except) {
  if (except !== picker) {
    picker.hidden = true;
    layerButton.setAttribute('aria-expanded', 'false');
  }
  if (except !== rankings) {
    rankings.hidden = true;
    rankButton.setAttribute('aria-expanded', 'false');
  }
  if (except !== findResults) {
    findResults.hidden = true;
    findInput.setAttribute('aria-expanded', 'false');
  }
}

// ---- Find a country ---------------------------------------------------------

const findInput = document.getElementById('find');
const findResults = document.getElementById('find-results');
// Every place on the map, plus former UN members once the speeches are in.
const searchCodes = () => [...new Set([...Object.keys(centreOf), ...Object.keys(speeches.shares)])].filter((iso) => iso !== 'ATA');
let find = makeSearch(searchCodes(), nameOf);
makeCombobox({
  input: findInput,
  list: findResults,
  find: (query, limit) => find(query, limit),
  onOpen: () => closePopovers(findResults),
  onChoose: (iso) => {
    closePopovers();
    selectCountry(iso);
  },
});

// Clicking anywhere outside the open pop-over closes it.
document.addEventListener('pointerdown', (e) => {
  if (!e.target.closest('.hud, .popover')) closePopovers();
});

// ---- Picker ---------------------------------------------------------------

const layerList = document.getElementById('layer-list');
const search = document.getElementById('layer-search');
const layerLabel = document.getElementById('layer-label');

// "CO₂" should be found by typing "co2", and everyday words should work too.
const normaliseSearch = (text) =>
  text
    .normalize('NFKD') // turns the subscript ₂ into a plain 2
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
// Extra words people might search with. Indicators bring their own from the pipeline.
const KEYWORDS = {
  speaker: 'leader president prime minister speaker who spoke',
  mentions: 'mentions talks about countries names whom',
};
const keywordsOf = (layer) => layer.keywords ?? KEYWORDS[layer.id] ?? '';

// The picker's groups: the statistics first, then everything from the speeches.
const GROUPS = [
  ...grouped(indicators).map(([title, items]) => [title, items.map((i) => layers[i.id])]),
  [UN_GROUP, [...topics.map((t) => layers[t.id]), layers.speaker, layers.mentions]],
];
// The group chip that's switched on; null shows every group.
let pickedGroup = null;

const groupChips = document.getElementById('layer-groups');
function buildChips() {
  const chips = [null, ...GROUPS.map(([title]) => title)].map((title) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'group-chip';
    chip.textContent = title ?? 'All';
    chip.setAttribute('aria-pressed', String(title === pickedGroup));
    chip.addEventListener('click', () => {
      pickedGroup = title;
      buildChips();
      buildList();
      layerList.scrollTop = 0;
    });
    return chip;
  });
  groupChips.replaceChildren(...chips);
}

function buildList() {
  const q = normaliseSearch(search.value);
  // Searching looks through every group, whichever chip is on.
  groupChips.hidden = Boolean(q);
  const nodes = [];
  for (const [title, items] of GROUPS) {
    if (!q && pickedGroup && title !== pickedGroup) continue;
    const shown = items.filter((l) => !q || normaliseSearch(`${l.label} ${l.short ?? ''} ${l.group} ${keywordsOf(l)}`).includes(q));
    if (!shown.length) continue;
    const heading = document.createElement('div');
    heading.className = 'layer-group';
    heading.textContent = title === UN_GROUP ? 'At the UN · share of speech on…' : title;
    nodes.push(heading);
    for (const layer of shown) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'layer-item';
      button.setAttribute('aria-pressed', String(layer.id === state.layer));
      const label = document.createElement('span');
      label.textContent = layer.label;
      button.append(label);
      if (layer.kind === 'indicator') {
        const meta = document.createElement('span');
        meta.className = 'layer-meta';
        meta.textContent = layer.unit;
        button.append(meta);
      }
      button.addEventListener('click', () => {
        if (layer.kind === 'mentions') showMentions(state.country ?? layer.target ?? 'UKR');
        else setLayer(layer.id);
        closePopovers();
      });
      nodes.push(button);
    }
  }
  if (!nodes.length) {
    const empty = document.createElement('p');
    empty.className = 'layer-empty';
    empty.textContent = 'Nothing matches.';
    nodes.push(empty);
  }
  layerList.replaceChildren(...nodes);
}

search.addEventListener('input', buildList);

layerButton.addEventListener('click', () => {
  const open = picker.hidden;
  closePopovers(picker);
  picker.hidden = !open;
  layerButton.setAttribute('aria-expanded', String(open));
  if (open) {
    search.value = '';
    // Open on the group of whatever the map is showing now.
    pickedGroup = layers[state.layer].group;
    buildChips();
    buildList();
    const current = layerList.querySelector('[aria-pressed="true"]');
    if (current) layerList.scrollTop = current.offsetTop - layerList.clientHeight / 2;
    if (!phone.matches) search.focus();
  }
});

async function setLayer(id) {
  if (layers[id].kind === 'topic') state.lastTopic = id;
  state.layer = id;
  layerLabel.textContent = layers[id].kind === 'mentions' && !layers[id].target ? layers[id].label : titleOf(layers[id]);
  saveToUrl();
  await layers[id].load?.();
  await mapReady;
  if (state.layer !== id) return; // the reader picked something else while this loaded
  keepYearInRange(layers[id]);
  paintLayer();
  refreshCard();
}

// A measure that starts later (CO₂ from 1970, speakers' titles from 1994):
// rather than an empty or near-empty map, move to the nearest year it covers
// and say so.
function keepYearInRange(layer) {
  const [first, last] = yearRange(layer, [FIRST_YEAR, LAST_YEAR]);
  if (state.year >= first && state.year <= last) return;
  const year = state.year < first ? first : last;
  const message = `${titleOf(layer)}: figures ${state.year < first ? `start in ${first}` : `end in ${last}`}, so showing ${year}`;
  setYear(year);
  showToast(message);
}

layerLabel.textContent = titleOf(layers[state.layer]);

// Switch the map to "who mentions this country?".
function showMentions(iso) {
  layers.mentions.target = iso;
  if (state.layer === 'mentions') layers.mentions.ready = false;
  return setLayer('mentions');
}

// ---- Rankings ---------------------------------------------------------------

// The countries a map's rankings are drawn from.
const rankCodes = (layer) => (['topic', 'mentions'].includes(layer.kind) ? Object.keys(speeches.shares) : Object.keys(layer.data));

function refreshRankings() {
  const layer = layers[state.layer];
  if (rankings.hidden || !layer.ready) return;
  renderRankings(rankings, {
    layer,
    year: state.year,
    rows: ranking(layer, state.year, rankCodes(layer)).filter((row) => layer.kind !== 'mentions' || row.value > 0),
    title: layer.kind === 'mentions' ? `Named ${nameOf(layer.target, 9999)} most · ${state.year}` : null,
    fullUrl: layer.kind === 'indicator' || layer.kind === 'topic' ? `rankings/#layer=${layer.id}&year=${state.year}` : null,
    nameOf,
    onCountry: (iso) => {
      closePopovers();
      selectCountry(iso);
    },
  });
}

rankButton.addEventListener('click', () => {
  const open = rankings.hidden;
  closePopovers(rankings);
  if (open) closeCountry();
  rankings.hidden = !open;
  rankButton.setAttribute('aria-expanded', String(open));
  refreshRankings();
});

// ---- Year slider, events and play button ---------------------------------

const yearLabel = document.getElementById('year-label');
const eventsBox = document.getElementById('events');
document.getElementById('year-min').textContent = FIRST_YEAR;
document.getElementById('year-max').textContent = LAST_YEAR;
slider.addEventListener('input', () => setYear(+slider.value));

const position = (year) => `${((year - FIRST_YEAR) / (LAST_YEAR - FIRST_YEAR)) * 100}%`;

for (const [year, text] of EVENTS) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'event';
  button.style.left = position(year);
  button.setAttribute('aria-label', `${year}: ${text}`);
  const label = document.createElement('span');
  label.className = 'event-label';
  label.textContent = `${year} · ${text}`;
  button.append(label);
  button.addEventListener('click', () => {
    stopPlaying();
    setYear(year);
  });
  eventsBox.append(button);
}

// Years the chosen measure doesn't cover show as a dotted stretch of the
// track, and the slider won't stop on them.
function showCoverage() {
  const [first, last] = yearRange(layers[state.layer], [FIRST_YEAR, LAST_YEAR]);
  slider.style.setProperty('--from', first > FIRST_YEAR ? position(first - 0.5) : '0%');
  slider.style.setProperty('--to', last < LAST_YEAR ? position(last + 0.5) : '100%');
}

function showYear() {
  slider.value = state.year;
  slider.style.setProperty('--progress', position(state.year));
  yearLabel.textContent = state.year;
}

function setYear(year) {
  const [first, last] = yearRange(layers[state.layer], [FIRST_YEAR, LAST_YEAR]);
  state.year = Math.min(last, Math.max(first, year));
  showYear();
  if (state.country) label.textContent = nameOf(state.country, year);
  if (layers[state.layer].ready) paintYear();
  refreshCard();
  refreshRankings();
  saveToUrl();
}

showYear();

const playButton = document.getElementById('play');
let timer = null;

function stopPlaying() {
  clearInterval(timer);
  timer = null;
  playButton.classList.remove('is-playing');
  playButton.setAttribute('aria-label', 'Play through the years');
}

playButton.addEventListener('click', () => {
  if (timer) return stopPlaying();
  // From the start of the chosen measure's figures, not the start of the timeline.
  const [first, last] = yearRange(layers[state.layer], [FIRST_YEAR, LAST_YEAR]);
  if (state.year >= last) setYear(first);
  playButton.classList.add('is-playing');
  playButton.setAttribute('aria-label', 'Pause');
  timer = setInterval(() => {
    if (state.year >= yearRange(layers[state.layer], [FIRST_YEAR, LAST_YEAR])[1]) return stopPlaying();
    setYear(state.year + 1);
  }, 450);
});
slider.addEventListener('pointerdown', stopPlaying);

// ---- Hover and click ----------------------------------------------------

const tooltip = document.getElementById('tooltip');
let hoveredId = null;

// Dots sit on top of shapes, so they win when both are under the pointer.
function featureAt(point) {
  const [feature] = map.queryRenderedFeatures(point, { layers: ['country-dots', 'country-fill', 'country-nodata'] });
  return feature?.properties.iso3 ?? null;
}

// Where each country ranks on the map being shown, worked out once per map
// and year: iso3 -> rank, plus how many are ranked. Ties share a rank.
let rankCache = { key: null, ranks: null, count: 0 };
function rankOf(iso) {
  const layer = layers[state.layer];
  const key = `${layer.id}|${layer.target}|${state.year}`;
  if (rankCache.key !== key) {
    const rows = ranking(layer, state.year, rankCodes(layer));
    const ranks = new globalThis.Map(); // (plain `Map` here is MapLibre's map)
    rows.forEach((row, i) => ranks.set(row.iso, i > 0 && row.value === rows[i - 1].value ? ranks.get(rows[i - 1].iso) : i + 1));
    rankCache = { key, ranks, count: rows.length };
  }
  return { rank: rankCache.ranks.get(iso), count: rankCache.count };
}

const ordinal = (n) => {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' })[n % 10] ?? 'th';
  return `${n}${suffix}`;
};

function showTooltip(iso, x, y) {
  const layer = layers[state.layer];
  const found = layer.value(iso, state.year);
  const name = document.createElement('span');
  name.textContent = nameOf(iso, state.year);
  const value = document.createElement('b');
  value.textContent = found ? layer.format(found.value) + (found.year === state.year ? '' : ` (${found.year})`) : '—';
  if (layer.kind === 'mentions' && iso === layer.target) value.textContent = `named by ${layer.mentioners(state.year)} countries`;
  const parts = [name, value];
  // Its place among all countries: "12th of 190". Not for speakers, whose
  // values are ranks of seniority, nor for mentions, where most are tied at 0.
  if (found && layer.ready && (layer.kind === 'indicator' || layer.kind === 'topic')) {
    const { rank, count } = rankOf(iso);
    if (rank) parts.push(Object.assign(document.createElement('span'), { className: 'tooltip-rank', textContent: `${ordinal(rank)} of ${count}` }));
  }
  tooltip.replaceChildren(...parts);
  tooltip.style.transform = `translate(${x + 14}px, ${y + 14}px)`;
  tooltip.hidden = false;
}

map.on('mousemove', (e) => {
  const iso = map.getLayer('country-nodata') ? featureAt(e.point) : null;
  if (iso !== hoveredId) {
    setState(hoveredId, { hover: false });
    hoveredId = iso;
    setState(hoveredId, { hover: true });
  }
  map.getCanvas().style.cursor = iso ? 'pointer' : '';
  if (iso) showTooltip(iso, e.originalEvent.clientX, e.originalEvent.clientY);
  else tooltip.hidden = true;
});

map.getCanvas().addEventListener('mouseleave', () => {
  setState(hoveredId, { hover: false });
  hoveredId = null;
  tooltip.hidden = true;
});

// The label would otherwise hang in mid-air while the map moves under it.
map.on('movestart', () => {
  tooltip.hidden = true;
});

map.on('click', (e) => {
  closePopovers();
  const iso = featureAt(e.point);
  if (iso) selectCountry(iso);
  else if (state.country) closeCountry();
});

// ---- Country card -------------------------------------------------------

const details = {}; // iso3 -> loaded speech detail file, fetched the first time it's needed
const stats = {}; // iso3 -> every World Bank figure for that country (data/stats/), likewise
let worldMedians = null; // indicator id -> year -> the median country's figure

// A country's own figures for every indicator, for the key facts on its card.
function loadStats(iso) {
  if (iso in stats) return;
  stats[iso] = null;
  const median = (worldMedians ??= loadJson('indicators/world.json').catch(() => ({})));
  Promise.all([loadJson(`stats/${iso}.json`).catch(() => ({})), median]).then(([own, world]) => {
    stats[iso] = own;
    worldMedians = world;
    if (state.country === iso) refreshCard();
  });
}

// While a country is chosen, every other country fades back and a name label
// is pinned on the map, so it's obvious which one the card is about.
const label = document.createElement('div');
label.className = 'map-label';
const labelMarker = new Marker({ element: label, anchor: 'bottom', offset: [0, -10] });

function spotlight(iso) {
  const on = iso !== null;
  const isTarget = ['boolean', ['feature-state', 'target'], false];
  map.setPaintProperty('country-fill', 'fill-opacity', on ? ['case', selected, 1, isTarget, 1, has, 0.35, 0] : ['case', has, 1, 0]);
  // Stripes only under countries without data, so faded countries don't show them through.
  map.setPaintProperty('country-nodata', 'fill-opacity', ['case', has, 0, on ? 0.5 : 1]);
  map.setPaintProperty('country-dots', 'circle-opacity', on ? ['case', selected, 1, has, 0.35, 0] : ['case', has, 1, 0]);
  if (on && centreOf[iso]) {
    label.textContent = nameOf(iso, state.year);
    labelMarker.setLngLat(centreOf[iso]).addTo(map);
  } else {
    labelMarker.remove();
  }
}

function selectCountry(iso) {
  setState(state.country, { selected: false });
  state.country = iso;
  setState(iso, { selected: true });
  spotlight(iso);
  rankings.hidden = true;
  rankButton.setAttribute('aria-expanded', 'false');
  card.hidden = false;
  card.scrollTop = 0;
  refreshCard();
  saveToUrl();

  if (centreOf[iso]) {
    // Wait a frame so the card has its size, then fly to the country within
    // the part of the map the card and other panels leave visible.
    const zoom = Math.max(map.getZoom(), homeZoom + (smallPlaces.has(iso) ? 1.3 : 0.3));
    requestAnimationFrame(() => map.flyTo({ center: centreOf[iso], zoom, padding: clearArea(), speed: 0.8 }));
  }
  loadStats(iso);
  loadDetails(iso);
}

// A country's quotes and "speaks most like", the first time its card needs them.
function loadDetails(iso) {
  if (!speeches.shares[iso] || iso in details) return;
  details[iso] = null;
  loadJson(`countries/${iso}.json`)
    .catch(() => ({ years: {} }))
    .then((detail) => {
      details[iso] = detail;
      if (state.country === iso) refreshCard();
    });
}

function closeCountry() {
  setState(state.country, { selected: false });
  state.country = null;
  spotlight(null);
  card.hidden = true;
  saveToUrl();
}

function refreshCard() {
  const layer = layers[state.layer];
  if (!state.country || !layer.ready) return;
  const focus = pairOf(layers, layer, state.lastTopic);
  // The card names who gave the speech; that list loads the first time it's needed.
  if (layer.kind !== 'indicator' && !layers.speaker.ready) layers.speaker.load().then(refreshCard);
  renderCard(card, {
    iso: state.country,
    year: state.year,
    topics,
    speeches,
    detail: details[state.country],
    stats: stats[state.country],
    worldMedians: worldMedians instanceof Promise ? null : worldMedians,
    indicators: Object.fromEntries(indicators.map((i) => [i.id, layers[i.id]])),
    layer,
    continent: continentOf[state.country],
    nameOf,
    focus,
    showDetails: state.details,
    speaker: layers.speaker.speaker(state.country, state.year),
    mentions: layer.kind === 'mentions' && layer.ready
      ? {
          target: layer.target,
          targetName: nameOf(layer.target, 9999),
          count: layer.value(state.country, state.year)?.value ?? null,
          mentioners: layer.mentioners(state.year),
        }
      : null,
    onMentions: (iso) => showMentions(iso),
    profileUrl: `country/${slugOf(nameOf(state.country, 9999))}/`,
    compareUrl: `compare/#a=${state.country}`,
    onToggleDetails: () => {
      state.details = !state.details;
      refreshCard();
    },
    onLayer: setLayer,
    onYear: (year) => {
      stopPlaying();
      setYear(year);
    },
    onCountry: selectCountry,
    onClose: closeCountry,
  });
}

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || about.open) return;
  if (!picker.hidden || !rankings.hidden) closePopovers();
  else if (state.country) closeCountry();
});

// ---- "Copy link" ---------------------------------------------------------

const toast = document.getElementById('toast');
let toastTimer = null;
function showToast(text) {
  toast.textContent = text;
  toast.hidden = false;
  clearTimeout(toastTimer);
  // Long enough to read a sentence.
  toastTimer = setTimeout(() => (toast.hidden = true), Math.max(2000, text.length * 60));
}

document.getElementById('share-button').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(location.href);
    showToast('Link copied');
  } catch {
    // Some browsers block clipboard access; the address bar has the same link.
    showToast('Copy the link from the address bar');
  }
});

// ---- About dialog -------------------------------------------------------

const about = document.getElementById('about');
document.getElementById('about-open').addEventListener('click', () => about.showModal());
document.getElementById('about-close').addEventListener('click', () => about.close());
// Clicking the dimmed backdrop (outside the dialog box) closes it too.
about.addEventListener('click', (e) => {
  if (e.target === about) about.close();
});

// A different link opened in the same tab (pasted, or clicked elsewhere):
// start again from it. Our own address updates don't trigger this.
addEventListener('hashchange', () => location.reload());

// Handy for poking at the map from the browser console while developing.
if (import.meta.env.DEV) window.map = map;
