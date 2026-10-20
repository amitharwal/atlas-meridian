// The small pop-overs: the top-10 list and the country card.
import { miniChart } from './chart.js';
import { h } from './dom.js';
import { againstMedian, KEY_FACTS, versus } from './format.js';

const pct = (v) => `${v.toFixed(1)}%`;
// Lower-case a label for use mid-sentence, unless it starts with an acronym (CO₂, UN).
const midSentence = (text) => (/^[A-Z]{2}/.test(text) ? text : text.charAt(0).toLowerCase() + text.slice(1));

// The world figure for a year, or the closest earlier one within two years.
function worldAt(layer, year) {
  for (let y = year; y >= year - 2; y--) {
    if (layer.world?.[y] !== undefined) return layer.world[y];
  }
  return undefined;
}

function closeButton(label, onclick) {
  const button = h('button', { type: 'button', class: 'close', 'aria-label': label, onclick });
  button.innerHTML =
    '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  return button;
}

// ---- Top 10 ---------------------------------------------------------------

export function renderRankings(container, { layer, year, rows, title, fullUrl, nameOf, onCountry }) {
  // For the speaker layer a top-10 makes no sense; count who spoke instead.
  if (layer.kind === 'speaker') {
    const counts = [0, 0, 0, 0];
    for (const row of rows) counts[row.value] += 1;
    container.replaceChildren(
      h('p', { class: 'popover-title' }, `Who gave the speech · ${year}`),
      rows.length
        ? h(
            'ol',
            { class: 'rank-list' },
            [3, 2, 1, 0].map((rank) =>
              h(
                'li',
                { class: 'rank-row', style: 'cursor:default' },
                h('span', { class: 'rank-n' }, ''),
                h('span', { class: 'rank-name' }, layer.format(rank)),
                h('span', { class: 'rank-value' }, String(counts[rank])),
              ),
            ),
          )
        : h('p', { class: 'popover-title' }, `Speakers' titles are recorded from 1994.`),
    );
    return;
  }
  const top = rows.slice(0, 10);
  container.replaceChildren(
    h('p', { class: 'popover-title' }, title ?? `Highest · ${year}`),
    top.length
      ? h(
          'ol',
          { class: 'rank-list' },
          top.map((row, i) =>
            h(
              'li',
              {},
              h(
                'button',
                { type: 'button', class: 'rank-row', onclick: () => onCountry(row.iso) },
                h('span', { class: 'rank-n' }, String(i + 1)),
                h('span', { class: 'rank-name' }, nameOf(row.iso, year)),
                h('span', { class: 'rank-value' }, layer.format(row.value)),
              ),
            ),
          ),
        )
      : h('p', { class: 'popover-title' }, `No data for ${year}.`),
    fullUrl ? h('a', { class: 'rank-more', href: fullUrl }, `All ${rows.length} countries →`) : null,
  );
}

// ---- Country card -----------------------------------------------------------

// A figure from a country's own stats file for a year, or the latest one within
// the indicator's carry-forward window: { value, year } or null.
function statAt(stats, indicator, year) {
  const series = stats?.[indicator.id];
  if (!series) return null;
  for (let y = year; y >= year - indicator.carry; y--) {
    if (series[y] !== undefined) return { value: series[y], year: y };
  }
  return null;
}

const metric = (value, label, compare) =>
  h('div', {}, h('div', { class: 'metric-value' }, value), h('div', { class: 'metric-label' }, label), compare ? h('div', { class: 'metric-compare' }, compare) : null);

export function renderCard(container, ctx) {
  const { iso, year, topics, speeches, detail, continent, nameOf, focus, showDetails, layer } = ctx;
  const { topic, indicator } = focus;
  const onUnMap = layer.kind !== 'indicator';
  const byYear = speeches.shares[iso];
  const name = nameOf(iso, year);
  const todayName = nameOf(iso, 9999);
  const thisYear = detail?.years[year];
  const labelOf = Object.fromEntries(topics.map((t) => [t.id, t.label]));

  const parts = [
    h(
      'div',
      { class: 'card-head' },
      h('div', {}, h('p', { class: 'card-kicker' }, [continent, year].filter(Boolean).join(' · ')), h('h2', { class: 'card-title' }, name)),
      closeButton('Close', ctx.onClose),
    ),
    name !== todayName ? h('p', { class: 'card-note' }, `UN seat now held by ${todayName}`) : null,
    onUnMap && ctx.speaker ? h('p', { class: 'card-speaker' }, `Speech by ${ctx.speaker}`) : null,
  ];

  // The headline numbers: whatever the map is showing, and what goes with it.
  const metrics = [];
  const m = ctx.mentions;
  if (m && iso === m.target) {
    metrics.push(metric(String(m.mentioners), `countries named ${name} in ${year}`));
  } else if (m) {
    metrics.push(
      metric(m.count === null ? '—' : String(m.count), m.count === null ? `No speech in ${year}` : `mention${m.count === 1 ? '' : 's'} of ${m.targetName}`),
      metric(String(m.mentioners), `countries named ${m.targetName}`),
    );
  } else if (layer.kind === 'indicator') {
    const now = layer.value(iso, year);
    metrics.push(
      metric(
        now ? layer.format(now.value) : '—',
        `${layer.label}${now ? '' : `: no figure for ${year}`}`,
        now ? [againstMedian(layer, layer.format, now.value, worldAt(layer, now.year), 'world median'), now.year !== year ? ` (${now.year})` : ''] : null,
      ),
    );
  } else if (byYear) {
    const now = topic.value(iso, year);
    metrics.push(
      metric(
        now ? pct(now.value) : '—',
        now ? `of UN speech on ${topic.short}` : `No UN speech in ${year}`,
        now ? versus(now.value, worldAt(topic, year), 'world avg') : null,
      ),
    );
    // A speech topic's matching statistic, e.g. climate talk and CO₂ per person.
    if (indicator) {
      const stat = statAt(ctx.stats, indicator, year);
      const typical = ctx.worldMedians?.[indicator.id];
      metrics.push(
        metric(
          stat ? indicator.format(stat.value) : '—',
          indicator.label,
          !ctx.stats ? 'Loading…' : stat ? [versus(stat.value, typical?.[stat.year], 'median'), stat.year !== year ? ` (${stat.year})` : ''] : `No figure for ${year}`,
        ),
      );
    }
  }
  if (metrics.length) parts.push(h('div', { class: 'metrics' }, metrics));
  else if (!ctx.stats || !Object.keys(ctx.stats).length) parts.push(h('p', { class: 'card-note' }, ctx.stats ? 'No figures for this place.' : 'Loading…'));

  // Key facts for every country, at the chosen year.
  const facts = KEY_FACTS.map((id) => ctx.indicators[id]).filter((ind) => ind && ind.id !== layer.id);
  if (ctx.stats && Object.keys(ctx.stats).length) {
    parts.push(
      h(
        'dl',
        { class: 'facts' },
        facts.map((ind) => {
          const stat = statAt(ctx.stats, ind, year);
          return h(
            'div',
            {},
            h('dt', {}, ind.label),
            h('dd', {}, h('button', { type: 'button', class: 'fact-value', title: `Colour the map by ${ind.label.toLowerCase()}`, onclick: () => ctx.onLayer(ind.id) }, stat ? ind.format(stat.value) : '—')),
          );
        }),
      ),
    );
  }

  // On a statistic with a matching speech topic, one line on what the country said.
  if (!onUnMap && topic && byYear?.[year]) {
    const said = topic.value(iso, year);
    const compared = versus(said.value, worldAt(topic, year), 'world avg');
    parts.push(
      h(
        'p',
        { class: 'card-un' },
        h('span', { class: 'card-un-label' }, 'At the UN '),
        `${pct(said.value)} of its ${year} speech was on ${topic.short} `,
        compared ? h('span', { class: 'metric-compare' }, `(${compared})`) : null,
        ' ',
        h('button', { type: 'button', class: 'link-button', onclick: () => ctx.onLayer(topic.id) }, 'Map it'),
      ),
    );
  }

  // One quote, on UN maps, on the chosen topic if the speech has one.
  const quotes = thisYear?.quotes ?? [];
  const lead = onUnMap ? (quotes.find((q) => q.topic === topic.id) ?? quotes[0]) : null;
  if (lead) {
    // If the speech had nothing to quote on the chosen topic, say which topic this one is on.
    if (lead.topic !== topic.id) parts.push(h('p', { class: 'quote-topic' }, `On ${midSentence(labelOf[lead.topic])}`));
    parts.push(h('blockquote', { class: 'quote', title: labelOf[lead.topic] }, `“${lead.text}”`));
  }

  // Everything else waits behind "Details".
  const hasMore = byYear || (layer.kind === 'indicator' && Object.keys(layer.series(iso)).length) || ctx.stats;
  const actions = [];
  if (hasMore) {
    actions.push(
      h(
        'button',
        { type: 'button', class: 'details-toggle', 'aria-expanded': String(showDetails), onclick: ctx.onToggleDetails },
        showDetails ? 'Less' : 'Details',
        h('span', { 'aria-hidden': 'true' }, showDetails ? '↑' : '↓'),
      ),
    );
  }
  // Every country with figures or speeches has its own page.
  if (byYear || (ctx.stats && Object.keys(ctx.stats).length)) {
    actions.push(
      h('a', { class: 'details-toggle', href: ctx.profileUrl }, 'Full profile', h('span', { 'aria-hidden': 'true' }, '→')),
      h('a', { class: 'details-toggle', href: ctx.compareUrl }, 'Compare'),
    );
  }
  // Who mentions this country? Switches the map to that view.
  if (onUnMap && (!m || m.target !== iso)) {
    actions.push(h('button', { type: 'button', class: 'details-toggle', onclick: () => ctx.onMentions(iso) }, `Who mentions ${todayName}?`));
  }
  if (actions.length) parts.push(h('div', { class: 'card-actions' }, actions));
  if (showDetails && hasMore) parts.push(details(ctx, todayName, quotes, lead, labelOf));

  container.replaceChildren(...parts.filter(Boolean));
}

function details(ctx, todayName, quotes, lead, labelOf) {
  const { iso, year, topics, speeches, nameOf, focus, layer } = ctx;
  const { topic, indicator } = focus;
  const onUnMap = layer.kind !== 'indicator';
  const byYear = speeches.shares[iso];
  const sections = [];

  // Over time: the country against the world.
  const charts = [];
  const statChart = (ind) => {
    const series = ctx.stats?.[ind.id];
    const world = ctx.worldMedians?.[ind.id];
    if (!series || !world || !Object.keys(series).length) return null;
    return h(
      'div',
      {},
      miniChart({
        country: series, world, years: speeches.years, year, onPickYear: ctx.onYear,
        label: `${todayName}'s ${midSentence(ind.label)} over time, against the world median`,
      }),
      h('div', { class: 'chart-caption' }, ind.label),
    );
  };
  const speechChart = () => {
    if (!byYear || !topic) return null;
    const series = {};
    for (const yr of Object.keys(byYear)) series[yr] = topic.value(iso, yr).value;
    return h(
      'div',
      {},
      miniChart({
        country: series, world: topic.world, years: speeches.years, year, onPickYear: ctx.onYear,
        label: `${todayName}'s share of UN speech on ${topic.short} over time, against the world average`,
      }),
      h('div', { class: 'chart-caption' }, `UN speech on ${topic.short}`),
    );
  };
  if (onUnMap) charts.push(speechChart(), indicator ? statChart(indicator) : null);
  else charts.push(statChart(layer), topic ? speechChart() : null);
  if (charts.some(Boolean)) {
    sections.push(
      h('div', {}, h('p', { class: 'section-label' }, `${speeches.years[0]}–${speeches.years[1]} · dashed = world`), h('div', { class: 'charts' }, charts.filter(Boolean))),
    );
  }

  // On a statistic: the rest of its group, so it's one click to the next map.
  if (!onUnMap && ctx.stats) {
    const siblings = Object.values(ctx.indicators).filter((ind) => ind.group === layer.group && ind.id !== layer.id);
    const rows = siblings
      .map((ind) => ({ ind, stat: statAt(ctx.stats, ind, year) }))
      .filter(({ stat }) => stat);
    if (rows.length) {
      sections.push(
        h(
          'div',
          {},
          h('p', { class: 'section-label' }, `More on ${midSentence(layer.group)} · ${year}`),
          h(
            'div',
            { class: 'stat-rows' },
            rows.map(({ ind, stat }) =>
              h(
                'button',
                { type: 'button', class: 'topic-row', title: `Colour the map by ${ind.label.toLowerCase()}`, onclick: () => ctx.onLayer(ind.id) },
                h('span', { class: 'topic-name' }, ind.label),
                h('span', { class: 'rank-value' }, ind.format(stat.value) + (stat.year !== year ? ` (${stat.year})` : '')),
              ),
            ),
          ),
        ),
      );
    }
  }

  // What else they talked about this year.
  const shares = byYear?.[year];
  if (onUnMap && shares) {
    const ranked = topics
      .map((t, i) => ({ ...t, value: shares[i] / 10 }))
      .filter((t) => t.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 6);
    const max = ranked[0]?.value || 1;
    sections.push(
      h(
        'div',
        {},
        h('p', { class: 'section-label' }, `UN speech topics in ${year}`),
        h(
          'div',
          { class: 'topic-rows' },
          ranked.map((t) =>
            h(
              'button',
              {
                type: 'button',
                class: 'topic-row',
                'aria-pressed': String(t.id === topic.id),
                title: `Colour the map by ${t.label}`,
                onclick: () => ctx.onLayer(t.id),
              },
              h('span', { class: 'topic-name' }, t.label),
              h('span', { class: 'meter' }, h('span', { style: `width:${Math.max(3, (t.value / max) * 100).toFixed(0)}%` })),
              h('span', { class: 'rank-value' }, pct(t.value)),
            ),
          ),
        ),
      ),
    );
  }

  const thisYear = ctx.detail?.years[year];
  if (onUnMap && thisYear?.allies.length) {
    sections.push(
      h(
        'div',
        {},
        h('p', { class: 'section-label', title: 'Countries whose speeches covered the most similar ground this year' }, 'Speaks most like'),
        h(
          'div',
          { class: 'chips' },
          thisYear.allies.map(([code]) => h('button', { type: 'button', class: 'chip', onclick: () => ctx.onCountry(code) }, nameOf(code, year))),
        ),
      ),
    );
  }

  const others = onUnMap ? quotes.filter((q) => q !== lead) : [];
  if (others.length) {
    sections.push(
      h(
        'div',
        {},
        h('p', { class: 'section-label' }, 'Also said'),
        others.map((q) => h('blockquote', { class: 'more-quote', title: labelOf[q.topic] }, `“${q.text}”`)),
      ),
    );
  }

  const source = onUnMap ? indicator : layer;
  if (source) sections.push(h('p', { class: 'source' }, `${source.label} (${source.unit}): ${source.source}, via the World Bank.${source.note ? ` ${source.note}` : ''}`));

  return h('div', { class: 'details' }, sections);
}
