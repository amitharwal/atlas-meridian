import { AttributionControl, Map, NavigationControl, setWorkerUrl } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { drawSparkline } from './chart.js';
import { loadJson, makeNamer, shapeInfo } from './data.js';
import { makeLayers, pairOf, ranking } from './layers.js';
import { renderCountry, renderWorld } from './panel.js';
import './style.css';

// MapLibre 6 needs to be told where its background worker lives when bundled by Vite.
setWorkerUrl(workerUrl);

// Colours live in style.css; the map reads them so there's one place to change them.
const css = getComputedStyle(document.documentElement);
const color = (name) => css.getPropertyValue(name).trim();
const RAMP = [0, 1, 2, 3, 4].map((i) => color(`--ramp-${i}`));

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

const [countries, speeches, topics, indicators] = await Promise.all([
  loadJson('countries.geojson'),
  loadJson('speeches.json'),
  loadJson('topics.json'),
  loadJson('indicators/index.json'),
]);
const layers = makeLayers({ topics, speeches, indicators });
const nameOf = makeNamer(countries);
const { centreOf, dots } = shapeInfo(countries);
const smallPlaces = new Set(dots.features.map((f) => f.properties.iso3));
const continentOf = {
  ...Object.fromEntries(countries.features.map((f) => [f.properties.iso3, f.properties.continent])),
  // Speakers with no shape on today's map.
  CSK: 'Europe', DDR: 'Europe', YUG: 'Europe', YMD: 'Asia', EU: 'Europe',
};
const [FIRST_YEAR, LAST_YEAR] = speeches.years;
const phone = matchMedia('(max-width: 720px)');
const overlayPicker = matchMedia('(max-width: 1180px)');

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

// ---- The map ------------------------------------------------------------

const has = ['boolean', ['feature-state', 'has'], false];
const selected = ['boolean', ['feature-state', 'selected'], false];
const hovered = ['boolean', ['feature-state', 'hover'], false];

function rampColor(stops) {
  return ['interpolate', ['linear'], ['coalesce', ['feature-state', 'value'], 0], ...RAMP.flatMap((c, i) => [stops[i], c])];
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
    dots: { type: 'geojson', data: dots, promoteId: 'iso3' },
  },
  layers: [
    { id: 'ocean', type: 'background', paint: { 'background-color': color('--ocean') } },
    // Countries with data are painted over the striped "no data" layer (added on load).
    {
      id: 'country-fill',
      type: 'fill',
      source: 'countries',
      paint: { 'fill-color': color('--land'), 'fill-opacity': ['case', has, 1, 0] },
    },
    { id: 'country-border', type: 'line', source: 'countries', paint: { 'line-color': color('--border'), 'line-width': 0.6 } },
    {
      id: 'country-outline',
      type: 'line',
      source: 'countries',
      paint: {
        // White, not gold: gold is also the top of the colour scale and would vanish.
        'line-color': ['case', selected, '#ffffff', 'rgba(255,255,255,0.7)'],
        'line-width': ['case', selected, 2.5, hovered, 1.4, 0],
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
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, 3.5, 4, 5.5, 7, 7],
        'circle-stroke-color': ['case', selected, '#ffffff', hovered, '#ffffff', color('--bg')],
        'circle-stroke-width': ['case', selected, 2.5, hovered, 2, 1],
      },
    },
  ],
};

const map = new Map({
  container: 'map',
  style,
  center: [15, 20],
  zoom: phone.matches ? 1.1 : 1.85,
  attributionControl: false,
});
map.addControl(new NavigationControl({ visualizePitch: true }), 'bottom-left');
map.addControl(
  new AttributionControl({ compact: true, customAttribution: 'Speeches: UN General Debate Corpus · Data: World Bank (CC BY 4.0) · Borders: Natural Earth' }),
  'bottom-left',
);

function setState(id, featureState) {
  if (id === null || !centreOf[id]) return;
  map.setFeatureState({ source: 'countries', id }, featureState);
  if (smallPlaces.has(id)) map.setFeatureState({ source: 'dots', id }, featureState);
}

// Diagonal stripes for "no data", drawn once and handed to the map as an image.
function hatchImage() {
  const size = 8;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = color('--land');
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = color('--hatch');
  ctx.lineWidth = 2.5;
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
  for (const iso of Object.keys(centreOf)) {
    const found = layer.value(iso, state.year);
    setState(iso, found ? { has: true, value: found.value } : { has: false });
  }
}

const legendScale = document.getElementById('legend-scale');
const legendText = document.getElementById('legend-text');
const legendNone = document.getElementById('legend-none-text');
const spark = document.getElementById('spark');
const trackNote = document.getElementById('track-note');

function paintLayer() {
  const layer = layers[state.layer];
  map.setPaintProperty('country-fill', 'fill-color', rampColor(layer.stops));
  map.setPaintProperty('country-dots', 'circle-color', rampColor(layer.stops));
  legendScale.replaceChildren(
    ...layer.stops.map((v, i) => {
      const span = document.createElement('span');
      span.textContent = (layer.legendFormat ?? layer.format)(v) + (i === layer.stops.length - 1 ? '+' : '');
      return span;
    }),
  );
  if (layer.kind === 'topic') {
    legendText.textContent = "Share of each country's speech spent on this topic.";
    legendNone.textContent = 'No speech that year';
    trackNote.textContent = 'World average for this topic · dots mark key moments';
  } else {
    legendText.textContent = `${layer.label} (${layer.unit}). Source: ${layer.source}, via the World Bank.`;
    legendNone.textContent = 'No figure that year';
    trackNote.textContent = 'World median · dots mark key moments';
  }
  drawSparkline(spark, layer.world, speeches.years);
  paintYear();
}

const mapReady = new Promise((resolve) => map.on('load', resolve));

mapReady.then(async () => {
  // Start with the credits folded into the ⓘ button so they don't sit over the globe.
  document.querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show');
  map.addImage('hatch', hatchImage());
  map.addLayer({ id: 'country-nodata', type: 'fill', source: 'countries', paint: { 'fill-pattern': 'hatch' } }, 'country-fill');
  await layers[state.layer].load?.();
  paintLayer();
  if (state.country) selectCountry(state.country);
  else refreshPanel();
});

// ---- Picker ---------------------------------------------------------------

const rail = document.getElementById('rail');
const railOpen = document.getElementById('rail-open');
const layerList = document.getElementById('layer-list');
const search = document.getElementById('layer-search');
const chipLabel = document.getElementById('layer-chip-label');

function buildList() {
  const q = search.value.trim().toLowerCase();
  const groups = [
    ['What countries say', topics.map((t) => layers[t.id])],
    ['What the numbers show', indicators.map((i) => layers[i.id])],
  ];
  const nodes = [];
  for (const [title, items] of groups) {
    const shown = items.filter((l) => !q || l.label.toLowerCase().includes(q));
    if (!shown.length) continue;
    const heading = document.createElement('div');
    heading.className = 'layer-group';
    heading.textContent = title;
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
        meta.textContent = layer.unit.replace('national ', '');
        button.append(meta);
      }
      button.addEventListener('click', () => {
        setLayer(layer.id);
        closeRail();
      });
      nodes.push(button);
    }
  }
  if (!nodes.length) {
    const empty = document.createElement('p');
    empty.className = 'layer-empty';
    empty.textContent = 'Nothing matches that search.';
    nodes.push(empty);
  }
  layerList.replaceChildren(...nodes);
  // Wait a frame so the list has its final size before scrolling the choice into view.
  requestAnimationFrame(() => {
    const current = layerList.querySelector('[aria-pressed="true"]');
    if (current) layerList.scrollTop = current.offsetTop - layerList.clientHeight / 2;
  });
}

search.addEventListener('input', buildList);

function openRail() {
  rail.classList.add('is-open');
  railOpen.setAttribute('aria-expanded', 'true');
  search.focus();
}

function closeRail() {
  if (!overlayPicker.matches) return;
  rail.classList.remove('is-open');
  railOpen.setAttribute('aria-expanded', 'false');
}

railOpen.addEventListener('click', openRail);
document.getElementById('rail-close').addEventListener('click', closeRail);

async function setLayer(id) {
  state.layer = id;
  chipLabel.textContent = layers[id].label;
  buildList();
  saveToUrl();
  await layers[id].load?.();
  await mapReady;
  if (state.layer !== id) return; // the reader picked something else while this loaded
  paintLayer();
  refreshPanel();
}

chipLabel.textContent = layers[state.layer].label;
buildList();

// ---- Year slider, events and play button ---------------------------------

const slider = document.getElementById('year');
const yearLabel = document.getElementById('year-label');
const eventsBox = document.getElementById('events');
slider.min = FIRST_YEAR;
slider.max = LAST_YEAR;
document.getElementById('year-min').textContent = FIRST_YEAR;
document.getElementById('year-max').textContent = LAST_YEAR;
slider.addEventListener('input', () => setYear(+slider.value));

const position = (year) => `${((year - FIRST_YEAR) / (LAST_YEAR - FIRST_YEAR)) * 100}%`;

const eventButtons = EVENTS.map(([year, text]) => {
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
  return [year, button];
});

function showYear() {
  slider.value = state.year;
  slider.style.setProperty('--progress', position(state.year));
  yearLabel.textContent = state.year;
  for (const [year, button] of eventButtons) button.classList.toggle('is-current', year === state.year);
}

function setYear(year) {
  state.year = year;
  showYear();
  if (layers[state.layer].ready) paintYear();
  refreshPanel();
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
  if (state.year === LAST_YEAR) setYear(FIRST_YEAR);
  playButton.classList.add('is-playing');
  playButton.setAttribute('aria-label', 'Pause');
  timer = setInterval(() => {
    if (state.year >= LAST_YEAR) return stopPlaying();
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

map.on('mousemove', (e) => {
  const iso = map.getLayer('country-nodata') ? featureAt(e.point) : null;
  if (iso !== hoveredId) {
    setState(hoveredId, { hover: false });
    hoveredId = iso;
    setState(hoveredId, { hover: true });
  }
  map.getCanvas().style.cursor = iso ? 'pointer' : '';
  tooltip.hidden = !iso;
  if (iso) {
    tooltip.textContent = tooltipText(iso);
    tooltip.style.transform = `translate(${e.originalEvent.clientX + 14}px, ${e.originalEvent.clientY + 14}px)`;
  }
});

map.getCanvas().addEventListener('mouseleave', () => {
  setState(hoveredId, { hover: false });
  hoveredId = null;
  tooltip.hidden = true;
});

// The label would otherwise hang in mid-air while the globe spins away under it.
map.on('movestart', () => {
  tooltip.hidden = true;
});

map.on('click', (e) => {
  const iso = featureAt(e.point);
  if (iso) selectCountry(iso);
});

// ---- Side panel (and the bottom sheet on phones) ----------------------------

const panel = document.getElementById('panel');
const panelBody = document.getElementById('panel-body');
const sheetToggle = document.getElementById('sheet-toggle');
const sheetLabel = document.getElementById('sheet-toggle-label');
const details = {}; // iso3 -> loaded detail file, fetched the first time it's needed

function setSheet(mode) {
  panel.dataset.sheet = mode;
  sheetToggle.setAttribute('aria-expanded', String(mode === 'full'));
  sheetLabel.textContent = mode === 'full' ? 'Show less' : 'Show more';
}

sheetToggle.addEventListener('click', () => setSheet(panel.dataset.sheet === 'full' ? 'peek' : 'full'));

function selectCountry(iso) {
  setState(state.country, { selected: false });
  state.country = iso;
  setState(iso, { selected: true });
  panelBody.scrollTop = 0;
  if (phone.matches) setSheet('full');
  refreshPanel();
  saveToUrl();

  if (centreOf[iso]) {
    const zoom = smallPlaces.has(iso) ? 3.6 : 2.6;
    map.flyTo({ center: centreOf[iso], zoom: Math.max(map.getZoom(), phone.matches ? zoom - 0.6 : zoom), speed: 0.8 });
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

function closeCountry() {
  setState(state.country, { selected: false });
  state.country = null;
  if (phone.matches) setSheet('peek');
  refreshPanel();
  saveToUrl();
}

function refreshPanel() {
  const layer = layers[state.layer];
  if (!layer.ready) return;
  if (!state.country) {
    const codes = layer.kind === 'topic' ? Object.keys(speeches.shares) : Object.keys(layer.data);
    renderWorld(panelBody, {
      layer,
      year: state.year,
      rows: ranking(layer, state.year, codes),
      nameOf,
      onCountry: selectCountry,
    });
    return;
  }
  const focus = pairOf(layers, layer);
  if (focus.indicator && !focus.indicator.ready) focus.indicator.load().then(refreshPanel);
  renderCountry(panelBody, {
    iso: state.country,
    year: state.year,
    topics,
    speeches,
    detail: details[state.country],
    continent: continentOf[state.country],
    nameOf,
    focus,
    onLayer: setLayer,
    onYear: (year) => {
      stopPlaying();
      setYear(year);
    },
    onCountry: selectCountry,
    onClose: closeCountry,
  });
}

// On phones the timeline lives at the top of the bottom sheet instead of under the globe.
const timeline = document.getElementById('timeline');
const stage = document.querySelector('.stage');
function placeTimeline() {
  (phone.matches ? document.getElementById('timeline-slot') : stage).append(timeline);
  if (!phone.matches) delete panel.dataset.sheet;
  else if (!panel.dataset.sheet) setSheet(state.country ? 'full' : 'peek');
}
phone.addEventListener('change', placeTimeline);
placeTimeline();

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || about.open) return;
  if (rail.classList.contains('is-open')) closeRail();
  else if (state.country) closeCountry();
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
