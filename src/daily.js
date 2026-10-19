// "Guess the Country": a daily map game. One country is highlighted on a
// blank world map; name it in up to three guesses. Five rounds a day, one from
// each difficulty tier (pipeline/build_game.mjs), easiest first. Everyone gets
// the same five on the same day. Results are kept on the player's own device.
import { Map, NavigationControl, setWorkerUrl } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { feature } from 'topojson-client';
import { loadJson, makeNamer, shapeInfo, slugOf, withThe } from './data.js';
import { formatter } from './format.js';
import { fillNav } from './nav.js';
import { makeSearch } from './search.js';
import './daily.css';

fillNav('../');
setWorkerUrl(workerUrl);

const ROUNDS = 5;
const GUESSES = 3;
const LEVELS = ['Very easy', 'Easy', 'Medium', 'Hard', 'Very hard'];
// Game #1 is on this day; each day after is the next number.
const FIRST_DAY = new Date(2026, 9, 19);
const SITE = 'https://amitharwal.github.io/atlas-meridian/daily/';
const STORE = 'atlas-meridian:country-game:';
// One coloured square per round in the shared result: first, second, third guess, missed.
const SQUARES = ['🟩', '🟨', '🟧', '⬛'];

const $ = (id) => document.getElementById(id);
const panel = $('panel');
const toast = $('toast');
const mapStatus = $('map-status');

// ---- Small helpers ----------------------------------------------------------

function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined) continue;
    if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  node.append(...children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false));
  return node;
}

// A small seeded random generator: the same seed always gives the same sequence.
function random(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(items, rand) {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// Today's game number, counted in the player's own time zone.
function gameNumber(date = new Date()) {
  const today = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.max(1, Math.round((today - FIRST_DAY) / 86400000) + 1);
}

// Local storage can be unavailable (private browsing); the game still works.
const saved = {
  get(n) {
    try {
      return JSON.parse(localStorage.getItem(STORE + n));
    } catch {
      return null;
    }
  },
  set(n, value) {
    try {
      localStorage.setItem(STORE + n, JSON.stringify(value));
    } catch {}
  },
};

// Fill the panel, skipping empty parts.
const fillPanel = (...parts) => panel.replaceChildren(...parts.flat(Infinity).filter(Boolean));

function showToast(text) {
  toast.textContent = text;
  toast.hidden = false;
  setTimeout(() => (toast.hidden = true), 2000);
}

// ---- Distance and direction -----------------------------------------------------

const toRad = (deg) => (deg * Math.PI) / 180;

function distanceKm([lon1, lat1], [lon2, lat2]) {
  const a = Math.sin(toRad(lat2 - lat1) / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(toRad(lon2 - lon1) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(a));
}

// Which way to head from the guess to the answer, as an arrow.
function arrow([lon1, lat1], [lon2, lat2]) {
  const y = Math.sin(toRad(lon2 - lon1)) * Math.cos(toRad(lat2));
  const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) - Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lon2 - lon1));
  const bearing = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  return ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'][Math.round(bearing / 45) % 8];
}

const km = new Intl.NumberFormat('en', { maximumFractionDigits: 0 });

// ---- Load everything ---------------------------------------------------------------

let topology, game, regions, indicators;
try {
  [topology, game, regions, indicators] = await Promise.all([
    loadJson('countries.topo.json'),
    loadJson('game.json'),
    loadJson('regions.json'),
    loadJson('indicators/index.json'),
  ]);
} catch (error) {
  mapStatus.textContent = 'Couldn’t load the game. Please check your connection and refresh the page.';
  throw error;
}
const countries = feature(topology, topology.objects.countries);
const nameOf = makeNamer(countries);
const todayName = (iso) => nameOf(iso, 9999);
const { centreOf, dots } = shapeInfo(countries);
// Answers that would be hard to spot at world zoom get a ring around them:
// island states (the map's dots) and anything whose main piece of land is
// smaller than about 500 km across (in square degrees of its bounding box).
const RING_AREA = 25;
function mainLandArea({ geometry }) {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  let best = 0;
  for (const [outer] of polygons) {
    const xs = outer.map((p) => p[0]);
    const ys = outer.map((p) => p[1]);
    best = Math.max(best, (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys)));
  }
  return best;
}
const smallPlaces = new Set([
  ...dots.features.map((f) => f.properties.iso3),
  ...countries.features.filter((f) => mainLandArea(f) < RING_AREA).map((f) => f.properties.iso3),
]);
const members = game.tiers.flat();
const find = makeSearch(members, nameOf);
const format = Object.fromEntries(indicators.map((i) => [i.id, formatter(i)]));

// The five answers for a game: one from each tier. Each tier is worked
// through in a shuffled order, so a country doesn't come back until the rest
// of its tier has had a turn.
function answersFor(number) {
  return game.tiers.map((tier, t) => {
    const day = number - 1;
    const cycle = Math.floor(day / tier.length);
    return shuffle(tier, random((t + 1) * 100003 + cycle))[day % tier.length];
  });
}

// Five random countries, one per tier, for practice.
function practiceAnswers() {
  const rand = random(Math.floor(Math.random() * 1e9));
  return game.tiers.map((tier) => tier[Math.floor(rand() * tier.length)]);
}

// ---- The map ----------------------------------------------------------------

const css = getComputedStyle(document.documentElement);
const color = (name) => css.getPropertyValue(name).trim();
const roleOf = ['coalesce', ['feature-state', 'role'], 'none'];

const map = new Map({
  container: 'map',
  attributionControl: false,
  renderWorldCopies: true,
  // The whole world, centred so Pacific islands sit near the right-hand edge.
  bounds: [
    [-168, -56],
    [192, 75],
  ],
  style: {
    version: 8,
    sources: {
      countries: { type: 'geojson', data: countries, promoteId: 'iso3' },
      // A ring around the answer when it's too small to see.
      ring: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
    },
    layers: [
      { id: 'ocean', type: 'background', paint: { 'background-color': color('--ocean') } },
      {
        id: 'land',
        type: 'fill',
        source: 'countries',
        filter: ['!=', ['get', 'iso3'], 'ATA'],
        paint: {
          'fill-color': ['match', roleOf, 'answer', color('--target'), 'guess', color('--ramp-2'), color('--land')],
        },
      },
      { id: 'borders', type: 'line', source: 'countries', paint: { 'line-color': color('--border'), 'line-width': 0.6 } },
      {
        id: 'answer-outline',
        type: 'line',
        source: 'countries',
        paint: { 'line-color': color('--select'), 'line-width': 1.4, 'line-opacity': ['match', roleOf, 'answer', 1, 0] },
      },
      {
        id: 'ring',
        type: 'circle',
        source: 'ring',
        paint: {
          'circle-radius': 16,
          'circle-color': 'rgba(0,0,0,0)',
          'circle-stroke-color': color('--target'),
          'circle-stroke-width': 3,
        },
      },
    ],
  },
});
map.addControl(new NavigationControl({ showCompass: false }), 'bottom-right');
map.dragRotate.disable();
map.touchZoomRotate.disableRotation();
const mapReady = new Promise((resolve) => map.on('load', resolve));
mapReady.then(() => (mapStatus.hidden = true));

let painted = [];
function paint(answer, guesses, revealed) {
  for (const iso of painted) map.setFeatureState({ source: 'countries', id: iso }, { role: 'none' });
  painted = [answer, ...guesses];
  for (const iso of guesses) map.setFeatureState({ source: 'countries', id: iso }, { role: 'guess' });
  map.setFeatureState({ source: 'countries', id: answer }, { role: 'answer' });
  map.getSource('ring').setData({
    type: 'FeatureCollection',
    features: smallPlaces.has(answer) ? [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: centreOf[answer] } }] : [],
  });
  if (revealed) map.flyTo({ center: centreOf[answer], zoom: Math.max(map.getZoom(), smallPlaces.has(answer) ? 4 : 2.5), speed: 0.9 });
}

function worldView() {
  map.fitBounds(
    [
      [-168, -56],
      [192, 75],
    ],
    { duration: 600 },
  );
}

// ---- Rounds -------------------------------------------------------------------

// A round's outcome from its guesses: points 3/2/1 for the first, second or
// third guess, 0 if missed; null while still being played.
function outcome(answer, guesses) {
  const hit = guesses.indexOf(answer);
  if (hit >= 0) return GUESSES - hit;
  return guesses.length >= GUESSES ? 0 : null;
}
const squareOf = (points) => SQUARES[GUESSES - points] ?? SQUARES[3];

// The clues shown after each miss: the answer's region, then two figures.
async function clues(iso) {
  const stats = await loadJson(`stats/${iso}.json`).catch(() => ({}));
  const latest = (id) => {
    const series = stats[id];
    if (!series) return null;
    const year = Math.max(...Object.keys(series));
    return format[id](series[year]);
  };
  const pop = latest('population');
  const gdp = latest('gdp_pc');
  return [
    regions[iso] ? `Region: ${regions[iso][0]}` : null,
    [pop && `Population: ${pop}`, gdp && `GDP per person: ${gdp}`].filter(Boolean).join(' · ') || null,
  ];
}

function progress(state) {
  $('progress').replaceChildren(
    ...state.answers.map((answer, i) => {
      const points = outcome(answer, state.guesses[i]);
      return h('li', {
        class: points === null ? (i === state.round ? 'current' : '') : points ? 'right' : 'wrong',
        title: `Round ${i + 1}: ${LEVELS[i]}`,
      });
    }),
  );
}

function guessBox(onGuess) {
  const input = h('input', {
    id: 'guess',
    type: 'search',
    placeholder: 'Type a country',
    autocomplete: 'off',
    spellcheck: 'false',
    'aria-label': 'Your guess',
    role: 'combobox',
    'aria-expanded': 'false',
    'aria-controls': 'guess-list',
  });
  const list = h('ul', { id: 'guess-list', class: 'guess-list', role: 'listbox', hidden: '' });
  let matches = [];
  let active = 0;
  const show = () => {
    matches = find(input.value, 6);
    active = 0;
    list.hidden = !matches.length;
    input.setAttribute('aria-expanded', String(matches.length > 0));
    list.replaceChildren(
      ...matches.map((m, i) =>
        h(
          'li',
          {
            role: 'option',
            class: 'guess-option',
            'aria-selected': String(i === active),
            // pointerdown, not click, so it fires before the box loses focus.
            onpointerdown: (e) => {
              e.preventDefault();
              choose(i);
            },
          },
          m.name,
        ),
      ),
    );
  };
  const choose = (i) => {
    if (!matches[i]) return;
    const iso = matches[i].iso;
    input.value = '';
    list.hidden = true;
    onGuess(iso);
  };
  input.addEventListener('input', show);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!matches.length) return;
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length;
      [...list.children].forEach((li, i) => li.setAttribute('aria-selected', String(i === active)));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(active);
    }
  });
  return h('div', { class: 'guess-box' }, input, list);
}

async function showRound(state) {
  const i = state.round;
  const answer = state.answers[i];
  const guesses = state.guesses[i];
  const points = outcome(answer, guesses);
  const done = points !== null;
  progress(state);
  $('kicker').textContent = `${state.practice ? 'Practice' : `#${state.number}`} · Round ${i + 1} of ${ROUNDS} · ${LEVELS[i]}`;
  await mapReady;
  paint(answer, guesses.filter((g) => g !== answer), done);
  if (!done && guesses.length === 0) worldView();

  const clueList = guesses.length && !done ? await clues(answer) : [];
  const rows = guesses.map((g) =>
    h(
      'li',
      { class: g === answer ? 'hit' : 'miss' },
      h('span', { class: 'guess-name' }, todayName(g)),
      g === answer
        ? h('span', { class: 'guess-far' }, '✓')
        : h('span', { class: 'guess-far' }, `${km.format(distanceKm(centreOf[g], centreOf[answer]))} km ${arrow(centreOf[g], centreOf[answer])}`),
    ),
  );

  const left = GUESSES - guesses.length;
  fillPanel(
    h('p', { class: 'prompt' }, done ? '' : `Which country is highlighted${smallPlaces.has(answer) ? ' (circled)' : ''}?`),
    rows.length ? h('ol', { class: 'guesses' }, rows) : null,
    clueList.slice(0, guesses.length).filter(Boolean).length
      ? h('ul', { class: 'clues' }, clueList.slice(0, guesses.length).filter(Boolean).map((c) => h('li', {}, c)))
      : null,
    done
      ? h(
          'div',
          { class: 'reveal' },
          h('p', { class: 'verdict' }, points ? `${['', 'Third', 'Second', 'First'][points]} try: ${points} point${points === 1 ? '' : 's'}.` : `It was ${withThe(todayName(answer))}.`),
          h('p', { class: 'answer-name' }, todayName(answer)),
          h(
            'div',
            { class: 'row' },
            h('a', { class: 'link', href: `../country/${slugOf(todayName(answer))}/`, target: '_blank', rel: 'noopener' }, 'Its fact sheet ↗'),
            h('button', { type: 'button', class: 'primary', onclick: state.next }, i === ROUNDS - 1 ? 'See your score' : 'Next round'),
          ),
        )
      : [guessBox(state.guess), h('p', { class: 'muted small' }, `${left} guess${left === 1 ? '' : 'es'} left. Drag or zoom the map to look closer.`)],
  );
  if (!done) panel.querySelector('input')?.focus({ preventScroll: true });
  else panel.querySelector('.primary')?.focus({ preventScroll: true });
}

// ---- Results ------------------------------------------------------------------

function streak(number) {
  let days = 0;
  for (;;) {
    const record = saved.get(number - days);
    const finished = record?.guesses?.length === ROUNDS && record.guesses.every((g, i) => outcome(record.answers[i], g) !== null);
    if (!finished) return days;
    days += 1;
  }
}

function results(state) {
  const scores = state.answers.map((a, i) => outcome(a, state.guesses[i]));
  const total = scores.reduce((a, b) => a + b, 0);
  const squares = scores.map(squareOf).join('');
  const share = async () => {
    const text = `Atlas Meridian · Guess the Country #${state.number}\n${total}/${ROUNDS * GUESSES} ${squares}\n${SITE}`;
    try {
      if (navigator.share && matchMedia('(pointer: coarse)').matches) await navigator.share({ text });
      else {
        await navigator.clipboard.writeText(text);
        showToast('Result copied');
      }
    } catch {}
  };
  const days = state.practice ? 0 : streak(state.number);
  progress({ ...state, round: -1 });
  $('kicker').textContent = state.practice ? 'Practice game' : `Daily game #${state.number}`;
  mapReady.then(() => {
    paint(state.answers[ROUNDS - 1], [], false);
    for (const iso of state.answers) map.setFeatureState({ source: 'countries', id: iso }, { role: 'answer' });
    painted = [...state.answers];
    map.getSource('ring').setData({ type: 'FeatureCollection', features: [] });
    worldView();
  });
  fillPanel(
    h('p', { class: 'score' }, `${total} / ${ROUNDS * GUESSES}`),
    h('p', { class: 'squares', 'aria-hidden': 'true' }, squares),
    days > 1 ? h('p', { class: 'muted' }, `${days} days in a row.`) : null,
    h(
      'ol',
      { class: 'recap' },
      state.answers.map((iso, i) =>
        h(
          'li',
          {},
          h('span', { class: 'recap-square', 'aria-hidden': 'true' }, squareOf(scores[i])),
          h('a', { href: `../country/${slugOf(todayName(iso))}/` }, todayName(iso)),
          h('span', { class: 'muted small' }, ` ${LEVELS[i]} · ${scores[i]} pt${scores[i] === 1 ? '' : 's'}`),
        ),
      ),
    ),
    h(
      'div',
      { class: 'row' },
      state.practice ? null : h('button', { type: 'button', class: 'primary', onclick: share }, 'Share result'),
      h('button', { type: 'button', class: 'secondary', onclick: () => play({ number: state.number, practice: true }) }, 'Play a practice game'),
    ),
    state.practice ? null : h('p', { class: 'muted small' }, 'A new game appears at midnight.'),
  );
}

// ---- Running a game ---------------------------------------------------------------

function play({ number, practice }) {
  const answers = practice ? practiceAnswers() : answersFor(number);
  // Saved progress only counts if it was for these exact countries (the
  // tiers can change when the game is rebuilt).
  const previous = practice ? null : saved.get(number);
  const state = {
    number,
    practice,
    answers,
    guesses: previous?.answers?.join() === answers.join() ? previous.guesses : answers.map(() => []),
    round: 0,
  };
  const save = () => !practice && saved.set(number, { answers, guesses: state.guesses });

  state.guess = (iso) => {
    const guesses = state.guesses[state.round];
    if (guesses.includes(iso)) return showToast(`Already guessed ${todayName(iso)}`);
    guesses.push(iso);
    save();
    showRound(state);
  };
  state.next = () => {
    state.round += 1;
    if (state.round >= ROUNDS) results(state);
    else showRound(state);
  };

  // Pick up where the player left off; finished games go straight to the score.
  state.round = state.answers.findIndex((a, i) => outcome(a, state.guesses[i]) === null);
  if (state.round === -1) return results(state);
  showRound(state);
}

play({ number: gameNumber(), practice: false });
