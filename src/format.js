// Writing numbers the same way everywhere: the map, the rankings and compare
// pages, and the country pages built ahead of time.

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumSignificantDigits: 3 });

// `format` and `suffix` come from pipeline/build_indicators.py:
// "usd" -> $48.2K, "pct" -> 12.5%, "number" -> 72.8 yrs, 1.42B, 4.63 t.
export function formatter({ format, suffix = '' }) {
  if (format === 'usd') return (v) => `${v < 0 ? '−' : ''}$${compact.format(Math.abs(v))}`;
  if (format === 'pct') return (v) => `${Math.abs(v) < 10 ? v.toFixed(1) : Math.round(v)}%`;
  return (v) => `${compact.format(v)}${suffix}`;
}

// "3.6× world avg", "+40% vs world avg", "≈ world avg", "−40% vs world avg".
// Only meaningful for positive figures (not growth or inflation, which can be negative).
export function versus(value, typical, what) {
  if (!(typical > 0) || value < 0) return '';
  const ratio = value / typical;
  if (ratio >= 1.95) return `${ratio.toFixed(1)}× ${what}`;
  if (ratio >= 1.1) return `+${Math.round((ratio - 1) * 100)}% vs ${what}`;
  if (ratio > 0.9) return `≈ ${what}`;
  return `−${Math.round((1 - ratio) * 100)}% vs ${what}`;
}

// How a figure compares with the median country, for any indicator. Growth
// and inflation (`signed`) show the median itself: "+36% vs median" of a growth
// rate would be a percentage of a percentage.
export function againstMedian(indicator, format, value, median, what = 'median') {
  if (median === undefined) return '';
  return indicator.signed ? `${what} ${format(median)}` : versus(value, median, what);
}

// The latest figure in a series (year -> value), as { year, value }.
export function latest(series) {
  const years = Object.keys(series ?? {}).map(Number);
  if (!years.length) return null;
  const year = Math.max(...years);
  return { year, value: series[year] };
}

// Groups of indicators in the order they first appear, as [label, indicators].
export function grouped(indicators) {
  const groups = new Map();
  for (const indicator of indicators) {
    if (!groups.has(indicator.group)) groups.set(indicator.group, []);
    groups.get(indicator.group).push(indicator);
  }
  return [...groups];
}

// "2026-10-20" -> "20 October 2026", for "figures last updated".
export const longDate = (iso) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

// The three figures shown first for any country.
export const KEY_FACTS = ['population', 'gdp_pc', 'life_exp'];
