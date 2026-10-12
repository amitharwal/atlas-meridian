// Builds a static profile page for every country that has spoken at the UN
// General Debate, plus an A–Z list of them, a sitemap and robots.txt.
// Pages are plain HTML (charts are inline SVG), so they load instantly and
// search engines can read them.
//
// Runs after `vite build` (see package.json), reading the data in dist/data
// and writing into dist/.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { linePath } from '../src/chart.js';
import { makeNamer, slugOf } from '../src/data.js';

const SITE = 'https://amitharwal.github.io/atlas-meridian/';
const DIST = 'dist';
const read = (path) => JSON.parse(readFileSync(`${DIST}/data/${path}`, 'utf8'));

const speeches = read('speeches.json');
const topics = read('topics.json');
const indicators = read('indicators/index.json');
const topology = read('countries.topo.json');
const speakers = read('speakers.json');
// "Prime Minister Frank Bainimarama", or just the name when no title was recorded.
function speakerOf(iso, year) {
  const entry = speakers[iso]?.[year];
  if (!entry?.[0]) return null;
  const [name, title] = entry;
  return title ? `${title} ${name.replace(/^(Mr|Mrs|Ms|Dr)\.? /, '')}` : name;
}
const shapes = topology.objects.countries.geometries.map((g) => g.properties);
const nameOf = makeNamer({ features: shapes.map((properties) => ({ properties })) });
const continentOf = {
  ...Object.fromEntries(shapes.map((p) => [p.iso3, p.continent])),
  CSK: 'Europe', DDR: 'Europe', YUG: 'Europe', YMD: 'Asia', EU: 'Europe',
};
const YEARS = speeches.years;
const codes = Object.keys(speeches.shares);
const todayName = (iso) => nameOf(iso, 9999);
const slug = Object.fromEntries(codes.map((iso) => [iso, slugOf(todayName(iso))]));

// ---- Helpers ----------------------------------------------------------------

const escape = (text) =>
  String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const pct = (v) => `${v.toFixed(1)}%`;
// Former names that read naturally with "the" ("as the Soviet Union").
const withArticle = (name) => (/^(Soviet Union|European Union)$/.test(name) ? `the ${name}` : name);
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumSignificantDigits: 3 });
function formatIndicator(unit, v) {
  if (unit === 'US$') return `$${compact.format(v)}`;
  if (unit === 'tonnes') return `${v < 10 ? v.toFixed(1) : Math.round(v)} t`;
  if (unit === 'years') return `${v.toFixed(1)} yrs`;
  return `${v < 10 ? v.toFixed(1) : Math.round(v)}%`;
}
function versus(value, typical, what) {
  if (!(typical > 0)) return '';
  const ratio = value / typical;
  if (ratio >= 1.95) return `${ratio.toFixed(1)}× ${what}`;
  if (ratio >= 1.1) return `+${Math.round((ratio - 1) * 100)}% vs ${what}`;
  if (ratio > 0.9) return `≈ ${what}`;
  return `−${Math.round((1 - ratio) * 100)}% vs ${what}`;
}

// A small line chart: the country (solid) against the world (dashed).
function chart(country, world, label) {
  const top = Math.max(...Object.values(country), ...Object.values(world), 1e-9) * 1.08;
  return `<svg class="chart" viewBox="0 0 300 70" preserveAspectRatio="none" role="img" aria-label="${escape(label)}">
<path class="chart-world" d="${linePath(world, YEARS, top, 300, 70)}"/>
<path class="chart-country" d="${linePath(country, YEARS, top, 300, 70)}"/></svg>`;
}

// World averages per topic and year (each speech counts once).
const worldTopic = topics.map((_, i) => {
  const byYear = {};
  for (const shares of Object.values(speeches.shares)) {
    for (const [year, values] of Object.entries(shares)) (byYear[year] ??= []).push(values[i] / 10);
  }
  return Object.fromEntries(Object.entries(byYear).map(([y, vs]) => [y, mean(vs)]));
});

const indicatorData = indicators.map((ind) => {
  const values = read(`indicators/${ind.id}.json`).values;
  const byYear = {};
  for (const series of Object.values(values)) {
    for (const [year, v] of Object.entries(series)) (byYear[year] ??= []).push(v);
  }
  return { ...ind, values, world: Object.fromEntries(Object.entries(byYear).map(([y, vs]) => [y, median(vs)])) };
});

// ---- One page -------------------------------------------------------------

function page({ title, description, path, body }) {
  const depth = path.split('/').filter(Boolean).length;
  const root = '../'.repeat(depth);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)}</title>
<meta name="description" content="${escape(description)}">
<link rel="canonical" href="${SITE}${path}">
<link rel="icon" href="${root}favicon.svg" type="image/svg+xml">
<meta property="og:type" content="article">
<meta property="og:url" content="${SITE}${path}">
<meta property="og:title" content="${escape(title)}">
<meta property="og:description" content="${escape(description)}">
<meta property="og:image" content="${SITE}og.png">
<meta name="twitter:card" content="summary_large_image">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Source+Serif+4:opsz,wght@8..60,500;8..60,600&family=IBM+Plex+Sans:wght@400;500;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="${root}profile.css">
</head>
<body>
<header class="top">
  <a class="brand" href="${root}">Atlas Meridian</a>
  <nav><a href="${root}">Map</a><a href="${root}country/">All countries</a></nav>
</header>
<main>
${body}
</main>
<footer>
  <p>Speeches: <a href="https://doi.org/10.7910/DVN/0TJX8Y">UN General Debate Corpus</a> (CC0).
  Figures: <a href="https://data.worldbank.org/">World Bank Open Data</a> (CC BY 4.0).
  Topics are sorted by a language model that agrees with hand-sorted passages about 71% of the time;
  treat single numbers as rough. <a href="${root}">Atlas Meridian</a> is free and open source.</p>
</footer>
</body>
</html>
`;
}

function profile(iso) {
  const name = todayName(iso);
  const byYear = speeches.shares[iso];
  const years = Object.keys(byYear).map(Number).sort((a, b) => a - b);
  const [first, last] = [years[0], years.at(-1)];
  const detail = JSON.parse(readFileSync(`${DIST}/data/countries/${iso}.json`, 'utf8'));
  const former = [...new Set(years.map((y) => nameOf(iso, y)))].filter((n) => n !== name);

  // Average share of each topic across this country's speeches, against the
  // world average over the same years.
  const stats = topics
    .map((topic, i) => {
      const own = mean(years.map((y) => byYear[y][i] / 10));
      const world = mean(years.map((y) => worldTopic[i][y]));
      return { ...topic, i, own, world, ratio: own / world };
    })
    .sort((a, b) => b.own - a.own);
  const maxOwn = stats[0].own || 1;
  // What sets it apart: topics it raises far more than usual (and often enough to matter).
  const signature = stats.filter((t) => t.own >= 2 && t.ratio >= 1.5).sort((a, b) => b.ratio - a.ratio).slice(0, 3);
  const lead = signature[0] ?? stats[0];

  const intro = signature.length
    ? `Compared with other countries, ${escape(name)} talks most about ${signature
        .map((t) => `<strong>${escape(t.label.toLowerCase())}</strong> (${t.ratio.toFixed(1)}× the average)`)
        .join(', ')}.`
    : `${escape(name)}’s speeches cover much the same ground as the average country’s.`;

  const topicRows = stats
    .slice(0, 6)
    .map(
      (t) => `<li><a href="../../#layer=${t.id}&year=${last}&country=${iso}">${escape(t.label)}</a>
<span class="meter"><span style="width:${Math.max(3, (t.own / maxOwn) * 100).toFixed(0)}%"></span></span>
<span class="value">${pct(t.own)}</span><span class="compare">${escape(versus(t.own, t.world, 'world'))}</span></li>`,
    )
    .join('\n');

  const charts = stats
    .slice(0, 6)
    .map((t) => {
      const series = Object.fromEntries(years.map((y) => [y, byYear[y][t.i] / 10]));
      return `<figure>${chart(series, worldTopic[t.i], `${name}'s share of speech on ${t.label} over time, against the world average`)}
<figcaption>${escape(t.label)}</figcaption></figure>`;
    })
    .join('\n');

  // Who it sounded like, decade by decade: the countries that most often
  // appeared among its five closest matches.
  const decades = [];
  for (let start = Math.floor(first / 10) * 10; start <= last; start += 10) {
    const counts = {};
    for (let y = start; y < start + 10; y++) {
      for (const [code] of detail.years[y]?.allies ?? []) counts[code] = (counts[code] ?? 0) + 1;
    }
    const topThree = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([code]) => code);
    if (topThree.length) {
      const names = topThree.map((code) => {
        const label = escape(nameOf(code, start + 5));
        return slug[code] && code !== iso ? `<a href="../${slug[code]}/">${label}</a>` : label;
      });
      decades.push(`<li><span class="decade">${start}s</span><span>${names.join(', ')}</span></li>`);
    }
  }

  // Quotes: the latest speech, plus the very first one for contrast.
  const labelOf = Object.fromEntries(topics.map((t) => [t.id, t.label]));
  const quote = (q, year) => {
    const who = speakerOf(iso, year);
    return `<figure class="quote"><blockquote>“${escape(q.text)}”</blockquote><figcaption>${year} · ${escape(labelOf[q.topic])}${
      who ? ` · ${escape(who)}` : ''
    }</figcaption></figure>`;
  };

  // How often a leader delivered the speech in person, since titles were recorded.
  const ranked = years.filter((y) => y >= 1990 && speakers[iso]?.[y]?.[2] != null);
  const byLeader = ranked.filter((y) => speakers[iso][y][2] === 3).length;
  const quotes = [
    ...(detail.years[last]?.quotes ?? []).slice(0, 2).map((q) => quote(q, last)),
    ...(first !== last ? (detail.years[first]?.quotes ?? []).slice(0, 1).map((q) => quote(q, first)) : []),
  ].join('\n');

  const numbers = indicatorData
    .map((ind) => {
      const series = ind.values[iso];
      if (!series) return '';
      const latest = Math.max(...Object.keys(series).map(Number));
      const v = series[latest];
      const world = ind.world[latest];
      return `<li><div class="figure">${escape(formatIndicator(ind.unit, v))}</div>
<div class="label">${escape(ind.label)} <span class="year">${latest}</span></div>
<div class="compare">${escape(versus(v, world, 'median'))}</div>
${chart(series, ind.world, `${name}'s ${ind.label} over time, against the world median`)}</li>`;
    })
    .filter(Boolean)
    .join('\n');

  // Who talks about it: the year the most countries named it, and who named it most.
  let attention = '';
  if (existsSync(`${DIST}/data/mentions/${iso}.json`)) {
    const mentions = read(`mentions/${iso}.json`);
    const perYear = Object.entries(mentions).map(([y, bySpeaker]) => [Number(y), Object.keys(bySpeaker).length]);
    const peak = perYear.sort((a, b) => b[1] - a[1])[0];
    const totals = {};
    for (const bySpeaker of Object.values(mentions)) {
      for (const [code, n] of Object.entries(bySpeaker)) totals[code] = (totals[code] ?? 0) + n;
    }
    const top = Object.entries(totals).sort((a, b) => b[1] - a[1]).slice(0, 5);
    if (peak && peak[1] >= 5) {
      const series = Object.fromEntries(perYear.map(([y, n]) => [y, n]));
      attention = `<section><h2>Who talks about ${escape(name)}</h2>
<p class="note">How many countries named ${escape(name)} in their speech each year. The most: ${peak[1]} countries in ${peak[0]}.</p>
${chart(series, {}, `Number of countries naming ${name} each year`)}
<p class="note" style="margin-top:12px">Named it most often, ${first}–${last}: ${top
        .map(([code, n]) => `${slug[code] ? `<a href="../${slug[code]}/">${escape(todayName(code))}</a>` : escape(todayName(code))} (${n})`)
        .join(', ')}.</p>
<p><a href="../../#layer=mentions&target=${iso}&year=${peak[0]}">See who mentions ${escape(name)} on the map</a></p></section>`;
    }
  }

  const continent = continentOf[iso];
  const description = `What ${name} has said at the UN General Debate since ${first}: its main topics, the countries it sounds like, and quotes, next to World Bank figures.`;
  const body = `
<p class="kicker">${escape(continent ?? 'Former member')}</p>
<h1>${escape(name)}</h1>
<p class="sub">${years.length} speeches at the UN General Debate, ${first}–${last}${
    former.length ? `. Includes speeches as ${escape(former.map(withArticle).join(' and '))}` : ''
  }.</p>
<p class="lede">${intro}</p>
${ranked.length >= 5 ? `<p class="sub">Since 1990, its head of state or government gave the speech in ${byLeader} of ${ranked.length} years.</p>` : ''}
<p><a class="button" href="../../#layer=${lead.id}&year=${last}&country=${iso}">Open on the map</a></p>

<section><h2>Main topics, ${first}–${last}</h2>
<p class="note">Average share of each speech, and how that compares with the world average in the same years.</p>
<ol class="topics">${topicRows}</ol></section>

<section><h2>Over time</h2>
<p class="note">${escape(name)} (solid) against the world average (dashed), ${YEARS[0]}–${YEARS[1]}.</p>
<div class="charts">${charts}</div></section>

${decades.length ? `<section><h2>Who it sounded like</h2>
<p class="note">Countries whose speeches most often covered the most similar ground, by decade. Similar wording, not necessarily friendship.</p>
<ul class="decades">${decades.join('\n')}</ul></section>` : ''}

${quotes ? `<section><h2>In its own words</h2>${quotes}</section>` : ''}

${attention}

${numbers ? `<section><h2>The numbers</h2>
<p class="note">Latest World Bank figure, against the median country (dashed).</p>
<ul class="numbers">${numbers}</ul></section>` : ''}
`;
  return page({
    title: `${name} at the UN · Atlas Meridian`,
    description,
    path: `country/${slug[iso]}/`,
    body,
  });
}

// ---- Write everything -------------------------------------------------------

const sorted = [...codes].sort((a, b) => todayName(a).localeCompare(todayName(b)));
for (const iso of sorted) {
  mkdirSync(`${DIST}/country/${slug[iso]}`, { recursive: true });
  writeFileSync(`${DIST}/country/${slug[iso]}/index.html`, profile(iso));
}

// A–Z list, grouped by first letter.
const groups = {};
for (const iso of sorted) (groups[todayName(iso)[0].toUpperCase()] ??= []).push(iso);
const list = Object.entries(groups)
  .map(
    ([letter, isos]) =>
      `<section class="letter"><h2>${letter}</h2><ul>${isos
        .map((iso) => `<li><a href="${slug[iso]}/">${escape(todayName(iso))}</a></li>`)
        .join('')}</ul></section>`,
  )
  .join('\n');
writeFileSync(
  `${DIST}/country/index.html`,
  page({
    title: 'All countries · Atlas Meridian',
    description: `Profiles of all ${codes.length} countries and former states that have spoken at the UN General Debate since 1946.`,
    path: 'country/',
    body: `<h1>All countries</h1><p class="sub">${codes.length} countries and former states that have spoken at the UN General Debate.</p><div class="az">${list}</div>`,
  }),
);

const urls = [SITE, `${SITE}country/`, ...sorted.map((iso) => `${SITE}country/${slug[iso]}/`)];
writeFileSync(
  `${DIST}/sitemap.xml`,
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
    .map((u) => `  <url><loc>${u}</loc></url>`)
    .join('\n')}\n</urlset>\n`,
);
writeFileSync(`${DIST}/robots.txt`, `User-agent: *\nAllow: /\nSitemap: ${SITE}sitemap.xml\n`);

const duplicates = Object.values(slug).filter((s, i, all) => all.indexOf(s) !== i);
if (duplicates.length) throw new Error(`Two countries share a page address: ${duplicates.join(', ')}`);
console.log(`Wrote ${sorted.length} country profiles, an index, sitemap.xml and robots.txt`);
