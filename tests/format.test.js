import assert from 'node:assert/strict';
import { test } from 'node:test';
import { againstMedian, formatter, grouped, latest, longDate, versus } from '../src/format.js';

test('money is written short, with the sign in front', () => {
  const usd = formatter({ format: 'usd' });
  assert.equal(usd(48200), '$48.2K');
  assert.equal(usd(1.42e12), '$1.42T');
  assert.equal(usd(-3500), '−$3.5K');
});

test('percentages keep one decimal below 10', () => {
  const pct = formatter({ format: 'pct' });
  assert.equal(pct(3.14), '3.1%');
  assert.equal(pct(-2.5), '-2.5%');
  assert.equal(pct(42.6), '43%');
});

test('plain numbers get their suffix', () => {
  assert.equal(formatter({ format: 'number', suffix: ' yrs' })(72.84), '72.8 yrs');
  assert.equal(formatter({ format: 'number' })(1.42e9), '1.42B');
});

test('versus compares with the typical figure', () => {
  assert.equal(versus(3.6, 1, 'world avg'), '3.6× world avg');
  assert.equal(versus(1.4, 1, 'world avg'), '+40% vs world avg');
  assert.equal(versus(1.05, 1, 'world avg'), '≈ world avg');
  assert.equal(versus(0.6, 1, 'world avg'), '−40% vs world avg');
  // Meaningless for negative figures or a missing median.
  assert.equal(versus(-1, 1, 'median'), '');
  assert.equal(versus(1, undefined, 'median'), '');
});

test('figures that can be negative show the median itself', () => {
  const format = formatter({ format: 'pct' });
  assert.equal(againstMedian({ signed: true }, format, 5, 3.1), 'median 3.1%');
  assert.equal(againstMedian({}, format, 2, 1), '2.0× median');
  assert.equal(againstMedian({}, format, 2, undefined), '');
});

test('latest finds the newest year', () => {
  assert.deepEqual(latest({ 2001: 5, 2019: 7, 2010: 6 }), { year: 2019, value: 7 });
  assert.equal(latest({}), null);
  assert.equal(latest(undefined), null);
});

test('grouped keeps groups in the order they first appear', () => {
  const groups = grouped([{ id: 'a', group: 'X' }, { id: 'b', group: 'Y' }, { id: 'c', group: 'X' }]);
  assert.deepEqual(groups.map(([title, items]) => [title, items.map((i) => i.id)]), [['X', ['a', 'c']], ['Y', ['b']]]);
});

test('update dates are written out in full', () => {
  assert.equal(longDate('2026-10-03'), '3 October 2026');
  assert.equal(longDate('2027-01-31'), '31 January 2027');
});
