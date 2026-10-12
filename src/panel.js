// The small pop-overs: the top-10 list and the country card.
import { miniChart } from './chart.js';

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

const pct = (v) => `${v.toFixed(1)}%`;
// Lower-case a label for use mid-sentence, unless it starts with an acronym (CO₂, UN).
const midSentence = (text) => (/^[A-Z]{2}/.test(text) ? text : text.charAt(0).toLowerCase() + text.slice(1));

// "3.6× world avg", "+40% vs world avg", "≈ world avg", "−40% vs world avg".
function versus(value, typical, what) {
  if (!(typical > 0)) return '';
  const ratio = value / typical;
  if (ratio >= 1.95) return `${ratio.toFixed(1)}× ${what}`;
  if (ratio >= 1.1) return `+${Math.round((ratio - 1) * 100)}% vs ${what}`;
  if (ratio > 0.9) return `≈ ${what}`;
  return `−${Math.round((1 - ratio) * 100)}% vs ${what}`;
}

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

export function renderRankings(container, { layer, year, rows, nameOf, onCountry }) {
  const top = rows.slice(0, 10);
  container.replaceChildren(
    h('p', { class: 'popover-title' }, `Highest · ${year}`),
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
  );
}

// ---- Country card -----------------------------------------------------------

export function renderCard(container, ctx) {
  const { iso, year, topics, speeches, detail, continent, nameOf, focus, showDetails } = ctx;
  const { topic, indicator } = focus;
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
    name !== todayName ? h('p', { class: 'card-note' }, `Seat now held by ${todayName}`) : null,
  ];

  // The two headline numbers: what they said, and what the numbers show.
  const metrics = [];
  if (byYear) {
    const now = topic.value(iso, year);
    metrics.push(
      h(
        'div',
        {},
        h('div', { class: 'metric-value' }, now ? pct(now.value) : '—'),
        h('div', { class: 'metric-label' }, now ? `of speech on ${topic.short}` : `No speech in ${year}`),
        now ? h('div', { class: 'metric-compare' }, versus(now.value, worldAt(topic, year), 'world avg')) : null,
      ),
    );
  }
  if (indicator) {
    const now = indicator.ready ? indicator.value(iso, year) : null;
    metrics.push(
      h(
        'div',
        {},
        h('div', { class: 'metric-value' }, now ? indicator.format(now.value) : '—'),
        h('div', { class: 'metric-label' }, indicator.label),
        h(
          'div',
          { class: 'metric-compare' },
          !indicator.ready
            ? 'Loading…'
            : now
              ? [versus(now.value, worldAt(indicator, now.year), 'median'), now.year !== year ? ` (${now.year})` : '']
              : `No figure for ${year}`,
        ),
      ),
    );
  }
  if (metrics.length) parts.push(h('div', { class: 'metrics' }, metrics));
  else parts.push(h('p', { class: 'card-note' }, 'No speeches or figures for this place.'));

  // One quote, on the chosen topic if the speech has one.
  const quotes = thisYear?.quotes ?? [];
  const lead = quotes.find((q) => q.topic === topic.id) ?? quotes[0];
  if (lead) parts.push(h('blockquote', { class: 'quote', title: labelOf[lead.topic] }, `“${lead.text}”`));

  // Everything else waits behind "Details".
  const hasMore = byYear || (indicator?.ready && Object.keys(indicator.series(iso)).length);
  if (hasMore) {
    parts.push(
      h(
        'button',
        { type: 'button', class: 'details-toggle', 'aria-expanded': String(showDetails), onclick: ctx.onToggleDetails },
        showDetails ? 'Less' : 'Details',
        h('span', { 'aria-hidden': 'true' }, showDetails ? '↑' : '↓'),
      ),
    );
  }
  if (showDetails && hasMore) parts.push(details(ctx, todayName, quotes, lead, labelOf));

  container.replaceChildren(...parts.filter(Boolean));
}

function details(ctx, todayName, quotes, lead, labelOf) {
  const { iso, year, topics, speeches, nameOf, focus } = ctx;
  const { topic, indicator } = focus;
  const byYear = speeches.shares[iso];
  const sections = [];

  // Over time: the country against the world.
  const charts = [];
  if (byYear) {
    const series = {};
    for (const yr of Object.keys(byYear)) series[yr] = topic.value(iso, yr).value;
    charts.push(
      h(
        'div',
        {},
        miniChart({
          country: series, world: topic.world, years: speeches.years, year, onPickYear: ctx.onYear,
          label: `${todayName}'s share of speech on ${topic.short} over time, against the world average`,
        }),
        h('div', { class: 'chart-caption' }, `Speech on ${topic.short}`),
      ),
    );
  }
  if (indicator?.ready && Object.keys(indicator.series(iso)).length) {
    charts.push(
      h(
        'div',
        {},
        miniChart({
          country: indicator.series(iso), world: indicator.world, years: speeches.years, year, onPickYear: ctx.onYear,
          label: `${todayName}'s ${midSentence(indicator.label)} over time, against the world median`,
        }),
        h('div', { class: 'chart-caption' }, indicator.label),
      ),
    );
  }
  if (charts.length) {
    sections.push(
      h('div', {}, h('p', { class: 'section-label' }, `${speeches.years[0]}–${speeches.years[1]} · dashed = world`), h('div', { class: 'charts' }, charts)),
    );
  }

  // What else they talked about this year.
  const shares = byYear?.[year];
  if (shares) {
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
        h('p', { class: 'section-label' }, `Topics in ${year}`),
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
  if (thisYear?.allies.length) {
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

  const others = quotes.filter((q) => q !== lead);
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

  if (indicator) sections.push(h('p', { class: 'source' }, `${indicator.label}: ${indicator.source}, via the World Bank.`));

  return h('div', { class: 'details' }, sections);
}
