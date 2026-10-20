import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chartRange, linePath } from '../src/chart.js';

// The y coordinates in an SVG path.
const ys = (d) => [...d.matchAll(/,(-?[\d.]+)/g)].map((m) => Number(m[1]));

test('negative figures stay inside the chart', () => {
  // Greece's growth: deep recessions and recoveries.
  const series = { 2005: 2.3, 2009: -4.3, 2011: -10.1, 2017: 1.5, 2021: 8.4 };
  const { bottom, top } = chartRange(series);
  assert.ok(bottom < 0);
  for (const y of ys(linePath(series, [2000, 2025], top, 300, 80, bottom))) {
    assert.ok(y >= 0 && y <= 80, `y=${y} is outside the 80px chart`);
  }
});

test('positive figures start from zero at the bottom edge', () => {
  const { bottom, top } = chartRange({ 2000: 10, 2001: 20 });
  assert.equal(bottom, 0);
  assert.ok(top > 20);
  assert.equal(linePath({ 2000: 0 }, [2000, 2001], top, 100, 50, bottom), 'M0.0,50.0');
});

test('long gaps break the line, short ones are bridged', () => {
  const moves = (d) => d.split('M').length - 1;
  assert.equal(moves(linePath({ 2000: 1, 2004: 2 }, [2000, 2020], 2, 100, 10)), 1);
  assert.equal(moves(linePath({ 2000: 1, 2010: 2 }, [2000, 2020], 2, 100, 10)), 2);
});
