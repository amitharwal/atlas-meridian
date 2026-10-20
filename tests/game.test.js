import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { test } from 'node:test';
import { answersFor, gameNumber } from '../src/game.js';

const { tiers } = JSON.parse(readFileSync('public/data/game.json', 'utf8'));
const FIXTURE = new URL('./fixtures/game-schedule.json', import.meta.url);
const GAMES = 400;

// Every player gets the same game on the same day, and a game played yesterday
// must still show the same countries today. So the schedule is compared with a
// saved copy. If you changed the tiers on purpose (npm run build:game), delete
// tests/fixtures/game-schedule.json and run the tests again to save the new one.
test('the daily schedule has not changed', (t) => {
  const schedule = Array.from({ length: GAMES }, (_, i) => answersFor(tiers, i + 1));
  if (!existsSync(FIXTURE)) {
    writeFileSync(FIXTURE, `${JSON.stringify(schedule)}\n`);
    t.diagnostic('Saved a new copy of the schedule');
    return;
  }
  const saved = JSON.parse(readFileSync(FIXTURE, 'utf8'));
  const changed = saved.findIndex((answers, i) => answers.join() !== schedule[i].join());
  assert.equal(changed, -1, `Game #${changed + 1} would change from ${saved[changed]} to ${schedule[changed]}`);
});

test('each game has one country from each tier, easiest first', () => {
  for (let n = 1; n <= GAMES; n++) {
    answersFor(tiers, n).forEach((iso, t) => assert.ok(tiers[t].includes(iso), `#${n} round ${t + 1}: ${iso}`));
  }
});

test('a country does not come back until its whole tier has had a turn', () => {
  tiers.forEach((tier, t) => {
    const seen = Array.from({ length: tier.length }, (_, i) => answersFor(tiers, i + 1)[t]);
    assert.equal(new Set(seen).size, tier.length, `tier ${t + 1} repeats a country within one cycle`);
  });
});

test('game numbers follow the local calendar day, across clock changes', () => {
  assert.equal(gameNumber(new Date(2026, 9, 19, 0, 1)), 1);
  assert.equal(gameNumber(new Date(2026, 9, 19, 23, 59)), 1);
  assert.equal(gameNumber(new Date(2026, 9, 20, 0, 1)), 2);
  // Spanning both European and American daylight-saving changes.
  assert.equal(gameNumber(new Date(2026, 10, 2, 12)), 15);
  assert.equal(gameNumber(new Date(2027, 3, 1, 12)), 165);
  // Before launch it's game #1, never zero or negative.
  assert.equal(gameNumber(new Date(2025, 0, 1)), 1);
});
