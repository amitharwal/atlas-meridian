// The side panel describing one country in one year.
import { topicChart } from './chart.js';

// Tiny element builder; text always goes in as text, never as HTML.
function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  node.append(...children.filter((c) => c !== null && c !== undefined));
  return node;
}

const pct = (tenths) => `${(tenths / 10).toFixed(1)}%`;

function topicBars({ shares, topics, topic, onTopic }) {
  const ranked = topics.map((t, i) => ({ ...t, value: shares[i] })).sort((a, b) => b.value - a.value);
  const shown = ranked.slice(0, 6).filter((t) => t.value > 0);
  // Always show the topic the map is coloured by, even if it's small here.
  if (!shown.some((t) => t.id === topic)) shown.push(ranked.find((t) => t.id === topic));
  const max = Math.max(...shown.map((t) => t.value), 1);

  return h(
    'ul',
    { class: 'bars' },
    ...shown.map((t) =>
      h(
        'li',
        {},
        h(
          'button',
          {
            type: 'button',
            class: t.id === topic ? 'bar is-current' : 'bar',
            title: `Colour the map by ${t.label}`,
            onclick: () => onTopic(t.id),
          },
          h('span', { class: 'bar-label' }, t.label),
          h('span', { class: 'bar-value' }, pct(t.value)),
          h('span', { class: 'bar-fill', style: `width:${(t.value / max) * 100}%` }),
        ),
      ),
    ),
  );
}

export function renderPanel(container, ctx) {
  const { iso, year, topic, topics, speeches, detail, continent, nameOf, worldSeries } = ctx;
  const topicIndex = topics.findIndex((t) => t.id === topic);
  const topicLabel = topics[topicIndex].label;
  const byYear = speeches.shares[iso];
  const shares = byYear?.[year];
  const name = nameOf(iso, year);
  const todayName = nameOf(iso, 9999);

  const body = [
    h('p', { class: 'panel-kicker' }, [continent, year].filter(Boolean).join(' · ')),
    h('h2', {}, name),
  ];
  if (name !== todayName) {
    body.push(h('p', { class: 'panel-note' }, `This UN seat is now held by ${todayName}.`));
  }

  if (!byYear) {
    body.push(h('p', { class: 'panel-empty' }, 'There are no General Debate speeches for this place in the dataset.'));
    container.replaceChildren(...body);
    return;
  }

  if (shares) {
    const ceremonial = 1000 - shares.reduce((a, b) => a + b, 0);
    body.push(
      h('h3', {}, `What they talked about in ${year}`),
      topicBars({ shares, topics, topic, onTopic: ctx.onTopic }),
      h('p', { class: 'panel-hint' }, `The other ${pct(ceremonial)} was ceremonial or didn't fit a topic.`),
    );
  } else {
    body.push(h('p', { class: 'panel-empty' }, `No speech on record for ${year}.`));
  }

  // The chart: this country vs. the world on the current topic, every year.
  const country = {};
  for (const [yr, values] of Object.entries(byYear)) country[yr] = values[topicIndex] / 10;
  body.push(
    h('h3', {}, `${topicLabel} over time`),
    topicChart({ country, world: worldSeries, years: speeches.years, year, onPickYear: ctx.onYear }),
    h(
      'p',
      { class: 'chart-key' },
      h('span', { class: 'key-country' }), name === todayName ? name : todayName,
      h('span', { class: 'key-world' }), 'World average',
      h('span', { class: 'chart-key-hint' }, 'Click the chart to change year'),
    ),
  );

  const thisYear = detail?.years[year];
  if (detail === null) {
    body.push(h('p', { class: 'panel-hint' }, 'Loading quotes…'));
  } else if (thisYear) {
    if (thisYear.allies.length) {
      body.push(
        h('h3', {}, 'Speaks most like'),
        h(
          'ul',
          { class: 'allies' },
          ...thisYear.allies.map(([code]) =>
            h('li', {}, h('button', { type: 'button', class: 'chip', onclick: () => ctx.onCountry(code) }, nameOf(code, year))),
          ),
        ),
        h('p', { class: 'panel-hint' }, 'Countries whose speeches covered the most similar ground this year.'),
      );
    }
    if (thisYear.quotes.length) {
      const labelOf = Object.fromEntries(topics.map((t) => [t.id, t.label]));
      body.push(
        h('h3', {}, 'In their own words'),
        ...thisYear.quotes.map((q) =>
          h('figure', { class: 'quote' }, h('blockquote', {}, `“${q.text}”`), h('figcaption', {}, labelOf[q.topic])),
        ),
      );
    }
  }

  container.replaceChildren(...body);
}
