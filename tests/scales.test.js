import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { domainOf, linearTicks, logTicks, makeScale, scaleKind } from '../src/scales.js';

const indicators = JSON.parse(readFileSync('public/data/indicators/index.json', 'utf8'));
const valuesOf = (id) => Object.values(JSON.parse(readFileSync(`public/data/indicators/${id}.json`, 'utf8')).values).flatMap(Object.values);

test('money and population use a log scale; percentages and signed figures do not', () => {
  const kind = (id) => scaleKind(indicators.find((i) => i.id === id), valuesOf(id));
  assert.equal(kind('gdp_pc'), 'log');
  assert.equal(kind('population'), 'log');
  assert.equal(kind('life_exp'), 'linear');
  assert.equal(kind('internet'), 'linear');
  assert.equal(kind('growth'), 'linear');
  assert.equal(kind('inflation'), 'linear');
});

test('a log scale puts each power of ten the same distance apart', () => {
  const x = makeScale('log', [1, 1000], [0, 300]);
  assert.equal(x(1), 0);
  assert.equal(x(10), 100);
  assert.equal(x(1000), 300);
  // Values outside the range are held at the edge.
  assert.equal(x(5000), 300);
});

test('a linear scale can run upwards on screen', () => {
  const y = makeScale('linear', [40, 90], [400, 0]);
  assert.equal(y(40), 400);
  assert.equal(y(90), 0);
  assert.equal(y(65), 200);
});

test('ticks are round numbers inside the axis', () => {
  assert.deepEqual(linearTicks(41.2, 88.7), [50, 60, 70, 80]);
  assert.deepEqual(linearTicks(-6, 14), [-5, 0, 5, 10]);
  assert.deepEqual(linearTicks(0, 1), [0, 0.2, 0.4, 0.6, 0.8, 1]);
  assert.deepEqual(logTicks(150, 200000), [1000, 10000, 100000]);
  assert.deepEqual(logTicks(3, 400), [5, 10, 20, 50, 100, 200]);
});

test('a linear axis leaves out the most extreme values', () => {
  const values = [...Array.from({ length: 1000 }, (_, i) => i / 10), 1e6];
  const [low, high] = domainOf(values, 'linear');
  assert.ok(low < 1 && high < 200, `got ${low}–${high}`);
});
