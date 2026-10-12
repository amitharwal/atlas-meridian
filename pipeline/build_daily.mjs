// The quote pool for the daily "Who said it?" puzzle.
//
// Picks a few thousand quotes from the per-country files and blanks out the
// speaker's own name (and words built on it, like "Fijian"), so a quote
// doesn't give its answer away. Each day, the puzzle page draws five quotes
// from this pool with a random generator seeded by the date, so everyone gets
// the same puzzle on the same day.
//
// Runs after `vite build` (see package.json) and writes dist/data/daily.json.
import { readFileSync, writeFileSync } from 'node:fs';
import { makeNamer, speakerLabel } from '../src/data.js';

const DIST = 'dist';
const POOL_SIZE = 3000;
const read = (path) => JSON.parse(readFileSync(`${DIST}/data/${path}`, 'utf8'));

const speeches = read('speeches.json');
const speakers = read('speakers.json');
const topology = read('countries.topo.json');
const shapes = topology.objects.countries.geometries.map((g) => g.properties);
const nameOf = makeNamer({ features: shapes.map((properties) => ({ properties })) });
const continentOf = {
  ...Object.fromEntries(shapes.map((p) => [p.iso3, p.continent])),
  CSK: 'Europe', DDR: 'Europe', YUG: 'Europe', YMD: 'Asia', EU: 'Europe',
};

// A small seeded random generator, so the pool is the same on every build.
function random(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Words that would give the answer away: the country's names, and any word
// starting with them minus a final vowel ("Ukrain" catches "Ukrainian").
function giveaways(iso, year) {
  const names = new Set([nameOf(iso, year), nameOf(iso, 9999)]);
  const stems = [];
  for (const name of names) {
    stems.push(escapeRegex(name));
    const last = name.split(' ').at(-1);
    if (last.length >= 5) stems.push(`${escapeRegex(last.replace(/[aeiouy]$/, ''))}[a-z]*`);
  }
  return new RegExp(`(?<![A-Za-z])(?:${stems.join('|')})(?![A-Za-z])`, 'g');
}

// Capitalised names that are just UN vocabulary, not clues.
const NOT_CLUES = new Set(
  ('United Nations|General Assembly|Security Council|Secretary-General|Secretary General|President|Mr|Madam|Charter|' +
    'Organization|Assembly|Council|Member States|States|Government|God|We|Our|The|This|It|In|At|As|For|But|And|If|' +
    'Economic|Social|Council|International|Court|Justice|Conference|Committee|Programme|Agenda|Goals|Development|' +
    'Sustainable Development Goals|Millennium Development Goals|Article|Declaration|Republic|Kingdom|Union')
    .split('|'),
);

// How many distinct clue-like names a quote contains (places, regions, people,
// events). Capitalised words at the start of a sentence don't count.
function clues(text) {
  const found = new Set();
  for (const m of text.matchAll(/(?<![.!?]\s|^)(?<![A-Za-z])([A-Z][a-z]+(?:[ -](?:of |the |and )?[A-Z][a-z]+)*)/g)) {
    if (!NOT_CLUES.has(m[1]) && m[1].length > 3) found.add(m[1]);
  }
  return found.size;
}

const candidates = [];
for (const iso of Object.keys(speeches.shares)) {
  if (!continentOf[iso] || iso === 'EU') continue;
  const { years } = read(`countries/${iso}.json`);
  for (const [year, { quotes }] of Object.entries(years)) {
    for (const quote of quotes) {
      // Strip the paragraph numbers left over from the printed records ("…do so. 52. There is…").
      // …and stray characters from scanning (a "^" in place of a comma).
      const text = quote.text.replace(/(^|[.!?”"]\s+)\d{1,3}\.\s+/g, '$1').replace(/\^/g, ',').trim();
      if (text.length < 140 || text.length > 320) continue;
      const pattern = giveaways(iso, Number(year));
      const blanks = text.match(pattern)?.length ?? 0;
      if (blanks > 2) continue; // too much about itself to be a fair question
      const blanked = text.replace(pattern, '▇▇▇');
      // A fair question needs something to go on.
      if (clues(blanked) < 2) continue;
      candidates.push({ iso, year: Number(year), topic: quote.topic, text: blanked });
    }
  }
}

// An even spread across the decades, then shuffled.
const rand = random(20261013);
const byDecade = {};
for (const c of candidates) (byDecade[Math.floor(c.year / 10) * 10] ??= []).push(c);
const decades = Object.values(byDecade);
const pool = [];
for (const group of decades) {
  group.sort(() => rand() - 0.5);
  pool.push(...group.slice(0, Math.ceil(POOL_SIZE / decades.length)));
}
pool.sort(() => rand() - 0.5);

// Every country that could be an answer: its continent, the years it spoke
// (so wrong answers are always countries that spoke that year) and its name
// over time, as [from year, name] pairs (Soviet Union, then Russia).
const countries = {};
for (const iso of Object.keys(speeches.shares)) {
  if (!continentOf[iso] || iso === 'EU') continue;
  const names = [];
  for (let y = 1946; y <= 2025; y++) {
    const name = nameOf(iso, y);
    if (names.at(-1)?.[1] !== name) names.push([y, name]);
  }
  countries[iso] = { continent: continentOf[iso], years: Object.keys(speeches.shares[iso]).map(Number), names };
}

// "Prime Minister Frank Bainimarama", or the name alone when no title was recorded.
const speakerOf = (iso, year) => speakerLabel(speakers[iso]?.[year]);

writeFileSync(
  `${DIST}/data/daily.json`,
  JSON.stringify({ countries, quotes: pool.map((q) => [q.iso, q.year, q.topic, q.text, speakerOf(q.iso, q.year)]) }),
);
console.log(`Wrote ${pool.length} puzzle quotes (from ${candidates.length} candidates)`);
