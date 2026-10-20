// The rankings page: every country, ranked by any measure, for any year.
import { grouped } from './format.js';
import { makeLayers, UN_GROUP } from './layers.js';
import { makeSearch } from './search.js';
import { h } from './dom.js';
import { loadSite, showError } from './site.js';

const site = await loadSite().catch(showError);
const { places, regions, indicators, topics, speeches, nameOf, hasProfile, profileUrl } = site;
const layers = makeLayers({ topics, speeches, indicators, years: speeches.years });

const $ = (id) => document.getElementById(id);
const measure = $('measure');
const yearBox = $('year');
const regionBox = $('region');
const incomeBox = $('income');
const filterBox = $('filter');
const orderButton = $('order');
const rowsBox = $('rows');
const status = $('status');
const table = $('table');

// Measures, grouped as on the map. Speech topics rank countries by how much
// of their speech went on it.
for (const [title, items] of [...grouped(indicators), [UN_GROUP, topics]]) {
  const group = h('optgroup', { label: title === UN_GROUP ? 'At the UN: share of speech on…' : title });
  for (const item of items) group.append(h('option', { value: item.id }, layers[item.id].label));
  measure.append(group);
}
// Region and income group, as the World Bank defines them.
const distinct = (i) => [...new Set(Object.values(regions).map((r) => r[i]))].sort();
for (const region of distinct(0)) regionBox.append(h('option', { value: region }, region));
const INCOME_ORDER = ['High income', 'Upper middle income', 'Lower middle income', 'Low income'];
for (const income of INCOME_ORDER.filter((i) => distinct(1).includes(i))) incomeBox.append(h('option', { value: income }, income));

// Every country that could have a value: World Bank countries and UN speakers.
const codes = [...new Set([...Object.keys(regions), ...Object.keys(speeches.shares)])];
// The name filter matches like the map's search: "UK", "cote", "USSR".
const find = makeSearch(codes, nameOf);

// The page's settings live in the address, so any table can be shared.
const params = new URLSearchParams(location.hash.slice(1));
const state = {
  layer: layers[params.get('layer')] && params.get('layer') !== 'speaker' && params.get('layer') !== 'mentions' ? params.get('layer') : 'life_exp',
  year: +params.get('year') || null,
  region: params.get('region') ?? '',
  income: params.get('income') ?? '',
  ascending: params.get('order') === 'low',
};

function save() {
  const p = new URLSearchParams({ layer: state.layer, year: state.year });
  if (state.region) p.set('region', state.region);
  if (state.income) p.set('income', state.income);
  if (state.ascending) p.set('order', 'low');
  history.replaceState(null, '', `#${p}`);
}

// The years a measure covers, newest first.
function yearsOf(layer) {
  const [first, last] = layer.years ?? speeches.years;
  return Array.from({ length: last - first + 1 }, (_, i) => last - i);
}

// The newest year most countries have a figure for, so the default table isn't half empty.
function bestYear(layer) {
  const years = yearsOf(layer);
  const counts = years.map((y) => codes.filter((iso) => layer.value(iso, y)).length);
  const most = Math.max(...counts);
  return years[counts.findIndex((n) => n >= most * 0.8)];
}

async function chooseMeasure(id, year) {
  state.layer = id;
  measure.value = id;
  const layer = layers[id];
  status.textContent = 'Loading…';
  status.hidden = false;
  await layer.load?.();
  if (state.layer !== id) return; // switched again while it loaded
  const years = yearsOf(layer);
  yearBox.replaceChildren(...years.map((y) => h('option', { value: y }, String(y))));
  state.year = years.includes(year) ? year : bestYear(layer);
  yearBox.value = state.year;
  render();
}

function render() {
  const layer = layers[state.layer];
  let rows = [];
  for (const iso of codes) {
    const found = layer.value(iso, state.year);
    if (!found) continue;
    const [region, income] = regions[iso] ?? [];
    if (state.region && region !== state.region) continue;
    if (state.income && income !== state.income) continue;
    rows.push({ iso, ...found });
  }
  rows.sort((a, b) => (state.ascending ? a.value - b.value : b.value - a.value));
  // Ranks are worked out before the name filter, so "find" keeps each country's real rank.
  rows = rows.map((row, i) => ({ ...row, rank: i + 1 }));
  const named = filterBox.value.trim() ? new Set(find(filterBox.value, Infinity).map((match) => match.iso)) : null;
  const shown = named ? rows.filter((row) => named.has(row.iso)) : rows;

  // Bars start at zero, or at the lowest value when some are negative (growth, inflation).
  const values = rows.map((r) => r.value);
  const low = Math.min(0, ...values);
  const span = Math.max(...values) - low || 1;

  rowsBox.replaceChildren(
    ...shown.map((row) =>
      h(
        'tr',
        {},
        h('td', { class: 'num muted' }, String(row.rank)),
        h(
          'td',
          {},
          hasProfile(row.iso) ? h('a', { href: profileUrl(row.iso) }, nameOf(row.iso, state.year)) : nameOf(row.iso, state.year),
          places[row.iso]?.[1] ? h('span', { class: 'muted small' }, ` ${places[row.iso][1]}`) : null,
        ),
        h('td', { class: 'bar-col' }, h('span', { class: 'bar', style: `width:${Math.max(1, ((row.value - low) / span) * 100).toFixed(1)}%` })),
        h(
          'td',
          { class: 'num' },
          layer.format(row.value),
          row.year !== state.year ? h('span', { class: 'muted small', title: `Latest figure, from ${row.year}` }, ` (${row.year})`) : null,
        ),
      ),
    ),
  );

  const unit = layer.kind === 'topic' ? `% of each country's ${state.year} UN speech` : layer.unit;
  const source = layer.kind === 'topic' ? 'UN General Debate speeches, sorted into topics by a language model' : `${layer.source}, via the World Bank`;
  $('about-measure').textContent = `${layer.label} (${unit}). ${source}.${layer.note ? ` ${layer.note}` : ''}`;
  const filters = [named && `“${filterBox.value.trim()}”`, (state.region || state.income) && 'these filters'].filter(Boolean);
  status.textContent = shown.length ? '' : `No figures for ${filters.length ? `${filters.join(' with ')} in ` : ''}${state.year}.`;
  status.hidden = Boolean(shown.length);
  table.hidden = !shown.length;
  orderButton.textContent = state.ascending ? 'Lowest first' : 'Highest first';
  $('on-map').href = `../#layer=${state.layer}&year=${state.year}`;
  save();
}

measure.addEventListener('change', () => chooseMeasure(measure.value, state.year));
yearBox.addEventListener('change', () => {
  state.year = +yearBox.value;
  render();
});
regionBox.addEventListener('change', () => {
  state.region = regionBox.value;
  render();
});
incomeBox.addEventListener('change', () => {
  state.income = incomeBox.value;
  render();
});
filterBox.addEventListener('input', render);
orderButton.addEventListener('click', () => {
  state.ascending = !state.ascending;
  render();
});

regionBox.value = state.region;
incomeBox.value = state.income;
chooseMeasure(state.layer, state.year);

// A different link opened in the same tab: start again from it. Our own
// address updates (history.replaceState) don't trigger this.
addEventListener('hashchange', () => location.reload());
