// The chart page's axes: turning a measure's values into positions, and
// choosing tidy tick marks.

const percentile = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];

// Measures that span several orders of magnitude (money, population) use a
// log scale, where each step is ten times the last; otherwise nearly every
// country would be squashed into one corner. Percentages and figures that
// can be negative stay linear.
export function scaleKind(indicator, values) {
  if (indicator.format === 'pct' || indicator.signed) return 'linear';
  const sorted = values.filter((v) => v > 0).sort((a, b) => a - b);
  if (sorted.length < values.length || sorted.length < 2) return 'linear';
  return percentile(sorted, 0.95) / percentile(sorted, 0.05) >= 50 ? 'log' : 'linear';
}

// The range an axis covers, fixed across all years so moving through time
// shows real change. Linear axes leave out the most extreme 1% at each end
// (hyperinflation would otherwise flatten everything else).
export function domainOf(values, kind) {
  const sorted = [...values].sort((a, b) => a - b);
  if (kind === 'log') {
    const [low, high] = [sorted[0], sorted.at(-1)];
    return [low / 1.3, high * 1.3];
  }
  const [low, high] = [percentile(sorted, 0.01), percentile(sorted, 0.99)];
  const pad = (high - low) * 0.05 || 1;
  return [low - pad, high + pad];
}

// A scale from `domain` (data) to `range` (pixels). Values outside the domain
// are held at its edge. `scale.ticks()` gives values for tick marks.
export function makeScale(kind, [d0, d1], [r0, r1]) {
  const t = kind === 'log' ? Math.log10 : (v) => v;
  const [t0, t1] = [t(d0), t(d1)];
  const scale = (v) => {
    const clamped = Math.min(d1, Math.max(d0, v));
    return r0 + ((t(clamped) - t0) / (t1 - t0)) * (r1 - r0);
  };
  scale.ticks = () => (kind === 'log' ? logTicks(d0, d1) : linearTicks(d0, d1));
  return scale;
}

// About five round numbers: steps of 1, 2 or 5 times a power of ten.
export function linearTicks(low, high, count = 5) {
  const rough = (high - low) / count;
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 5, 10].map((m) => m * power).find((s) => s >= rough);
  const ticks = [];
  for (let v = Math.ceil(low / step) * step; v <= high + step * 1e-9; v += step) {
    ticks.push(Number(v.toPrecision(12))); // no 0.30000000000000004
  }
  return ticks;
}

// Powers of ten, with 2× and 5× between them when the axis spans only a few.
export function logTicks(low, high) {
  const decades = Math.log10(high / low);
  const multiples = decades <= 3 ? [1, 2, 5] : [1];
  const ticks = [];
  for (let e = Math.floor(Math.log10(low)); e <= Math.ceil(Math.log10(high)); e++) {
    for (const m of multiples) {
      const v = Number((m * 10 ** e).toPrecision(12));
      if (v >= low && v <= high) ticks.push(v);
    }
  }
  return ticks;
}
