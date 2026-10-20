// Small, axis-free line charts drawn as SVG: the mini charts in the country
// panel and the world trend inside the timeline.

const SVG = 'http://www.w3.org/2000/svg';
const W = 300;
const H = 80;

function el(name, attrs = {}) {
  const node = document.createElementNS(SVG, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

// Gaps up to this many years are bridged, since some figures (migrants,
// surveys) are only published every few years. Longer gaps break the line.
export const MAX_GAP = 5;

// An SVG path through `series` (year -> value), broken where years are missing.
// Values run from `bottom` (the lower edge) to `top`; `bottom` is below zero for
// figures that can be negative, such as growth and inflation.
export function linePath(series, [first, last], top, w, h, bottom = 0) {
  let d = '';
  let drawing = false;
  let lastSeen = -Infinity;
  for (let year = first; year <= last; year++) {
    const v = series[year];
    if (v === undefined) continue;
    if (year - lastSeen > MAX_GAP) drawing = false;
    lastSeen = year;
    const x = ((year - first) / (last - first)) * w;
    const y = h - ((Math.min(v, top) - bottom) / (top - bottom)) * h;
    d += `${drawing ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
    drawing = true;
  }
  return d;
}

// The range a chart needs to show every value: from zero (or the lowest value,
// if any are negative) up to a little above the highest.
export function chartRange(...serieses) {
  const values = serieses.flatMap((series) => Object.values(series));
  const bottom = Math.min(0, ...values);
  const top = Math.max(...values, 1e-9);
  return { bottom, top: top + (top - bottom) * 0.08 };
}

// A country's line against the world's, with the chosen year marked.
// Clicking the chart jumps to that year.
export function miniChart({ country, world, years, year, label, onPickYear }) {
  const { bottom, top } = chartRange(country, world);
  const svg = el('svg', {
    viewBox: `0 0 ${W} ${H}`,
    preserveAspectRatio: 'none',
    class: 'mini-chart',
    role: 'img',
    'aria-label': label,
  });
  const x = ((year - years[0]) / (years[1] - years[0])) * W;
  // A zero line, when some values fall below it.
  const zeroY = H - (-bottom / (top - bottom)) * H;
  svg.append(
    el('line', { x1: x, x2: x, y1: 0, y2: H, class: 'mini-now' }),
    bottom < 0 ? el('line', { x1: 0, x2: W, y1: zeroY, y2: zeroY, class: 'mini-zero' }) : '',
    el('path', { d: linePath(world, years, top, W, H, bottom), class: 'mini-world' }),
    el('path', { d: linePath(country, years, top, W, H, bottom), class: 'mini-country' }),
  );
  svg.addEventListener('click', (e) => {
    const box = svg.getBoundingClientRect();
    const picked = Math.round(years[0] + ((e.clientX - box.left) / box.width) * (years[1] - years[0]));
    onPickYear(Math.min(years[1], Math.max(years[0], picked)));
  });
  return svg;
}

// Fill the timeline's background chart with the world trend for the chosen layer.
export function drawSparkline(svg, world, years) {
  const { bottom, top } = chartRange(world);
  const line = linePath(world, years, top, 1000, 40, bottom);
  // The filled area: each unbroken stretch of line, closed down to the baseline.
  const area = line
    .split('M')
    .filter(Boolean)
    .map((segment) => {
      const startX = segment.split(',')[0];
      const endX = segment.split('L').at(-1).split(',')[0];
      return `M${startX},40L${segment}L${endX},40Z`;
    })
    .join('');
  svg.replaceChildren(el('path', { d: area, class: 'spark-area' }), el('path', { d: line, class: 'spark-line' }));
}
