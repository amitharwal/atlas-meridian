import { AttributionControl, Map, Marker, NavigationControl, setWorkerUrl } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { feature } from 'topojson-client';
import { drawSparkline } from './chart.js';
import { loadJson, makeNamer, shapeInfo, slugOf } from './data.js';
import { makeLayers, pairOf, ranking } from './layers.js';
import { renderCard, renderRankings } from './panel.js';
import { makeSearch } from './search.js';
import { STORIES } from './stories.js';
import './style.css';

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
let topology, speeches, topics, indicators;
try {
  [topology, speeches, topics, indicators] = await Promise.all([
    loadJson('countries.topo.json'),
    loadJson('speeches.json'),
    loadJson('topics.json'),
    loadJson('indicators/index.json'),
  ]);
} catch (error) {
  loading.textContent = "Couldn't load the data. Please check your connection and refresh the page.";
  loading.classList.add('is-error');
  throw error;
}
// The shapes arrive packed as TopoJSON (much smaller); unpack them to GeoJSON.
const countries = feature(topology, topology.objects.countries);
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
const phone = matchMedia('(max-width: 640px)');

// What's on screen. Kept in the address bar so any view can be shared as a link.
// Climate is the opening view: it changes the most visibly over time.
const state = { layer: 'climate', year: LAST_YEAR, country: null, details: false, story: null };
const params = new URLSearchParams(location.hash.slice(1));
if (layers[params.get('layer')]) state.layer = params.get('layer');
if (+params.get('year') >= FIRST_YEAR && +params.get('year') <= LAST_YEAR) state.year = +params.get('year');
if (speeches.shares[params.get('country')] || centreOf[params.get('country')]) state.country = params.get('country');

function saveToUrl() {
  // A story link is just the story; everything else follows from it.
  if (state.story !== null) return history.replaceState(null, '', `#story=${STORIES[state.story].id}`);
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

// The opening view: centred on Europe and Africa, close enough that the
// screen is never wider than one copy of the world (no Alaska twice), and
// tall enough to show from Cape Horn to Scandinavia between the controls.
const mercatorY = (lat) => (1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2;
const latitudeAt = (y) => (360 / Math.PI) * Math.atan(Math.exp(Math.PI * (1 - 2 * y))) - 90;

// The closest you can zoom out before the world starts repeating across the screen.
const noRepeatZoom = () => Math.log2((innerWidth * 1.05) / 512);

function homeView() {
  const [north, south] = [72, -50];
  const top = phone.matches ? 130 : 70;
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
map.addControl(new NavigationControl({ showCompass: false }), 'bottom-right');
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
  for (const iso of Object.keys(centreOf)) {
    const found = layer.value(iso, state.year);
    setState(iso, found ? { has: true, value: found.value } : { has: false });
  }
}

const legend = document.getElementById('legend');
const spark = document.getElementById('spark');

function paintLayer() {
  const layer = layers[state.layer];
  map.setPaintProperty('country-fill', 'fill-color', rampColor(layer.stops));
  map.setPaintProperty('country-dots', 'circle-color', rampColor(layer.stops));
  const format = layer.legendFormat ?? layer.format;
  document.getElementById('legend-min').textContent = format(layer.stops[0]);
  document.getElementById('legend-max').textContent = `${format(layer.stops.at(-1))}+`;
  legend.title =
    layer.kind === 'topic'
      ? "Share of each country's speech spent on this topic"
      : `${layer.label} (${layer.unit}). Source: ${layer.source}, via the World Bank`;
  drawSparkline(spark, layer.world, speeches.years);
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
  paintLayer();
  loading.hidden = true;
  showHintOnce();
  const story = STORIES.findIndex((st) => st.id === params.get('story'));
  if (story >= 0) openStory(story);
  else if (state.country) selectCountry(state.country);
});

// ---- Pop-overs: only one open at a time -----------------------------------

const picker = document.getElementById('picker');
const layerButton = document.getElementById('layer-button');
const rankings = document.getElementById('rankings');
const rankButton = document.getElementById('rank-button');
const card = document.getElementById('card');
const storiesBox = document.getElementById('stories');
const storiesButton = document.getElementById('stories-button');

function closePopovers(except) {
  if (except !== storiesBox) {
    storiesBox.hidden = true;
    storiesButton.setAttribute('aria-expanded', 'false');
  }
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
const find = makeSearch(
  [...new Set([...Object.keys(centreOf), ...Object.keys(speeches.shares)])].filter((iso) => iso !== 'ATA'),
  nameOf,
);
let findMatches = [];
let findActive = 0;

function showMatches() {
  findMatches = find(findInput.value);
  findActive = 0;
  if (!findInput.value.trim()) {
    closePopovers();
    return;
  }
  closePopovers(findResults);
  findResults.replaceChildren(
    ...(findMatches.length
      ? findMatches.map((match, i) => {
          const option = document.createElement('li');
          option.className = 'find-option';
          option.id = `find-${match.iso}`;
          option.setAttribute('role', 'option');
          option.setAttribute('aria-selected', String(i === findActive));
          const name = document.createElement('span');
          name.textContent = match.name;
          option.append(name);
          if (match.former.length) {
            const alt = document.createElement('span');
            alt.className = 'find-alt';
            alt.textContent = `was ${match.former.join(', ')}`;
            option.append(alt);
          }
          // pointerdown, not click, so it fires before the box loses focus.
          option.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            chooseMatch(i);
          });
          return option;
        })
      : [Object.assign(document.createElement('li'), { className: 'find-empty', textContent: 'No country by that name' })]),
  );
  findResults.hidden = false;
  findInput.setAttribute('aria-expanded', 'true');
  highlightMatch();
}

function highlightMatch() {
  [...findResults.querySelectorAll('.find-option')].forEach((option, i) =>
    option.setAttribute('aria-selected', String(i === findActive)),
  );
  const active = findMatches[findActive];
  if (active) findInput.setAttribute('aria-activedescendant', `find-${active.iso}`);
  else findInput.removeAttribute('aria-activedescendant');
}

function chooseMatch(i) {
  const match = findMatches[i];
  if (!match) return;
  findInput.value = '';
  findInput.blur();
  closePopovers();
  selectCountry(match.iso);
}

findInput.addEventListener('input', showMatches);
findInput.addEventListener('focus', () => findInput.value.trim() && showMatches());
findInput.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    if (!findMatches.length) return;
    findActive = (findActive + (e.key === 'ArrowDown' ? 1 : -1) + findMatches.length) % findMatches.length;
    highlightMatch();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    chooseMatch(findActive);
  } else if (e.key === 'Escape') {
    findInput.value = '';
    closePopovers();
    e.stopPropagation();
  }
});

// Clicking anywhere outside the open pop-over closes it.
document.addEventListener('pointerdown', (e) => {
  if (!e.target.closest('.hud, .popover')) closePopovers();
});

// ---- Picker ---------------------------------------------------------------

const layerList = document.getElementById('layer-list');
const search = document.getElementById('layer-search');
const layerLabel = document.getElementById('layer-label');

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
    buildList();
    const current = layerList.querySelector('[aria-pressed="true"]');
    if (current) layerList.scrollTop = current.offsetTop - layerList.clientHeight / 2;
    if (!phone.matches) search.focus();
  }
});

async function setLayer(id) {
  if (!applyingStory) endStory();
  state.layer = id;
  layerLabel.textContent = layers[id].label;
  saveToUrl();
  await layers[id].load?.();
  await mapReady;
  if (state.layer !== id) return; // the reader picked something else while this loaded
  paintLayer();
  refreshCard();
}

layerLabel.textContent = layers[state.layer].label;

// ---- Rankings ---------------------------------------------------------------

function refreshRankings() {
  const layer = layers[state.layer];
  if (rankings.hidden || !layer.ready) return;
  const codes = layer.kind === 'topic' ? Object.keys(speeches.shares) : Object.keys(layer.data);
  renderRankings(rankings, {
    layer,
    year: state.year,
    rows: ranking(layer, state.year, codes),
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

const slider = document.getElementById('year');
const yearLabel = document.getElementById('year-label');
const eventsBox = document.getElementById('events');
slider.min = FIRST_YEAR;
slider.max = LAST_YEAR;
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

function showYear() {
  slider.value = state.year;
  slider.style.setProperty('--progress', position(state.year));
  yearLabel.textContent = state.year;
}

function setYear(year) {
  if (!applyingStory) endStory();
  state.year = year;
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

function showTooltip(iso, x, y) {
  const layer = layers[state.layer];
  const found = layer.value(iso, state.year);
  const name = document.createElement('span');
  name.textContent = nameOf(iso, state.year);
  const value = document.createElement('b');
  value.textContent = found ? layer.format(found.value) + (found.year === state.year ? '' : ` (${found.year})`) : '—';
  tooltip.replaceChildren(name, value);
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

const details = {}; // iso3 -> loaded detail file, fetched the first time it's needed

// While a country is chosen, every other country fades back and a name label
// is pinned on the map, so it's obvious which one the card is about.
const label = document.createElement('div');
label.className = 'map-label';
const labelMarker = new Marker({ element: label, anchor: 'bottom', offset: [0, -10] });

function spotlight(iso) {
  const on = iso !== null;
  map.setPaintProperty('country-fill', 'fill-opacity', on ? ['case', selected, 1, has, 0.35, 0] : ['case', has, 1, 0]);
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
  if (!applyingStory) endStory();
  setState(state.country, { selected: false });
  state.country = iso;
  setState(iso, { selected: true });
  spotlight(iso);
  hint.hidden = true; // out of the card's way; it can come back next visit
  rankings.hidden = true;
  rankButton.setAttribute('aria-expanded', 'false');
  card.hidden = false;
  card.scrollTop = 0;
  refreshCard();
  saveToUrl();

  if (centreOf[iso]) {
    // Keep the country clear of the card: on wide screens shift the view left.
    const offset = phone.matches ? [0, -innerHeight * 0.2] : [-180, 0];
    const zoom = Math.max(map.getZoom(), homeZoom + (smallPlaces.has(iso) ? 1.3 : 0.3));
    map.flyTo({ center: centreOf[iso], zoom, offset, speed: 0.8 });
  }
  if (speeches.shares[iso] && !(iso in details)) {
    details[iso] = null;
    loadJson(`countries/${iso}.json`)
      .catch(() => ({ years: {} }))
      .then((detail) => {
        details[iso] = detail;
        if (state.country === iso) refreshCard();
      });
  }
}

function closeCountry() {
  if (!applyingStory) endStory();
  setState(state.country, { selected: false });
  state.country = null;
  spotlight(null);
  card.hidden = true;
  saveToUrl();
}

function refreshCard() {
  const layer = layers[state.layer];
  if (!state.country || !layer.ready) return;
  const focus = pairOf(layers, layer);
  if (focus.indicator && !focus.indicator.ready) focus.indicator.load().then(refreshCard);
  renderCard(card, {
    iso: state.country,
    year: state.year,
    topics,
    speeches,
    detail: details[state.country],
    continent: continentOf[state.country],
    nameOf,
    focus,
    showDetails: state.details,
    profileUrl: `country/${slugOf(nameOf(state.country, 9999))}/`,
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
  if (!picker.hidden || !rankings.hidden || !storiesBox.hidden) closePopovers();
  else if (state.story !== null) endStory();
  else if (state.country) closeCountry();
});

// ---- Stories ----------------------------------------------------------------

const storyBar = document.getElementById('story-bar');
const storyPrev = document.getElementById('story-prev');
const storyNext = document.getElementById('story-next');
// Set while a story is setting up the map, so those changes don't end the story.
// Any change the reader makes themselves does end it.
let applyingStory = false;

document.getElementById('story-list').append(
  ...STORIES.map((story, i) => {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'story-item';
    const n = document.createElement('span');
    n.className = 'rank-n';
    n.textContent = i + 1;
    const title = document.createElement('span');
    title.textContent = story.title;
    const year = document.createElement('span');
    year.className = 'story-year';
    year.textContent = story.year;
    button.append(n, title, year);
    button.addEventListener('click', () => {
      closePopovers();
      openStory(i);
    });
    item.append(button);
    return item;
  }),
);

storiesButton.addEventListener('click', () => {
  const open = storiesBox.hidden;
  closePopovers(storiesBox);
  storiesBox.hidden = !open;
  storiesButton.setAttribute('aria-expanded', String(open));
});

function openStory(i) {
  const story = STORIES[i];
  applyingStory = true;
  stopPlaying();
  state.details = Boolean(story.details);
  setYear(story.year);
  const layerReady = setLayer(story.layer);
  if (story.country) {
    selectCountry(story.country);
  } else {
    closeCountry();
    map.flyTo({ ...homeView(), speed: 0.8 });
  }
  applyingStory = false;

  state.story = i;
  document.getElementById('story-count').textContent = `Story ${i + 1} of ${STORIES.length}`;
  document.getElementById('story-title').textContent = story.title;
  document.getElementById('story-text').textContent = story.text;
  storyPrev.disabled = i === 0;
  storyNext.disabled = i === STORIES.length - 1;
  storyBar.hidden = false;
  document.body.classList.add('has-story');
  saveToUrl();
  return layerReady;
}

function endStory() {
  if (state.story === null) return;
  state.story = null;
  storyBar.hidden = true;
  document.body.classList.remove('has-story');
  saveToUrl();
}

storyPrev.addEventListener('click', () => openStory(state.story - 1));
storyNext.addEventListener('click', () => openStory(state.story + 1));
document.getElementById('story-close').addEventListener('click', endStory);

// ---- First-visit hint and "copy link" -------------------------------------

const hint = document.getElementById('hint');
const HINT_KEY = 'atlas-meridian:seen-hint';

// Shown once per browser. Storage can be unavailable (private browsing), in
// which case the hint simply shows each visit.
function showHintOnce() {
  try {
    if (localStorage.getItem(HINT_KEY)) return;
  } catch {}
  if (state.story === null) hint.hidden = false;
}

function dismissHint() {
  hint.hidden = true;
  try {
    localStorage.setItem(HINT_KEY, '1');
  } catch {}
}

document.getElementById('hint-close').addEventListener('click', dismissHint);
document.getElementById('hint-open').addEventListener('click', () => storiesButton.click());
storiesButton.addEventListener('click', dismissHint);

const toast = document.getElementById('toast');
let toastTimer = null;
function showToast(text) {
  toast.textContent = text;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toast.hidden = true), 2000);
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

// Handy for poking at the map from the browser console while developing.
if (import.meta.env.DEV) window.map = map;
