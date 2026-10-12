import { AttributionControl, Map, NavigationControl, setWorkerUrl } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import './style.css';

// MapLibre 6 needs to be told where its background worker lives when bundled by Vite.
setWorkerUrl(workerUrl);

// Colours live in style.css; the map reads them so there's one place to change them.
const css = getComputedStyle(document.documentElement);
const color = (name) => css.getPropertyValue(name).trim();

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
    countries: {
      type: 'geojson',
      // Built from BASE_URL so it still works when hosted under a sub-path (GitHub Pages).
      data: new URL(`${import.meta.env.BASE_URL}data/countries.geojson`, location.href).href,
      promoteId: 'iso3',
    },
  },
  layers: [
    { id: 'ocean', type: 'background', paint: { 'background-color': color('--ocean') } },
    {
      id: 'country-fill',
      type: 'fill',
      source: 'countries',
      paint: {
        'fill-color': [
          'case',
          ['boolean', ['feature-state', 'selected'], false], color('--land-selected'),
          ['boolean', ['feature-state', 'hover'], false], color('--land-hover'),
          color('--land'),
        ],
      },
    },
    {
      id: 'country-border',
      type: 'line',
      source: 'countries',
      paint: { 'line-color': color('--border'), 'line-width': 0.6 },
    },
  ],
};

const map = new Map({
  container: 'map',
  style,
  center: [15, 25],
  zoom: 1.6,
  attributionControl: false,
});
// Controls sit bottom-left so the country panel (right side) never covers them.
map.addControl(new NavigationControl({ visualizePitch: true }), 'bottom-left');
map.addControl(new AttributionControl({ compact: true, customAttribution: 'Borders: Natural Earth' }), 'bottom-left');

const tooltip = document.getElementById('tooltip');
const panel = document.getElementById('panel');
let hoveredId = null;
let selectedId = null;

function setState(id, state) {
  if (id !== null) map.setFeatureState({ source: 'countries', id }, state);
}

map.on('mousemove', 'country-fill', (e) => {
  const feature = e.features[0];
  if (feature.id !== hoveredId) {
    setState(hoveredId, { hover: false });
    hoveredId = feature.id;
    setState(hoveredId, { hover: true });
  }
  map.getCanvas().style.cursor = 'pointer';
  tooltip.textContent = feature.properties.name;
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

map.on('click', 'country-fill', (e) => {
  const feature = e.features[0];
  setState(selectedId, { selected: false });
  selectedId = feature.id;
  setState(selectedId, { selected: true });

  document.getElementById('panel-name').textContent = feature.properties.name;
  document.getElementById('panel-continent').textContent = feature.properties.continent;
  panel.hidden = false;

  map.flyTo({ center: e.lngLat, zoom: Math.max(map.getZoom(), 2.5), speed: 0.8 });
});

function closePanel() {
  setState(selectedId, { selected: false });
  selectedId = null;
  panel.hidden = true;
}

document.getElementById('panel-close').addEventListener('click', closePanel);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closePanel();
});

// Handy for poking at the map from the browser console while developing.
if (import.meta.env.DEV) window.map = map;
