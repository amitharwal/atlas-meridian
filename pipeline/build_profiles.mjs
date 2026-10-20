// Builds a static fact sheet for every country with World Bank figures or UN
// speeches, plus an A–Z list of them, a sitemap and robots.txt.
// Pages are plain HTML (charts are inline SVG), so they load instantly and
// search engines can read them.
//
// Runs after `vite build` (see package.json), reading the data in dist/data
// and writing into dist/.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { feature } from 'topojson-client';
import { chartRange, linePath } from '../src/chart.js';
import { makeNamer, slugOf, speakerLabel } from '../src/data.js';
import { againstMedian, formatter, grouped, KEY_FACTS, latest, versus } from '../src/format.js';
import { navHtml } from '../src/nav.js';
import { previewPng } from './preview_image.mjs';

const SITE = 'https://amitharwal.github.io/atlas-meridian/';
const DIST = 'dist';
const read = (path) => JSON.parse(readFileSync(`${DIST}/data/${path}`, 'utf8'));

const speeches = read('speeches.json');
const topics = read('topics.json');
const indicators = read('indicators/index.json');
const topology = read('countries.topo.json');
const speakers = read('speakers.json');
const regions = read('regions.json');
const worldMedian = read('indicators/world.json');
// The menu bar's styles, put straight into each page (they're small).
const navCss = readFileSync('src/nav.css', 'utf8');
// The fonts' stylesheet as Vite built it (its name changes with its contents).
const fontsCss = JSON.parse(readFileSync(`${DIST}/.vite/manifest.json`, 'utf8'))['src/fonts.css'].file;
// "Prime Minister Frank Bainimarama", or just the name when no title was recorded.
const speakerOf = (iso, year) => speakerLabel(speakers[iso]?.[year]);
const shapes = topology.objects.countries.geometries.map((g) => g.properties);
const geometryOf = Object.fromEntries(feature(topology, topology.objects.countries).features.map((f) => [f.properties.iso3, f.geometry]));
const nameOf = makeNamer({ features: shapes.map((properties) => ({ properties })) });
const continentOf = {
  ...Object.fromEntries(shapes.map((p) => [p.iso3, p.continent])),
  CSK: 'Europe', DDR: 'Europe', YUG: 'Europe', YMD: 'Asia', EU: 'Europe',
};
const YEARS = speeches.years;
const todayName = (iso) => nameOf(iso, 9999);
// Every country with figures or speeches that we have a name for (the World
// Bank also covers a couple of places, like Gibraltar, that aren't on our map).
const codes = [...new Set([...Object.keys(speeches.shares), ...Object.keys(regions)])].filter((iso) => todayName(iso) !== iso);
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
// A small line chart: the country (solid) against the world (dashed).
// Figures that can go below zero (growth, inflation) keep zero above the bottom edge.
function chart(country, world, label, years = YEARS) {
  const { bottom, top } = chartRange(country, world);
  return `<svg class="chart" viewBox="0 0 300 70" preserveAspectRatio="none" role="img" aria-label="${escape(label)}">
<path class="chart-world" d="${linePath(world, years, top, 300, 70, bottom)}"/>
<path class="chart-country" d="${linePath(country, years, top, 300, 70, bottom)}"/></svg>`;
}

// World Bank figures start in 1960.
const STAT_YEARS = [1960, Math.max(...indicators.map((i) => i.years[1]))];
const formatOf = Object.fromEntries(indicators.map((i) => [i.id, formatter(i)]));

// World averages per topic and year (each speech counts once).
const worldTopic = topics.map((_, i) => {
  const byYear = {};
  for (const shares of Object.values(speeches.shares)) {
    for (const [year, values] of Object.entries(shares)) (byYear[year] ??= []).push(values[i] / 10);
  }
  return Object.fromEntries(Object.entries(byYear).map(([y, vs]) => [y, mean(vs)]));
});

// ---- One page -------------------------------------------------------------

// `image`: the picture shown when the page is shared, if it has its own.
function page({ title, description, path, body, current = 'countries', image }) {
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
<meta property="og:image" content="${SITE}${image ?? 'og.png'}">${
   image ? `\n<meta property="og:image:width" content="1200">\n<meta property="og:image:height" content="630">\n<meta property="og:image:alt" content="${escape(title.split(' · ')[0])}: key figures and outline">` : ''
 }
<meta name="twitter:card" content="summary_large_image">
<link rel="stylesheet" href="${root}${fontsCss}">
<link rel="stylesheet" href="${root}profile.css">
<style>${navCss}</style>
</head>
<body>
<header class="site-nav is-static">${navHtml(root, current)}</header>
<main>
${body}
</main>
<footer>
  <p>Figures: <a href="https://data.worldbank.org/">World Bank Open Data</a> (CC BY 4.0); the median country is the
  middle one each year. Speeches: <a href="https://doi.org/10.7910/DVN/0TJX8Y">UN General Debate Corpus</a> (CC0);
  topics are sorted by a language model that agrees with hand-sorted passages about 71% of the time, so
  treat single numbers as rough. <a href="${root}">Atlas Meridian</a> is free and open source.</p>
</footer>
</body>
</html>
`;
}

// Every World Bank figure for a country, grouped, with its latest value and trend.
function statsSections(iso, name) {
  if (!existsSync(`${DIST}/data/stats/${iso}.json`)) return '';
  const stats = read(`stats/${iso}.json`);
  return grouped(indicators)
    .map(([title, items]) => {
      const rows = items
        .filter((ind) => stats[ind.id])
        .map((ind) => {
          const series = stats[ind.id];
          const { year, value } = latest(series);
          const compared = againstMedian(ind, formatOf[ind.id], value, worldMedian[ind.id]?.[year]);
          return `<li><div class="figure">${escape(formatOf[ind.id](value))}</div>
<div class="label"><a href="../../rankings/#layer=${ind.id}&year=${year}">${escape(ind.label)}</a> <span class="year">${year}</span></div>
<div class="compare">${escape(ind.unit)}${compared ? ` · ${escape(compared)}` : ''}</div>
${chart(series, worldMedian[ind.id] ?? {}, `${name}'s ${ind.label} over time, against the median country`, STAT_YEARS)}</li>`;
        });
      return rows.length ? `<section><h2>${escape(title)}</h2><ul class="numbers">${rows.join('\n')}</ul></section>` : '';
    })
    .join('\n');
}

function keyFacts(iso) {
  if (!existsSync(`${DIST}/data/stats/${iso}.json`)) return '';
  const stats = read(`stats/${iso}.json`);
  const items = KEY_FACTS.map((id) => indicators.find((i) => i.id === id))
    .map((ind) => {
      const found = latest(stats[ind.id]);
      return found ? `<div><dt>${escape(ind.label)}</dt><dd>${escape(formatOf[ind.id](found.value))} <span class="year">${found.year}</span></dd></div>` : '';
    })
    .join('');
  return items ? `<dl class="key-facts">${items}</dl>` : '';
}

// Everything from the UN speeches, for countries that have given one.
function unSection(iso, name) {
  const byYear = speeches.shares[iso];
  if (!byYear) return { html: '', lead: null, years: [] };
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
  const ranked = years.filter((y) => y >= 1994 && speakers[iso]?.[y]?.[2] != null);
  const byLeader = ranked.filter((y) => speakers[iso][y][2] === 3).length;
  const quotes = [
    ...(detail.years[last]?.quotes ?? []).slice(0, 2).map((q) => quote(q, last)),
    ...(first !== last ? (detail.years[first]?.quotes ?? []).slice(0, 1).map((q) => quote(q, first)) : []),
  ].join('\n');

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
      attention = `<h3>Who talks about ${escape(name)}</h3>
<p class="note">How many countries named ${escape(name)} in their speech each year. The most: ${peak[1]} countries in ${peak[0]}.</p>
${chart(series, {}, `Number of countries naming ${name} each year`)}
<p class="note" style="margin-top:12px">Named it most often, ${first}–${last}: ${top
        .map(([code, n]) => `${slug[code] ? `<a href="../${slug[code]}/">${escape(todayName(code))}</a>` : escape(todayName(code))} (${n})`)
        .join(', ')}.</p>
<p><a href="../../#layer=mentions&target=${iso}&year=${peak[0]}">See who mentions ${escape(name)} on the map</a></p>`;
    }
  }

  const html = `<section class="un"><h2>At the UN</h2>
<p class="note">${years.length} speeches at the UN General Debate, ${first}–${last}${
    former.length ? `, including as ${escape(former.map(withArticle).join(' and '))}` : ''
  }.${ranked.length >= 5 ? ` Since 1994, its head of state or government gave the speech in ${byLeader} of ${ranked.length} years.` : ''}</p>
<p class="lede">${intro}</p>

<h3>Main topics, ${first}–${last}</h3>
<p class="note">Average share of each speech, and how that compares with the world average in the same years.</p>
<ol class="topics">${topicRows}</ol>

<h3>Over time</h3>
<p class="note">${escape(name)} (solid) against the world average (dashed), ${YEARS[0]}–${YEARS[1]}.</p>
<div class="charts">${charts}</div>

${decades.length ? `<h3>Who it sounded like</h3>
<p class="note">Countries whose speeches most often covered the most similar ground, by decade. Similar wording, not necessarily friendship.</p>
<ul class="decades">${decades.join('\n')}</ul>` : ''}

${quotes ? `<h3>In its own words</h3>${quotes}` : ''}

${attention}
</section>`;
  return { html, lead, years };
}

function profile(iso) {
  const name = todayName(iso);
  const [region, income] = regions[iso] ?? [];
  const un = unSection(iso, name);
  const stats = statsSections(iso, name);
  const facts = keyFacts(iso);
  const mapLink = stats ? `../../#layer=life_exp&country=${iso}` : `../../#layer=${un.lead.id}&year=${un.years.at(-1)}&country=${iso}`;
  const description = stats
    ? `${name} in numbers: population, economy, health, education, environment and more, compared with the world${un.html ? ', plus what it has said at the UN since ' + un.years[0] : ''}.`
    : `What ${name} said at the UN General Debate, ${un.years[0]}–${un.years.at(-1)}: its main topics, the countries it sounded like, and quotes.`;
  const body = `
<p class="kicker">${escape([continentOf[iso] ?? 'Former UN member', region, income].filter(Boolean).join(' · '))}</p>
<h1>${escape(name)}</h1>
${facts}
<p class="actions"><a class="button" href="${mapLink}">Open on the map</a>${
    stats ? ` <a class="button button-quiet" href="../../compare/#a=${iso}">Compare with another country</a>` : ''
  }</p>
${stats ? `<nav class="toc" aria-label="On this page">${[...stats.matchAll(/<section><h2>([^<]+)<\/h2>/g)]
    .map((m) => m[1])
    .concat(un.html ? ['At the UN'] : [])
    .map((t) => `<a href="#${slugOf(t.replace(/&amp;/g, 'and'))}">${t}</a>`)
    .join('')}</nav>` : ''}
${stats.replace(/<section><h2>([^<]+)<\/h2>/g, (_, t) => `<section id="${slugOf(t.replace(/&amp;/g, 'and'))}"><h2>${t}</h2>`)}
${un.html.replace('<section class="un">', '<section class="un" id="at-the-un">')}
`;
  return page({
    title: `${name} · Atlas Meridian`,
    description,
    path: `country/${slug[iso]}/`,
    body,
    image: `country/${slug[iso]}/preview.png`,
  });
}

// The picture for when the page is shared: name, key figures and outline.
function preview(iso) {
  const [region, income] = regions[iso] ?? [];
  const stats = existsSync(`${DIST}/data/stats/${iso}.json`) ? read(`stats/${iso}.json`) : {};
  const facts = KEY_FACTS.map((id) => indicators.find((i) => i.id === id))
    .map((ind) => ({ ind, found: latest(stats[ind.id]) }))
    .filter(({ found }) => found)
    .map(({ ind, found }) => [formatOf[ind.id](found.value), `${ind.label}, ${found.year}`]);
  const years = Object.keys(speeches.shares[iso] ?? {}).map(Number);
  const note = years.length
    ? `${years.length} speeches at the UN General Debate, ${Math.min(...years)}–${Math.max(...years)}`
    : null;
  return previewPng({
    name: todayName(iso),
    kicker: [region ?? continentOf[iso] ?? 'Former UN member', income].filter(Boolean).join(' · '),
    facts,
    note,
    footer: `World Bank figures and UN speeches since ${YEARS[0]} · free and open source`,
    geometry: geometryOf[iso],
  });
}

// ---- Write everything -------------------------------------------------------

const sorted = [...codes].sort((a, b) => todayName(a).localeCompare(todayName(b)));
for (const iso of sorted) {
  mkdirSync(`${DIST}/country/${slug[iso]}`, { recursive: true });
  writeFileSync(`${DIST}/country/${slug[iso]}/index.html`, profile(iso));
  writeFileSync(`${DIST}/country/${slug[iso]}/preview.png`, preview(iso));
}

// A–Z list, grouped by first letter. Former names get an entry too
// ("Soviet Union, see Russia"), since that's what some people look for.
const entries = sorted.map((iso) => ({ name: todayName(iso), iso }));
for (const iso of sorted) {
  const former = new Set(Object.keys(speeches.shares[iso] ?? {}).map((y) => nameOf(iso, Number(y))));
  for (const name of former) if (name !== todayName(iso)) entries.push({ name, iso, see: todayName(iso) });
}
entries.sort((a, b) => a.name.localeCompare(b.name));
const groups = {};
for (const entry of entries) (groups[entry.name[0].toUpperCase()] ??= []).push(entry);
const list = Object.entries(groups)
  .map(
    ([letter, items]) =>
      `<section class="letter"><h2>${letter}</h2><ul>${items
        .map(({ name, iso, see }) =>
          see
            ? `<li>${escape(name)}, <span class="see">see <a href="${slug[iso]}/">${escape(see)}</a></span></li>`
            : `<li><a href="${slug[iso]}/">${escape(name)}</a></li>`,
        )
        .join('')}</ul></section>`,
  )
  .join('\n');
writeFileSync(
  `${DIST}/country/index.html`,
  page({
    title: 'All countries · Atlas Meridian',
    description: `Fact sheets for ${codes.length} countries and territories: World Bank figures and what they said at the UN.`,
    path: 'country/',
    body: `<h1>All countries</h1><p class="sub">${codes.length} countries, territories and former UN members. Each page has its key figures, how they compare with the world, and its speeches at the UN.</p><div class="az">${list}</div>`,
  }),
);

const urls = [SITE, `${SITE}rankings/`, `${SITE}compare/`, `${SITE}daily/`, `${SITE}country/`, ...sorted.map((iso) => `${SITE}country/${slug[iso]}/`)];
writeFileSync(
  `${DIST}/sitemap.xml`,
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
    .map((u) => `  <url><loc>${u}</loc></url>`)
    .join('\n')}\n</urlset>\n`,
);
writeFileSync(`${DIST}/robots.txt`, `User-agent: *\nAllow: /\nSitemap: ${SITE}sitemap.xml\n`);

const duplicates = Object.values(slug).filter((s, i, all) => all.indexOf(s) !== i);
if (duplicates.length) throw new Error(`Two countries share a page address: ${duplicates.join(', ')}`);
console.log(`Wrote ${sorted.length} country fact sheets, an index, sitemap.xml and robots.txt`);
