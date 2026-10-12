// A small line chart of one topic over the years: the country against the world average.

const W = 292;
const H = 110;
const PAD = { top: 10, right: 6, bottom: 18, left: 30 };
const SVG = 'http://www.w3.org/2000/svg';

function el(name, attrs = {}, text) {
  const node = document.createElementNS(SVG, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text !== undefined) node.textContent = text;
  return node;
}

// `country` and `world` map year -> percent; years without a speech are missing.
export function topicChart({ country, world, years, year, onPickYear }) {
  const [first, last] = years;
  const top = Math.max(5, ...Object.values(country), ...Object.values(world)) * 1.1;
  const x = (y) => PAD.left + ((y - first) / (last - first)) * (W - PAD.left - PAD.right);
  const y = (v) => H - PAD.bottom - (v / top) * (H - PAD.top - PAD.bottom);

  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img' });

  for (const v of [0, Math.round(top / 2)]) {
    svg.append(el('line', { x1: PAD.left, x2: W - PAD.right, y1: y(v), y2: y(v), class: 'chart-grid' }));
    svg.append(el('text', { x: PAD.left - 5, y: y(v) + 3, class: 'chart-axis', 'text-anchor': 'end' }, `${v}%`));
  }
  for (const [label, anchor] of [[first, 'start'], [1985, 'middle'], [last, 'end']]) {
    svg.append(el('text', { x: x(label), y: H - 4, class: 'chart-axis', 'text-anchor': anchor }, label));
  }

  // Break the line wherever a year has no speech, rather than drawing across the gap.
  const path = (series) => {
    let d = '';
    let drawing = false;
    for (let yr = first; yr <= last; yr++) {
      if (series[yr] === undefined) {
        drawing = false;
        continue;
      }
      d += `${drawing ? 'L' : 'M'}${x(yr).toFixed(1)},${y(series[yr]).toFixed(1)}`;
      drawing = true;
    }
    return d;
  };
  svg.append(el('path', { d: path(world), class: 'chart-world' }));
  svg.append(el('path', { d: path(country), class: 'chart-country' }));

  svg.append(el('line', { x1: x(year), x2: x(year), y1: PAD.top, y2: H - PAD.bottom, class: 'chart-now' }));
  if (country[year] !== undefined) {
    svg.append(el('circle', { cx: x(year), cy: y(country[year]), r: 3.5, class: 'chart-dot' }));
  }

  // Clicking the chart jumps the whole map to that year.
  svg.addEventListener('click', (e) => {
    const box = svg.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * W;
    const picked = Math.round(first + ((px - PAD.left) / (W - PAD.left - PAD.right)) * (last - first));
    onPickYear(Math.min(last, Math.max(first, picked)));
  });

  return svg;
}
