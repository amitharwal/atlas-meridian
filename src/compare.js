// The compare page: two countries side by side, across every measure.
import { MAX_GAP } from './chart.js';
import { makeCombobox } from './combobox.js';
import { formatter, grouped, KEY_FACTS, latest } from './format.js';
import { loadJson } from './data.js';
import { makeSearch } from './search.js';
import { h, loadSite, showError } from './site.js';

const site = await loadSite().catch(showError);
const { regions, indicators, topics, speeches, nameOf, todayName, hasProfile, profileUrl } = site;
const world = await loadJson('indicators/world.json').catch(showError);
const formatOf = Object.fromEntries(indicators.map((i) => [i.id, formatter(i)]));
const YEARS = [1960, Math.max(...indicators.map((i) => i.years[1]))];

const $ = (id) => document.getElementById(id);
const status = $('status');
const out = $('comparison');
const tip = $('chart-tip');

const codes = [...new Set([...Object.keys(regions), ...Object.keys(speeches.shares)])].filter(hasProfile);

const params = new URLSearchParams(location.hash.slice(1));
const valid = (iso) => codes.includes(iso);
let a = valid(params.get('a')) ? params.get('a') : 'USA';
let b = valid(params.get('b')) ? params.get('b') : a === 'CHN' ? 'USA' : 'CHN';
if (a === b) b = codes.find((iso) => iso !== a);

const cache = {};
const statsOf = (iso) => (cache[iso] ??= loadJson(`stats/${iso}.json`).catch(() => ({})));

// ---- A small chart: both countries and the median country -------------------

const SVG = 'http://www.w3.org/2000/svg';
const W = 300;
const H = 64;
const svgEl = (name, attrs) => {
  const node = document.createElementNS(SVG, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
};

// A path through a series, broken where years are missing (as in chart.js).
// Unlike the map's charts this one allows negative values (growth, inflation).
function path(series, lo, hi) {
  let d = '';
  let drawing = false;
  let lastSeen = -Infinity;
  for (let year = YEARS[0]; year <= YEARS[1]; year++) {
    const v = series?.[year];
    if (v === undefined) continue;
    if (year - lastSeen > MAX_GAP) drawing = false;
    lastSeen = year;
    const x = ((year - YEARS[0]) / (YEARS[1] - YEARS[0])) * W;
    const y = H - 2 - ((v - lo) / (hi - lo)) * (H - 4);
    d += `${drawing ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
    drawing = true;
  }
  return d;
}

function chart(id, label, seriesA, seriesB) {
  const median = world[id] ?? {};
  const all = [...Object.values(seriesA ?? {}), ...Object.values(seriesB ?? {}), ...Object.values(median)];
  if (!all.length) return null;
  const lo = Math.min(0, ...all);
  const hi = Math.max(...all) * 1.05 || 1;
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none', class: 'pair-chart', role: 'img', 'aria-label': label });
  const cursor = svgEl('line', { y1: 0, y2: H, class: 'pair-now', visibility: 'hidden' });
  // A zero line, when some values fall below it.
  const zeroY = H - 2 - (-lo / (hi - lo)) * (H - 4);
  svg.append(
    lo < 0 ? svgEl('line', { x1: 0, x2: W, y1: zeroY, y2: zeroY, class: 'pair-zero' }) : '',
    svgEl('path', { d: path(median, lo, hi), class: 'pair-world' }),
    svgEl('path', { d: path(seriesA, lo, hi), class: 'pair-a' }),
    svgEl('path', { d: path(seriesB, lo, hi), class: 'pair-b' }),
    cursor,
  );
  // Hovering shows the three figures for that year.
  const format = formatOf[id];
  svg.addEventListener('pointermove', (e) => {
    const box = svg.getBoundingClientRect();
    const year = Math.round(YEARS[0] + ((e.clientX - box.left) / box.width) * (YEARS[1] - YEARS[0]));
    const x = ((year - YEARS[0]) / (YEARS[1] - YEARS[0])) * W;
    cursor.setAttribute('x1', x);
    cursor.setAttribute('x2', x);
    cursor.setAttribute('visibility', 'visible');
    const line = (cls, name, v) => h('div', {}, h('span', { class: `swatch ${cls}` }), `${name}: `, h('b', {}, v === undefined ? '—' : format(v)));
    tip.replaceChildren(
      h('div', { class: 'tip-year' }, String(year)),
      line('swatch-a', todayName(a), seriesA?.[year]),
      line('swatch-b', todayName(b), seriesB?.[year]),
      line('swatch-world', 'Median country', median[year]),
    );
    tip.hidden = false;
    const left = Math.min(e.clientX + 14, innerWidth - tip.offsetWidth - 8);
    tip.style.transform = `translate(${left}px, ${e.clientY + 14}px)`;
  });
  svg.addEventListener('pointerleave', () => {
    cursor.setAttribute('visibility', 'hidden');
    tip.hidden = true;
  });
  return svg;
}

// ---- The page ----------------------------------------------------------------

// A country's latest figure, with its colour so it's clear whose it is even
// when the column headings are hidden (on phones).
const cell = (stats, id, swatch) => {
  const found = latest(stats[id]);
  return h(
    'td',
    { class: 'num' },
    h('span', { class: `swatch ${swatch}`, 'aria-hidden': 'true' }),
    found ? [formatOf[id](found.value), h('span', { class: 'muted small' }, ` ${found.year}`)] : h('span', { class: 'muted' }, '—'),
  );
};

function header(iso, stats, cls) {
  const [region, income] = regions[iso] ?? [];
  const facts = KEY_FACTS.map((id) => indicators.find((i) => i.id === id));
  return h(
    'div',
    { class: `who ${cls}` },
    h('h2', {}, h('span', { class: `swatch ${cls === 'who-a' ? 'swatch-a' : 'swatch-b'}`, 'aria-hidden': 'true' }), todayName(iso)),
    h('p', { class: 'muted small' }, [region, income].filter(Boolean).join(' · ') || 'Former UN member'),
    h(
      'dl',
      { class: 'who-facts' },
      facts.map((ind) => {
        const found = latest(stats[ind.id]);
        return h('div', {}, h('dt', {}, ind.label), h('dd', {}, found ? formatOf[ind.id](found.value) : '—'));
      }),
    ),
    h('a', { class: 'small', href: profileUrl(iso) }, 'Full profile →'),
  );
}

// What each spent its speech on, in the latest year both spoke.
function unSection() {
  const sa = speeches.shares[a];
  const sb = speeches.shares[b];
  if (!sa || !sb) return null;
  const year = Math.max(...Object.keys(sa).filter((y) => sb[y]).map(Number));
  if (!Number.isFinite(year)) return null;
  const rows = topics
    .map((t, i) => ({ ...t, va: sa[year][i] / 10, vb: sb[year][i] / 10 }))
    .sort((x, y) => y.va + y.vb - (x.va + x.vb))
    .slice(0, 8);
  const max = Math.max(...rows.flatMap((r) => [r.va, r.vb]), 1);
  const bar = (v, cls) => h('span', { class: 'pair-bar-row' }, h('span', { class: `pair-bar ${cls}`, style: `width:${Math.max(0.5, (v / max) * 100).toFixed(1)}%` }), h('span', { class: 'small' }, `${v.toFixed(1)}%`));
  return h(
    'section',
    { class: 'group' },
    h('h2', {}, 'At the UN'),
    h('p', { class: 'note' }, `Share of each country's ${year} speech at the UN General Debate spent on each topic (top ${rows.length}).`),
    h(
      'table',
      { class: 'pair-table un-table' },
      h('tbody', {}, rows.map((r) => h('tr', {}, h('th', { scope: 'row' }, r.label), h('td', {}, bar(r.va, 'bar-a'), bar(r.vb, 'bar-b'))))),
    ),
    h('p', { class: 'small' }, h('a', { href: `../#layer=climate&year=${year}&country=${a}` }, 'Explore UN speeches on the map →')),
  );
}

async function render() {
  pickA.set(a);
  pickB.set(b);
  history.replaceState(null, '', `#a=${a}&b=${b}`);
  document.title = `${todayName(a)} vs ${todayName(b)} · Atlas Meridian`;
  status.textContent = 'Loading…';
  status.hidden = false;
  const [statsA, statsB] = await Promise.all([statsOf(a), statsOf(b)]);
  status.hidden = true;

  const sections = grouped(indicators)
    .map(([title, items]) => {
      const shown = items.filter((ind) => statsA[ind.id] || statsB[ind.id]);
      if (!shown.length) return null;
      return h(
        'section',
        { class: 'group' },
        h('h2', {}, title),
        h(
          'table',
          { class: 'pair-table' },
          h(
            'thead',
            {},
            h(
              'tr',
              {},
              h('th', { scope: 'col' }, h('span', { class: 'visually-hidden' }, 'Measure')),
              h('th', { scope: 'col', class: 'num' }, h('span', { class: 'swatch swatch-a', 'aria-hidden': 'true' }), todayName(a)),
              h('th', { scope: 'col', class: 'num' }, h('span', { class: 'swatch swatch-b', 'aria-hidden': 'true' }), todayName(b)),
              h('th', { scope: 'col', class: 'chart-col' }, h('span', { class: 'muted small' }, `${YEARS[0]}–${YEARS[1]}`)),
            ),
          ),
          h(
            'tbody',
            {},
            shown.map((ind) =>
              h(
                'tr',
                {},
                h('th', { scope: 'row' }, h('a', { href: `../rankings/#layer=${ind.id}` }, ind.label), h('div', { class: 'muted small' }, ind.unit)),
                cell(statsA, ind.id, 'swatch-a'),
                cell(statsB, ind.id, 'swatch-b'),
                h('td', { class: 'chart-col' }, chart(ind.id, `${ind.label} over time: ${todayName(a)}, ${todayName(b)} and the median country`, statsA[ind.id], statsB[ind.id])),
              ),
            ),
          ),
        ),
      );
    })
    .filter(Boolean);

  out.replaceChildren(
    h('div', { class: 'whos' }, header(a, statsA, 'who-a'), header(b, statsB, 'who-b')),
    h(
      'p',
      { class: 'note legend' },
      h('span', { class: 'swatch swatch-a' }), todayName(a), '  ',
      h('span', { class: 'swatch swatch-b' }), todayName(b), '  ',
      h('span', { class: 'swatch swatch-world' }), 'Median country (dashed). Figures are the latest available; hover a chart for any year.',
    ),
    ...sections,
    unSection(),
    h('p', { class: 'note' }, 'Figures: World Bank Open Data (CC BY 4.0). Click a measure to rank every country by it.'),
  );
}

// Typing a country picks it; picking the other side's country swaps the two.
const find = makeSearch(codes, nameOf);
const pickA = makeCombobox({
  input: $('pick-a'),
  list: $('pick-a-list'),
  find,
  nameOf: todayName,
  onChoose: (iso) => {
    if (iso === b) b = a;
    a = iso;
    render();
  },
});
const pickB = makeCombobox({
  input: $('pick-b'),
  list: $('pick-b-list'),
  find,
  nameOf: todayName,
  onChoose: (iso) => {
    if (iso === a) a = b;
    b = iso;
    render();
  },
});
$('swap').addEventListener('click', () => {
  [a, b] = [b, a];
  render();
});
render();

// A different link opened in the same tab: start again from it. Our own
// address updates (history.replaceState) don't trigger this.
addEventListener('hashchange', () => location.reload());
