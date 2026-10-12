// The side panel: a world overview when no country is chosen, or one country's
// speech and numbers for the chosen year.
import { miniChart } from './chart.js';
import { peakYear } from './layers.js';

// Tiny element builder; text always goes in as text, never as HTML.
function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  node.append(...children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false));
  return node;
}

const strong = (text) => h('strong', {}, text);
const capitalise = (text) => text.charAt(0).toUpperCase() + text.slice(1);
const pct = (v) => `${v.toFixed(1)}%`;
// Lower-case a label for use mid-sentence, unless it starts with an acronym (CO₂, UN).
const midSentence = (text) => (/^[A-Z]{2}/.test(text) ? text : text.charAt(0).toLowerCase() + text.slice(1));

// "3.6× more", "40% less" or "about the same as" — how `value` compares with `typical`.
function comparison(value, typical) {
  const ratio = value / typical;
  if (ratio >= 1.95) return [strong(`${ratio.toFixed(1)}×`), ' the'];
  if (ratio >= 1.1) return [strong(`${Math.round((ratio - 1) * 100)}% more`), ' than the'];
  if (ratio > 0.9) return ['about the same as the'];
  return [strong(`${Math.round((1 - ratio) * 100)}% less`), ' than the'];
}

// The world figure for a year, or the closest earlier one within two years
// (official statistics lag behind, like the map itself).
function worldAt(layer, year) {
  for (let y = year; y >= year - 2; y--) {
    if (layer.world?.[y] !== undefined) return { value: layer.world[y], year: y };
  }
  return null;
}

function meter(fraction) {
  return h('span', { class: 'meter' }, h('span', { style: `width:${Math.max(2, fraction * 100).toFixed(0)}%` }));
}

function sourceLine(layer) {
  return h('p', { class: 'hint' }, `Source: ${layer.source}, via the World Bank.`, layer.note ? ` ${layer.note}` : null);
}

// ---- World view ----------------------------------------------------------

export function renderWorld(container, { layer, year, rows, nameOf, onCountry }) {
  const isTopic = layer.kind === 'topic';
  const now = worldAt(layer, year);
  const before = worldAt(layer, year - 10);

  let lede;
  if (!now) {
    lede = h('p', { class: 'lede' }, `No figures for ${year}. This data starts in ${layer.years?.[0]}.`);
  } else if (isTopic) {
    const change = before
      ? [`, ${now.value >= before.value ? 'up' : 'down'} from ${pct(before.value)} in ${before.year}`]
      : [];
    lede = h(
      'p',
      { class: 'lede' },
      'On average, countries spent ',
      strong(pct(now.value)),
      ` of their speech on ${layer.short} in ${year}`,
      change,
      '.',
    );
  } else {
    lede = h(
      'p',
      { class: 'lede' },
      `${layer.label} in the typical (median) country was `,
      strong(layer.format(now.value)),
      ` in ${now.year}`,
      before ? `, compared with ${layer.format(before.value)} in ${before.year}` : null,
      '.',
    );
  }

  const peak = isTopic ? peakYear(layer) : null;
  const stats = h(
    'div',
    { class: 'stats' },
    h(
      'div',
      { class: 'stat' },
      h('div', { class: 'stat-value' }, String(rows.length)),
      h('div', { class: 'stat-label' }, isTopic ? 'countries spoke' : 'countries with figures'),
    ),
    isTopic
      ? h(
          'div',
          { class: 'stat' },
          h('div', { class: 'stat-value' }, String(peak.year)),
          h('div', { class: 'stat-label' }, `peak year (${pct(peak.value)})`),
        )
      : rows.length
        ? h(
            'div',
            { class: 'stat' },
            h('div', { class: 'stat-value' }, layer.format(rows[0].value)),
            h('div', { class: 'stat-label' }, `highest: ${nameOf(rows[0].iso, year)}`),
          )
        : null,
  );

  const top = rows.slice(0, 10);
  const max = top[0]?.value || 1;
  const ranking = top.length
    ? [
        h('h3', {}, isTopic ? 'Talked about it most' : 'Highest'),
        h(
          'ol',
          { class: 'ranking' },
          top.map((row, i) =>
            h(
              'li',
              {},
              h(
                'button',
                { type: 'button', class: 'rank-row', onclick: () => onCountry(row.iso) },
                h('span', { class: 'rank-n' }, String(i + 1)),
                h('span', { class: 'rank-name' }, nameOf(row.iso, year)),
                meter(row.value / max),
                h('span', { class: 'rank-value' }, layer.format(row.value)),
              ),
            ),
          ),
        ),
      ]
    : [];

  const parts = [
    h('div', {}, h('p', { class: 'kicker' }, `The world · ${year}`), h('h2', {}, layer.label)),
    lede,
    stats,
    h('div', {}, ranking),
    h('p', { class: 'hint' }, 'Click any country on the globe or in this list to see more.'),
    isTopic ? null : sourceLine(layer),
  ];
  container.replaceChildren(...parts.filter(Boolean));
}

// ---- One country ---------------------------------------------------------

export function renderCountry(container, ctx) {
  const { iso, year, topics, speeches, detail, continent, nameOf, focus } = ctx;
  const byYear = speeches.shares[iso];
  const shares = byYear?.[year];
  const name = nameOf(iso, year);
  const todayName = nameOf(iso, 9999);
  const thisYear = detail?.years[year];
  const labelOf = Object.fromEntries(topics.map((t) => [t.id, t.label]));

  const body = [
    h(
      'div',
      { class: 'panel-head' },
      h('div', {}, h('p', { class: 'kicker' }, [continent, year].filter(Boolean).join(' · ')), h('h2', {}, name)),
      h(
        'button',
        { type: 'button', class: 'icon-button', 'aria-label': 'Close and go back to the world view', onclick: ctx.onClose },
        closeIcon(),
      ),
    ),
  ];
  if (name !== todayName) body.push(h('p', { class: 'note' }, `This UN seat is now held by ${todayName}.`));
  if (!byYear) body.push(h('p', { class: 'note' }, 'There are no General Debate speeches for this place in the dataset.'));
  else if (!shares) body.push(h('p', { class: 'note' }, `No speech on record for ${year}.`));

  // The standout quote: on the focus topic if the speech has one.
  const quotes = thisYear?.quotes ?? [];
  const lead = quotes.find((q) => q.topic === focus.topic.id) ?? quotes[0];
  if (lead) {
    body.push(
      h(
        'figure',
        { class: 'quote-card' },
        h('div', { class: 'quote-topic' }, `On ${midSentence(labelOf[lead.topic])}`),
        h('blockquote', {}, `“${lead.text}”`),
        h('figcaption', {}, `${name}’s speech to the UN General Debate, ${year}`),
      ),
    );
  } else if (shares && detail === null) {
    body.push(h('p', { class: 'hint' }, 'Loading quotes…'));
  }

  body.push(saysVsNumbers(ctx, name, todayName));

  if (shares) {
    const ranked = topics
      .map((t, i) => ({ ...t, value: shares[i] / 10 }))
      .filter((t) => t.value > 0)
      .sort((a, b) => b.value - a.value);
    const max = ranked[0]?.value || 1;
    const ceremonial = 100 - shares.reduce((a, b) => a + b, 0) / 10;
    body.push(
      h(
        'section',
        {},
        h('h3', {}, `Everything ${name} talked about in ${year}`),
        h(
          'div',
          { class: 'bars' },
          ranked.map((t) =>
            h(
              'div',
              { class: 'bar-row' },
              h(
                'button',
                {
                  type: 'button',
                  'aria-pressed': String(t.id === focus.topic.id),
                  title: `Colour the map by ${t.label}`,
                  onclick: () => ctx.onLayer(t.id),
                },
                h('span', {}, t.label),
                meter(t.value / max),
                h('span', { class: 'rank-value' }, pct(t.value)),
              ),
            ),
          ),
        ),
        h('p', { class: 'hint' }, `The other ${pct(ceremonial)} was ceremonial or didn’t fit a topic.`),
      ),
    );
  }

  if (thisYear?.allies.length) {
    body.push(
      h(
        'section',
        {},
        h('h3', {}, 'Speaks most like'),
        h(
          'div',
          { class: 'chips' },
          thisYear.allies.map(([code]) =>
            h('button', { type: 'button', class: 'chip', onclick: () => ctx.onCountry(code) }, nameOf(code, year)),
          ),
        ),
        h('p', { class: 'hint', style: 'margin-top:8px' }, 'Countries whose speeches covered the most similar ground this year.'),
      ),
    );
  }

  const others = quotes.filter((q) => q !== lead);
  if (others.length) {
    body.push(
      h(
        'details',
        { class: 'more-quotes' },
        h('summary', {}, `More from this speech (${others.map((q) => midSentence(labelOf[q.topic])).join(', ')})`),
        others.map((q) => h('figure', {}, h('blockquote', {}, `“${q.text}”`), h('figcaption', {}, labelOf[q.topic]))),
      ),
    );
  }

  container.replaceChildren(...body.filter(Boolean));
}

// Two small cards side by side: how much the country talked about the topic,
// and the World Bank figure that goes with it, each against the world.
function saysVsNumbers(ctx, name, todayName) {
  const { iso, year, speeches, focus } = ctx;
  const { topic, indicator } = focus;
  const cards = [];
  const sentences = [];

  if (speeches.shares[iso]) {
    const country = {};
    for (const yr of Object.keys(speeches.shares[iso])) country[yr] = topic.value(iso, yr).value;
    const now = topic.value(iso, year);
    const world = worldAt(topic, year);
    cards.push(
      h(
        'div',
        { class: 'compare-card' },
        h('div', { class: 'compare-label' }, `Speech on ${topic.short}`),
        h('div', { class: 'compare-value' }, now ? pct(now.value) : '—'),
        h('div', { class: 'compare-label' }, world ? `world average ${pct(world.value)}` : ''),
        miniChart({
          country, world: topic.world, years: speeches.years, year, onPickYear: ctx.onYear,
          label: `${todayName}'s share of speech on ${topic.short} over time, against the world average`,
        }),
      ),
    );
    if (now && world?.value > 0) {
      sentences.push(
        now.value === 0
          ? [`${name} didn’t talk about ${topic.short} this year.`]
          : [
              `${capitalise(topic.short)} took up `, strong(pct(now.value)), ` of ${name}’s speech, `,
              comparison(now.value, world.value), ' world average.',
            ],
      );
    }
  }

  if (indicator) {
    if (!indicator.ready) {
      cards.push(h('div', { class: 'compare-card' }, h('div', { class: 'compare-label' }, 'Loading…')));
    } else {
      const series = indicator.series(iso);
      const now = indicator.value(iso, year);
      const world = now ? worldAt(indicator, now.year) : null;
      cards.push(
        h(
          'div',
          { class: 'compare-card' },
          h('div', { class: 'compare-label' }, indicator.label),
          h('div', { class: 'compare-value' }, now ? indicator.format(now.value) : '—'),
          h(
            'div',
            { class: 'compare-label' },
            !Object.keys(series).length
              ? 'No World Bank figures'
              : now
                ? `${now.year !== year ? `${now.year} figure · ` : ''}world median ${world ? indicator.format(world.value) : '—'}`
                : `No figure for ${year}`,
          ),
          Object.keys(series).length
            ? miniChart({
                country: series, world: indicator.world, years: speeches.years, year, onPickYear: ctx.onYear,
                label: `${todayName}'s ${midSentence(indicator.label)} over time, against the world median`,
              })
            : null,
        ),
      );
      if (now && world?.value > 0) {
        sentences.push([
          `On ${midSentence(indicator.label)}, ${sentences.length ? 'it' : todayName} stood at `,
          strong(indicator.format(now.value)), ', ', comparison(now.value, world.value), ' median country.',
        ]);
      }
    }
  }

  if (!cards.length) return null;
  return h(
    'section',
    {},
    h('h3', {}, indicator ? 'Says vs numbers' : 'What they said'),
    h('div', { class: 'compare' }, cards),
    sentences.length ? h('p', { class: 'takeaway' }, sentences.map((s, i) => [i ? ' ' : '', ...s])) : null,
    h(
      'div',
      { class: 'key' },
      h('span', {}, h('span', { class: 'key-country' }), todayName),
      h('span', {}, h('span', { class: 'key-world' }), 'World'),
      h('span', {}, 'Click a chart to change year'),
    ),
    indicator ? h('div', { style: 'margin-top:8px' }, sourceLine(indicator)) : null,
  );
}

function closeIcon() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '18');
  svg.setAttribute('height', '18');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = '<path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>';
  return svg;
}
