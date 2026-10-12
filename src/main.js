import { AttributionControl, Map, NavigationControl, setWorkerUrl } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { centres, loadJson, makeNamer } from './data.js';
import { makeLayers, pairOf } from './layers.js';
import { renderPanel } from './panel.js';
import './style.css';

// MapLibre 6 needs to be told where its background worker lives when bundled by Vite.
setWorkerUrl(workerUrl);

// Colours live in style.css; the map reads them so there's one place to change them.
const css = getComputedStyle(document.documentElement);
const color = (name) => css.getPropertyValue(name).trim();
const RAMP = [0, 1, 2, 3, 4].map((i) => color(`--ramp-${i}`));

const [countries, speeches, topics, indicators] = await Promise.all([
  loadJson('countries.geojson'),
  loadJson('speeches.json'),
  loadJson('topics.json'),
  loadJson('indicators/index.json'),
]);
const layers = makeLayers({ topics, speeches, indicators });
const nameOf = makeNamer(countries);
const centreOf = centres(countries);
const continentOf = {
  ...Object.fromEntries(countries.features.map((f) => [f.properties.iso3, f.properties.continent])),
  // Speakers with no shape on today's map.
  CSK: 'Europe', DDR: 'Europe', YUG: 'Europe', YMD: 'Asia', EU: 'Europe',
};
const [FIRST_YEAR, LAST_YEAR] = speeches.years;

// What's on screen. Kept in the address bar so any view can be shared as a link.
// Climate is the opening view: it changes the most visibly over time.
const state = { layer: 'climate', year: LAST_YEAR, country: null };
const params = new URLSearchParams(location.hash.slice(1));
if (layers[params.get('layer')]) state.layer = params.get('layer');
if (+params.get('year') >= FIRST_YEAR && +params.get('year') <= LAST_YEAR) state.year = +params.get('year');
if (speeches.shares[params.get('country')] || centreOf[params.get('country')]) state.country = params.get('country');

function saveToUrl() {
  const p = new URLSearchParams({ layer: state.layer, year: state.year });
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
    // Painted properly once the map has loaded and the chosen layer's data is in.
    { id: 'country-fill', type: 'fill', source: 'countries', paint: { 'fill-color': color('--land') } },
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

// Countries with no data that year are grey; the rest shade along the ramp.
function fillColor(stops = layers[state.layer].stops) {
  return [
    'case',
    ['!', ['boolean', ['feature-state', 'has'], false]], color('--land'),
    ['interpolate', ['linear'], ['coalesce', ['feature-state', 'value'], 0], ...RAMP.flatMap((c, i) => [stops[i], c])],
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
  new AttributionControl({ compact: true, customAttribution: 'Speeches: UN General Debate Corpus · Data: World Bank (CC BY 4.0) · Borders: Natural Earth' }),
  'bottom-left',
);

function setState(id, featureState) {
  if (id !== null && centreOf[id]) map.setFeatureState({ source: 'countries', id }, featureState);
}

// ---- Colouring the map --------------------------------------------------

function paintYear() {
  const layer = layers[state.layer];
  for (const iso of Object.keys(centreOf)) {
    const found = layer.value(iso, state.year);
    setState(iso, found ? { has: true, value: found.value } : { has: false });
  }
}

const legendScale = document.getElementById('legend-scale');
const legendText = document.getElementById('legend-text');

function paintLayer() {
  const layer = layers[state.layer];
  map.setPaintProperty('country-fill', 'fill-color', fillColor());
  legendScale.replaceChildren(
    ...layer.stops.map((v, i) => {
      const span = document.createElement('span');
      span.textContent = (layer.legendFormat ?? layer.format)(v) + (i === layer.stops.length - 1 ? '+' : '');
      return span;
    }),
  );
  legendText.textContent =
    layer.kind === 'topic'
      ? "Share of each country's speech spent on this topic."
      : `${layer.label} (${layer.unit}). Source: ${layer.source}, via the World Bank.`;
  paintYear();
}

const mapReady = new Promise((resolve) => map.on('load', resolve));

mapReady.then(async () => {
  await layers[state.layer].load?.();
  paintLayer();
  if (state.country) selectCountry(state.country, { fly: true });
});

// ---- Layer picker -------------------------------------------------------

const layerSelect = document.getElementById('layer');
const group = (label, items) => {
  const optgroup = document.createElement('optgroup');
  optgroup.label = label;
  optgroup.append(...items.map((l) => new Option(l.label, l.id)));
  return optgroup;
};
layerSelect.append(group('What countries say', topics), group('What the numbers show', indicators));
layerSelect.value = state.layer;
layerSelect.addEventListener('change', () => setLayer(layerSelect.value));

async function setLayer(id) {
  state.layer = id;
  layerSelect.value = id;
  saveToUrl();
  await layers[id].load?.();
  await mapReady;
  if (state.layer !== id) return; // the reader picked something else while this loaded
  paintLayer();
  refreshPanel();
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
  if (layers[state.layer].ready) paintYear();
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
  const layer = layers[state.layer];
  const found = layer.value(iso, state.year);
  if (found) {
    const when = found.year === state.year ? '' : ` (${found.year})`;
    return `${name} · ${layer.label}: ${layer.format(found.value)}${when}`;
  }
  if (layer.kind === 'topic') return `${name} · ${speeches.shares[iso] ? `no speech in ${state.year}` : 'no speeches'}`;
  return `${name} · no figure for ${state.year}`;
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
  const focus = pairOf(layers, layers[state.layer]);
  if (focus.indicator && !focus.indicator.ready) focus.indicator.load().then(refreshPanel);
  renderPanel(panelBody, {
    iso: state.country,
    year: state.year,
    topics,
    speeches,
    detail: details[state.country],
    continent: continentOf[state.country],
    nameOf,
    focus,
    onLayer: setLayer,
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
