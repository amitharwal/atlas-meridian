// "Who said it?": a daily puzzle of five real quotes from UN speeches.
// Everyone gets the same five on the same day, chosen by a random generator
// seeded with the date. Results are kept on the visitor's own device only.
import { withThe } from './data.js';
import './daily.css';

const ROUNDS = 5;
const CHOICES = 4;
// Puzzle #1 was published on this day; each day after is the next number.
const FIRST_DAY = new Date(2026, 9, 12);
const SITE = 'https://amitharwal.github.io/atlas-meridian/daily/';
const STORE = 'atlas-meridian:daily:';

const app = document.getElementById('app');
const toast = document.getElementById('toast');

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

// Today's puzzle number, counted in the visitor's own time zone.
function puzzleNumber(date = new Date()) {
  const today = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.round((today - FIRST_DAY) / 86400000) + 1;
}

// Local storage can be unavailable (private browsing); the puzzle still works.
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

function showToast(text) {
  toast.textContent = text;
  toast.hidden = false;
  setTimeout(() => (toast.hidden = true), 2000);
}

const TOPIC_LABELS = {
  peace: 'Peace & conflict', nuclear: 'Nuclear weapons', terrorism: 'Terrorism', human_rights: 'Human rights',
  democracy: 'Democracy', climate: 'Climate & environment', development: 'Development', trade: 'Trade & the economy',
  debt: 'Debt & finance', decolonisation: 'Decolonisation', un_reform: 'UN reform', health: 'Health',
  migration: 'Migration', food_water: 'Food & water', gender: 'Gender equality', technology: 'Technology',
};

// ---- The puzzle ---------------------------------------------------------------

function nameIn(country, year) {
  let name = country.names[0][1];
  for (const [from, n] of country.names) if (year >= from) name = n;
  return name;
}

// Five questions for a seed: different countries, each with three wrong
// answers that also spoke at the UN that year (one from the same continent).
function makeQuestions(data, seed) {
  const rand = random(seed);
  const used = new Set();
  const questions = [];
  for (const [iso, year, topic, text, speaker] of shuffle(data.quotes, rand)) {
    if (used.has(iso)) continue;
    used.add(iso);
    const answer = data.countries[iso];
    const spokeThatYear = Object.keys(data.countries).filter(
      (code) => code !== iso && data.countries[code].years.includes(year),
    );
    const near = shuffle(spokeThatYear.filter((code) => data.countries[code].continent === answer.continent), rand);
    const far = shuffle(spokeThatYear.filter((code) => data.countries[code].continent !== answer.continent), rand);
    const wrong = [...near.slice(0, 1), ...far].slice(0, CHOICES - 1);
    const options = shuffle([iso, ...wrong], rand).map((code) => ({ iso: code, name: nameIn(data.countries[code], year) }));
    questions.push({ iso, year, topic, text, speaker, options, answerName: nameIn(answer, year) });
    if (questions.length === ROUNDS) break;
  }
  return questions;
}

// ---- Screens ------------------------------------------------------------------

// Keyboard focus moves to the new screen's heading (not a button, which
// would look like an answer was already picked).
function render(...children) {
  app.replaceChildren(...children.filter(Boolean));
  const heading = app.querySelector('h1, .kicker');
  heading?.setAttribute('tabindex', '-1');
  heading?.focus({ preventScroll: true });
}

function intro(number, start) {
  render(
    h('p', { class: 'kicker' }, `Daily puzzle #${number}`),
    h('h1', {}, 'Who said it?'),
    h(
      'p',
      { class: 'lede' },
      'Five real quotes from 80 years of speeches at the UN General Assembly. For each one, guess which country said it. ',
      'The country’s own name is blanked out ',
      h('span', { class: 'nowrap' }, '(▇▇▇).'),
    ),
    h('button', { type: 'button', class: 'primary', onclick: start }, 'Start'),
  );
}

function question(state, onAnswer) {
  const q = state.questions[state.round];
  const answered = state.answers[state.round];
  const done = answered !== undefined;

  const progress = h(
    'ol',
    { class: 'progress', 'aria-label': `Question ${state.round + 1} of ${ROUNDS}` },
    state.questions.map((_, i) =>
      h('li', {
        class: i < state.answers.length ? (state.answers[i] ? 'right' : 'wrong') : i === state.round ? 'current' : '',
      }),
    ),
  );

  const options = h(
    'div',
    { class: 'options' },
    q.options.map((option) => {
      let cls = 'option';
      if (done && option.iso === q.iso) cls += ' is-right';
      else if (done && option.iso === state.picked) cls += ' is-wrong';
      return h(
        'button',
        { type: 'button', class: cls, disabled: done ? '' : null, onclick: () => onAnswer(option.iso) },
        option.name,
        done && option.iso === q.iso ? h('span', { class: 'mark', 'aria-label': 'correct' }, '✓') : null,
        done && option.iso === state.picked && option.iso !== q.iso ? h('span', { class: 'mark', 'aria-label': 'your answer' }, '✗') : null,
      );
    }),
  );

  const reveal = done
    ? h(
        'div',
        { class: 'reveal' },
        h('p', { class: 'verdict' }, answered ? 'Correct.' : `It was ${withThe(q.answerName)}.`),
        h(
          'p',
          { class: 'muted' },
          `${q.answerName}, ${q.year}`,
          q.speaker ? ` · ${q.speaker}` : '',
          ` · ${TOPIC_LABELS[q.topic] ?? q.topic}`,
        ),
        h(
          'div',
          { class: 'row' },
          h('a', { class: 'link', href: `../#layer=${q.topic}&year=${q.year}&country=${q.iso}`, target: '_blank', rel: 'noopener' }, 'See it on the map ↗'),
          h('button', { type: 'button', class: 'primary', onclick: state.next }, state.round === ROUNDS - 1 ? 'See your score' : 'Next'),
        ),
      )
    : null;

  render(
    progress,
    h('p', { class: 'kicker' }, `${state.practice ? 'Practice' : `#${state.number}`} · Question ${state.round + 1} of ${ROUNDS}`),
    h('figure', { class: 'quote' }, h('blockquote', {}, `“${q.text}”`), h('figcaption', {}, `Said in ${q.year}`)),
    options,
    reveal,
  );
}

function shareText(state) {
  const score = state.answers.filter(Boolean).length;
  const squares = state.answers.map((ok) => (ok ? '🟦' : '⬜')).join('');
  return `Atlas Meridian · Who said it? #${state.number}\n${score}/${ROUNDS} ${squares}\n${SITE}`;
}

function streak(number) {
  let days = 0;
  while (saved.get(number - days)?.answers?.length === ROUNDS) days += 1;
  return days;
}

function results(state, practiceAgain) {
  const score = state.answers.filter(Boolean).length;
  const verdicts = ['Tough one.', 'A start.', 'Not bad.', 'Good going.', 'Very good.', 'Perfect!'];
  const share = async () => {
    const text = shareText(state);
    try {
      if (navigator.share && matchMedia('(pointer: coarse)').matches) await navigator.share({ text });
      else {
        await navigator.clipboard.writeText(text);
        showToast('Result copied');
      }
    } catch {}
  };
  const days = state.practice ? 0 : streak(state.number);
  render(
    h('p', { class: 'kicker' }, state.practice ? 'Practice round' : `Daily puzzle #${state.number}`),
    h('h1', {}, `${score} / ${ROUNDS}`),
    h('p', { class: 'squares', 'aria-hidden': 'true' }, state.answers.map((ok) => (ok ? '🟦' : '⬜')).join('')),
    h('p', { class: 'lede' }, verdicts[score], days > 1 ? ` That’s ${days} days in a row.` : ''),
    h(
      'div',
      { class: 'row' },
      state.practice ? null : h('button', { type: 'button', class: 'primary', onclick: share }, 'Share result'),
      h('button', { type: 'button', class: 'secondary', onclick: practiceAgain }, 'Practice with more quotes'),
    ),
    state.practice ? null : h('p', { class: 'muted' }, 'A new puzzle appears at midnight.'),
    h(
      'ol',
      { class: 'recap' },
      state.questions.map((q, i) =>
        h(
          'li',
          {},
          h('span', { class: state.answers[i] ? 'ok' : 'miss' }, state.answers[i] ? '✓' : '✗'),
          h('a', { href: `../#layer=${q.topic}&year=${q.year}&country=${q.iso}` }, `${q.answerName}, ${q.year}`),
        ),
      ),
    ),
  );
}

// ---- Running a round ------------------------------------------------------------

function play(data, { number, practice }) {
  const seed = practice ? Math.floor(Math.random() * 1e9) : number * 7919;
  const questions = makeQuestions(data, seed);
  // Saved progress only counts if it was for these exact questions (the quote
  // pool can change when the site is rebuilt).
  const key = questions.map((q) => `${q.iso}${q.year}`).join(',');
  const previous = practice ? null : saved.get(number);
  const state = {
    number,
    practice,
    questions,
    answers: previous?.key === key ? previous.answers : [],
    round: 0,
    picked: null,
  };
  const again = () => play(data, { number, practice: true });

  state.next = () => {
    state.round += 1;
    state.picked = null;
    if (state.round >= ROUNDS) results(state, again);
    else question(state, answer);
  };
  function answer(iso) {
    state.picked = iso;
    state.answers[state.round] = iso === state.questions[state.round].iso;
    if (!practice) saved.set(number, { answers: state.answers, key });
    question(state, answer);
  }

  // Already finished today's? Go straight to the score; halfway? Carry on.
  if (state.answers.length >= ROUNDS) return results(state, again);
  state.round = state.answers.length;
  if (state.round > 0 || practice) return question(state, answer);
  intro(number, () => question(state, answer));
}

try {
  // The puzzle lives at /daily/, so the data is one folder up.
  const response = await fetch(new URL('../data/daily.json', location.href));
  if (!response.ok) throw new Error(response.status);
  play(await response.json(), { number: puzzleNumber(), practice: false });
} catch {
  render(h('p', { class: 'muted' }, 'Couldn’t load the puzzle. Please check your connection and refresh the page.'));
}
