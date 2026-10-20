// The chart page: any two World Bank measures plotted against each other, one
// dot per country, sized by population, year by year. Regions and chosen
// countries are picked out by highlighting rather than by colour, since seven
// region colours can't all be told apart (especially with colour blindness).
import { makeCombobox } from './combobox.js';
import { loadJson, makeNamer, slugOf } from './data.js';
import { h } from './dom.js';
import { grouped, shortFormatter } from './format.js';
import { makeLayers } from './layers.js';
import { fillNav } from './nav.js';
import { domainOf, makeScale, scaleKind } from './scales.js';
import { makeSearch } from './search.js';
import { showError } from './site.js';
import './pages.css';
import './scatter.css';

fillNav('../');

const $ = (id) => document.getElementById(id);
const SVG = 'http://www.w3.org/2000/svg';
const svgEl = (name, attrs = {}) => {
  const node = document.createElementNS(SVG, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
};

const [places, regions, indicators] = await Promise.all([
  loadJson('places.json'),
  loadJson('regions.json'),
  loadJson('indicators/index.json'),
]).catch(showError);

const nameOf = makeNamer({ features: Object.entries(places).map(([iso3, [name]]) => ({ properties: { iso3, name } })) });
const todayName = (iso) => nameOf(iso, 9999);
const indicatorOf = Object.fromEntries(indicators.map((i) => [i.id, i]));
const lastYear = Math.max(...indicators.map((i) => i.years[1]));
// Only the World Bank measures; speech topics aren't charted.
const layers = makeLayers({ topics: [], speeches: { shares: {} }, indicators, years: [1960, lastYear] });
const population = layers.population;
// Every country the World Bank covers.
const codes = Object.keys(regions);
const REGIONS = [...new Set(codes.map((iso) => regions[iso][0]))].sort();

// ---- What's shown, kept in the address so any view can be shared --------------

const params = new URLSearchParams(location.hash.slice(1));
const isMeasure = (id) => Boolean(indicatorOf[id]);
const state = {
  x: isMeasure(params.get('x')) ? params.get('x') : 'gdp_pc',
  y: isMeasure(params.get('y')) ? params.get('y') : 'life_exp',
  year: +params.get('year') || null,
  size: params.get('size') === 'same' ? 'same' : 'pop',
  region: REGIONS.includes(params.get('region')) ? params.get('region') : null,
  selected: (params.get('sel') ?? '').split(',').filter((iso) => regions[iso]),
};
if (state.x === state.y) state.y = state.x === 'life_exp' ? 'gdp_pc' : 'life_exp';

function save() {
  const p = new URLSearchParams({ x: state.x, y: state.y, year: state.year });
  if (state.size === 'same') p.set('size', 'same');
  if (state.region) p.set('region', state.region);
  if (state.selected.length) p.set('sel', state.selected.join(','));
  history.replaceState(null, '', `#${p}`);
}

// ---- Controls -------------------------------------------------------------

const pickX = $('pick-x');
const pickY = $('pick-y');
const pickSize = $('pick-size');
for (const select of [pickX, pickY]) {
  for (const [title, items] of grouped(indicators)) {
    select.append(h('optgroup', { label: title }, items.map((i) => h('option', { value: i.id }, i.label))));
  }
}
pickX.value = state.x;
pickY.value = state.y;
pickSize.value = state.size;

pickX.addEventListener('change', () => chooseMeasures(pickX.value, state.y === pickX.value ? state.x : state.y));
pickY.addEventListener('change', () => chooseMeasures(state.x === pickY.value ? state.y : state.x, pickY.value));
$('swap').addEventListener('click', () => chooseMeasures(state.y, state.x));
pickSize.addEventListener('change', () => {
  state.size = pickSize.value;
  draw();
});

// Region buttons: pick one to light up its countries.
const regionBox = $('regions');
function showRegions() {
  regionBox.replaceChildren(
    h('span', { class: 'muted small' }, 'Highlight:'),
    ...[null, ...REGIONS].map((region) =>
      h(
        'button',
        {
          type: 'button',
          class: 'region-chip',
          'aria-pressed': String(state.region === region),
          onclick: () => {
            state.region = region;
            showRegions();
            emphasise();
            save();
          },
        },
        region ?? 'None',
      ),
    ),
  );
}

// Chosen countries, each with a way to remove it.
const pickedBox = $('picked');
function showPicked() {
  const clear = state.selected.length > 1 ? h('button', { type: 'button', class: 'link-button small', onclick: () => clearPicked() }, 'Clear all') : '';
  pickedBox.replaceChildren(
    ...state.selected.map((iso) =>
      h(
        'span',
        { class: 'picked-chip' },
        h('a', { href: `../country/${slugOf(todayName(iso))}/` }, todayName(iso)),
        h('button', { type: 'button', 'aria-label': `Remove ${todayName(iso)}`, onclick: () => toggle(iso) }, '×'),
      ),
    ),
    clear,
  );
}

function toggle(iso) {
  state.selected = state.selected.includes(iso) ? state.selected.filter((s) => s !== iso) : [...state.selected, iso];
  showPicked();
  emphasise();
  drawLabels();
  save();
}

function clearPicked() {
  state.selected = [];
  showPicked();
  emphasise();
  drawLabels();
  save();
}

makeCombobox({
  input: $('find'),
  list: $('find-list'),
  find: makeSearch(codes, nameOf),
  onChoose: (iso) => {
    if (!state.selected.includes(iso)) toggle(iso);
  },
});

// ---- Measures and years ---------------------------------------------------------

// Each measure's axis: log or linear, and the range it covers in every year.
const axes = {};
async function prepare(id) {
  await layers[id].load();
  if (!axes[id]) {
    const values = Object.values(layers[id].data).flatMap(Object.values);
    const kind = scaleKind(indicatorOf[id], values);
    axes[id] = { kind, domain: domainOf(values, kind) };
  }
}

// The years both measures cover.
const yearsOf = () => [
  Math.max(indicatorOf[state.x].years[0], indicatorOf[state.y].years[0]),
  Math.min(indicatorOf[state.x].years[1], indicatorOf[state.y].years[1]),
];

// One dot's figures for a year: both measures (with the year each comes
// from, as figures may be carried forward) and population. null if either
// measure is missing.
function pointOf(iso, year) {
  const x = layers[state.x].value(iso, year);
  const y = layers[state.y].value(iso, year);
  return x && y ? { iso, x, y, pop: population.value(iso, year)?.value } : null;
}

const pointsIn = (year) => codes.map((iso) => pointOf(iso, year)).filter(Boolean);

// The newest year most countries have both figures for, so the chart doesn't
// open half empty.
function bestYear() {
  const [first, last] = yearsOf();
  const counts = [];
  for (let year = last; year >= first; year--) counts.push([year, pointsIn(year).length]);
  const most = Math.max(...counts.map(([, n]) => n));
  return counts.find(([, n]) => n >= most * 0.8)[0];
}

let maxPop = 1;
const status = $('status');
const figure = $('figure');
const slider = $('year');

async function chooseMeasures(x, y) {
  stopPlaying();
  state.x = x;
  state.y = y;
  pickX.value = x;
  pickY.value = y;
  status.textContent = 'Loading…';
  status.hidden = false;
  await Promise.all([prepare(x), prepare(y), population.load()]);
  if (state.x !== x || state.y !== y) return; // changed again while loading
  maxPop = Math.max(...Object.values(population.data).flatMap(Object.values));
  const [first, last] = yearsOf();
  slider.min = first;
  slider.max = last;
  $('year-min').textContent = first;
  $('year-max').textContent = last;
  if (!(state.year >= first && state.year <= last)) state.year = bestYear();
  status.hidden = true;
  figure.hidden = false;
  draw();
}

// ---- Drawing ----------------------------------------------------------------

const svg = $('scatter');
const tip = $('chart-tip');
let frame = null; // the current layout: sizes, scales and the parts drawn once
const dots = {}; // iso3 -> <circle>

function draw() {
  const width = figure.clientWidth;
  const narrow = width < 600;
  const height = Math.round(narrow ? width * 0.85 : Math.min(620, width * 0.6));
  const margin = { top: 34, right: 16, bottom: 48, left: narrow ? 44 : 60 };
  const x = makeScale(axes[state.x].kind, axes[state.x].domain, [margin.left, width - margin.right]);
  const y = makeScale(axes[state.y].kind, axes[state.y].domain, [height - margin.bottom, margin.top]);
  const k = Math.min(1, width / 900); // dots shrink a little on small screens
  const radius = (pop) => (state.size === 'same' || !pop ? 5 : Math.max(4, 30 * k * Math.sqrt(pop / maxPop)));
  frame = { width, height, margin, x, y, radius };

  // Dots glide between years, but not when the whole chart is redrawn.
  svg.classList.add('is-redrawing');
  requestAnimationFrame(() => requestAnimationFrame(() => svg.classList.remove('is-redrawing')));
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('width', width);
  svg.setAttribute('height', height);

  // Grid lines and tick labels.
  const xFormat = shortFormatter(indicatorOf[state.x]);
  const yFormat = shortFormatter(indicatorOf[state.y]);
  const grid = svgEl('g', { class: 'grid' });
  for (const tick of x.ticks()) {
    grid.append(
      svgEl('line', { x1: x(tick), x2: x(tick), y1: margin.top, y2: height - margin.bottom }),
      Object.assign(svgEl('text', { x: x(tick), y: height - margin.bottom + 16, 'text-anchor': 'middle' }), { textContent: xFormat(tick) }),
    );
  }
  for (const tick of y.ticks()) {
    grid.append(
      svgEl('line', { x1: margin.left, x2: width - margin.right, y1: y(tick), y2: y(tick) }),
      Object.assign(svgEl('text', { x: margin.left - 6, y: y(tick) + 4, 'text-anchor': 'end' }), { textContent: yFormat(tick) }),
    );
  }
  const title = (id) => `${indicatorOf[id].label} (${indicatorOf[id].unit})${axes[id].kind === 'log' ? ' · log scale' : ''}`;
  const titles = svgEl('g', { class: 'axis-title' });
  titles.append(
    Object.assign(svgEl('text', { x: width - margin.right, y: height - 8, 'text-anchor': 'end' }), { textContent: `${title(state.x)} →` }),
    Object.assign(svgEl('text', { x: margin.left, y: 16 }), { textContent: `↑ ${title(state.y)}` }),
  );
  const watermark = Object.assign(svgEl('text', { class: 'watermark', x: (margin.left + width - margin.right) / 2, y: (margin.top + height - margin.bottom) / 2, 'text-anchor': 'middle', 'dominant-baseline': 'middle', 'font-size': Math.round(height * 0.22) }), {
    id: 'watermark',
  });

  // One dot per country, biggest first so small ones sit on top.
  const latestPop = (iso) => population.value(iso, lastYear)?.value ?? 0;
  const dotLayer = svgEl('g', { class: 'dots' });
  for (const iso of [...codes].sort((a, b) => latestPop(b) - latestPop(a))) {
    dots[iso] ??= svgEl('circle', { class: 'dot is-missing', r: 4 });
    dotLayer.append(dots[iso]);
  }
  svg.replaceChildren(
    grid,
    watermark,
    titles,
    svgEl('g', { id: 'trails', class: 'trails' }),
    dotLayer,
    svgEl('g', { id: 'labels', class: 'labels' }),
    svgEl('circle', { id: 'hover-ring', class: 'hover-ring', r: 0 }),
  );
  place();
  emphasise();
}

// Move every dot to where it is in the chosen year.
function place() {
  const { x, y, radius } = frame;
  const shown = pointsIn(state.year);
  const byIso = Object.fromEntries(shown.map((p) => [p.iso, p]));
  for (const [iso, dot] of Object.entries(dots)) {
    const point = byIso[iso];
    dot.classList.toggle('is-missing', !point);
    if (!point) continue;
    dot.style.transform = `translate(${x(point.x.value).toFixed(1)}px, ${y(point.y.value).toFixed(1)}px)`;
    dot.setAttribute('r', radius(point.pop).toFixed(1));
  }
  frame.points = shown;
  $('watermark').textContent = state.year;
  slider.value = state.year;
  $('year-label').textContent = state.year;
  svg.setAttribute('aria-label', `${indicatorOf[state.x].label} against ${indicatorOf[state.y].label} in ${state.year}: ${shown.length} countries. The figures are also in the table below.`);
  caption(shown.length);
  drawLabels();
  hideTip();
  if ($('table-box').open) fillTable();
  save();
}

// Selected countries and the chosen region stand out; the rest fade back.
function emphasise() {
  const strong = new Set(state.selected);
  if (state.region) for (const iso of codes) if (regions[iso][0] === state.region) strong.add(iso);
  for (const [iso, dot] of Object.entries(dots)) {
    dot.classList.toggle('is-strong', strong.has(iso));
    dot.classList.toggle('is-faded', strong.size > 0 && !strong.has(iso));
  }
}

// Names beside the chosen countries, and the path each has taken so far.
function drawLabels() {
  if (!frame) return;
  const { x, y, radius } = frame;
  const [first] = yearsOf();
  const labels = state.selected
    .map((iso) => ({ iso, point: pointOf(iso, state.year) }))
    .filter(({ point }) => point)
    .map(({ iso, point }) => {
      const label = svgEl('g', { class: 'label' });
      label.style.transform = `translate(${x(point.x.value).toFixed(1)}px, ${y(point.y.value).toFixed(1)}px)`;
      label.append(Object.assign(svgEl('text', { x: radius(point.pop) + 4, y: 4 }), { textContent: todayName(iso) }));
      return label;
    });
  $('labels').replaceChildren(...labels);
  const trails = state.selected.map((iso) => {
    let d = '';
    for (let year = first; year <= state.year; year++) {
      const point = pointOf(iso, year);
      if (point) d += `${d ? 'L' : 'M'}${x(point.x.value).toFixed(1)},${y(point.y.value).toFixed(1)}`;
    }
    return svgEl('path', { d, class: 'trail' });
  });
  $('trails').replaceChildren(...trails);
}

function caption(count) {
  const carried = Math.max(indicatorOf[state.x].carry ?? 2, indicatorOf[state.y].carry ?? 2);
  const sources = [state.x, state.y].map((id) => `${indicatorOf[id].label}: ${indicatorOf[id].source}`).join('; ');
  $('caption').textContent =
    `${count} countries with both figures in ${state.year}${state.size === 'pop' ? ', sized by population' : ''}. ` +
    `Where a figure for ${state.year} isn't out yet, the latest from up to ${carried} years earlier is used. ` +
    `Axes cover every year, so dots move as countries change; the most extreme values sit at the edge. ` +
    `Source: World Bank (${sources}).`;
}

// ---- Hover and click ---------------------------------------------------------

// The dot nearest the pointer, if it's close enough to mean that one.
function nearest(event) {
  if (!frame?.points) return null;
  const box = svg.getBoundingClientRect();
  const [px, py] = [event.clientX - box.left, event.clientY - box.top];
  let best = null;
  for (const point of frame.points) {
    const dx = frame.x(point.x.value) - px;
    const dy = frame.y(point.y.value) - py;
    const distance = Math.hypot(dx, dy);
    const reach = Math.max(frame.radius(point.pop) + 6, 14);
    if (distance <= reach && (!best || distance < best.distance)) best = { point, distance };
  }
  return best?.point ?? null;
}

function showTip(point, event) {
  const ring = $('hover-ring');
  ring.setAttribute('cx', frame.x(point.x.value));
  ring.setAttribute('cy', frame.y(point.y.value));
  ring.setAttribute('r', frame.radius(point.pop) + 3);
  const line = (id, found) =>
    h('div', {}, `${indicatorOf[id].label}: `, h('b', {}, layers[id].format(found.value)), found.year !== state.year ? ` (${found.year})` : '');
  tip.replaceChildren(
    h('div', { class: 'tip-year' }, todayName(point.iso)),
    h('div', { class: 'muted' }, regions[point.iso][0]),
    line(state.x, point.x),
    line(state.y, point.y),
    point.pop ? h('div', {}, 'Population: ', h('b', {}, layers.population.format(point.pop))) : null,
    h('div', { class: 'muted' }, state.selected.includes(point.iso) ? 'Click to stop following' : 'Click to follow it through the years'),
  );
  tip.hidden = false;
  const left = Math.min(event.clientX + 14, innerWidth - tip.offsetWidth - 8);
  const top = event.clientY + 14 + tip.offsetHeight > innerHeight ? event.clientY - tip.offsetHeight - 10 : event.clientY + 14;
  tip.style.transform = `translate(${left}px, ${top}px)`;
  svg.style.cursor = 'pointer';
}

function hideTip() {
  tip.hidden = true;
  $('hover-ring')?.setAttribute('r', 0);
  svg.style.cursor = '';
}

svg.addEventListener('pointermove', (e) => {
  const point = nearest(e);
  if (point) showTip(point, e);
  else hideTip();
});
svg.addEventListener('pointerleave', hideTip);
svg.addEventListener('click', (e) => {
  const point = nearest(e);
  if (!point) return;
  toggle(point.iso);
  showTip(point, e);
});

// ---- Years: slider and play -----------------------------------------------------

const playButton = $('play');
let timer = null;

function setYear(year) {
  state.year = year;
  place();
}

slider.addEventListener('input', () => {
  stopPlaying();
  setYear(+slider.value);
});

function stopPlaying() {
  clearInterval(timer);
  timer = null;
  playButton.classList.remove('is-playing');
  playButton.setAttribute('aria-label', 'Play through the years');
}

playButton.addEventListener('click', () => {
  if (timer) return stopPlaying();
  const [first, last] = yearsOf();
  if (state.year >= last) setYear(first);
  playButton.classList.add('is-playing');
  playButton.setAttribute('aria-label', 'Pause');
  timer = setInterval(() => {
    if (state.year >= yearsOf()[1]) return stopPlaying();
    setYear(state.year + 1);
  }, 600);
});

// ---- The same figures as a table ---------------------------------------------------

function fillTable() {
  const head = (id) => `${indicatorOf[id].label} (${indicatorOf[id].unit})`;
  $('table-head').replaceChildren(
    h('tr', {}, h('th', { scope: 'col' }, 'Country'), h('th', { scope: 'col' }, 'Region'), h('th', { scope: 'col', class: 'num' }, head(state.x)), h('th', { scope: 'col', class: 'num' }, head(state.y)), h('th', { scope: 'col', class: 'num' }, 'Population')),
  );
  const cell = (id, found) => h('td', { class: 'num' }, layers[id].format(found.value), found.year !== state.year ? h('span', { class: 'muted small' }, ` (${found.year})`) : null);
  $('table-rows').replaceChildren(
    ...[...frame.points]
      .sort((a, b) => todayName(a.iso).localeCompare(todayName(b.iso)))
      .map((p) =>
        h(
          'tr',
          {},
          h('td', {}, h('a', { href: `../country/${slugOf(todayName(p.iso))}/` }, todayName(p.iso))),
          h('td', { class: 'muted small' }, regions[p.iso][0]),
          cell(state.x, p.x),
          cell(state.y, p.y),
          h('td', { class: 'num' }, p.pop ? layers.population.format(p.pop) : '—'),
        ),
      ),
  );
}
$('table-box').addEventListener('toggle', () => $('table-box').open && frame && fillTable());

// ---- Start --------------------------------------------------------------------

// Redraw to fit when the window changes size.
let lastWidth = 0;
new ResizeObserver(() => {
  if (!frame || figure.clientWidth === lastWidth) return;
  lastWidth = figure.clientWidth;
  draw();
}).observe(figure);

showRegions();
showPicked();
chooseMeasures(state.x, state.y);

// A different link opened in the same tab: start again from it. Our own
// address updates (history.replaceState) don't trigger this.
addEventListener('hashchange', () => location.reload());
