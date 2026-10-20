// Which countries "Guess the Country" asks on which day. Kept apart from the
// page so it can be tested: changing it changes every player's game, so the
// schedule is checked against a saved copy (tests/game.test.js).

// Game #1 is on this day; each day after is the next number.
export const FIRST_DAY = new Date(2026, 9, 19);

// A small seeded random generator: the same seed always gives the same sequence.
export function random(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle(items, rand) {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// Today's game number, counted in the player's own time zone.
export function gameNumber(date = new Date()) {
  const today = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.max(1, Math.round((today - FIRST_DAY) / 86400000) + 1);
}

// The five answers for a game: one from each tier. Each tier is worked
// through in a shuffled order, so a country doesn't come back until the rest
// of its tier has had a turn.
export function answersFor(tiers, number) {
  return tiers.map((tier, t) => {
    const day = number - 1;
    const cycle = Math.floor(day / tier.length);
    return shuffle(tier, random((t + 1) * 100003 + cycle))[day % tier.length];
  });
}
