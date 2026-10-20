import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeNamer, slugOf, speakerLabel, withThe } from '../src/data.js';
import { makeSearch } from '../src/search.js';

const shapes = {
  features: [
    ['RUS', 'Russia'],
    ['GBR', 'United Kingdom'],
    ['CIV', "Côte d'Ivoire"],
    ['DEU', 'Germany'],
    ['COD', 'Democratic Republic of the Congo'],
    ['COG', 'Republic of the Congo'],
  ].map(([iso3, name]) => ({ properties: { iso3, name } })),
};
const nameOf = makeNamer(shapes);

test('page addresses are plain and readable', () => {
  assert.equal(slugOf("Côte d'Ivoire"), 'cote-divoire');
  assert.equal(slugOf('Bosnia and Herzegovina'), 'bosnia-and-herzegovina');
  assert.equal(slugOf('São Tomé and Príncipe'), 'sao-tome-and-principe');
});

test('UN seats go by their name at the time', () => {
  assert.equal(nameOf('RUS', 1985), 'Soviet Union');
  assert.equal(nameOf('RUS', 1992), 'Russia');
  assert.equal(nameOf('DEU', 1990), 'West Germany');
  assert.equal(nameOf('YUG', 1995), 'Yugoslavia');
  assert.equal(nameOf('YUG', 2004), 'Serbia and Montenegro');
  assert.equal(nameOf('CSK', 1980), 'Czechoslovakia');
  assert.equal(nameOf('XXX', 2000), 'XXX');
});

test('speaker titles are cut to the main role', () => {
  assert.equal(speakerLabel(['Mr. Frank Bainimarama', 'Prime Minister and Minister for Finance, Economic Growth']), 'Prime Minister Frank Bainimarama');
  assert.equal(speakerLabel(['Jane Doe', null]), 'Jane Doe');
  assert.equal(speakerLabel(undefined), null);
});

test('"the" goes in front of names that need it', () => {
  assert.equal(withThe('United Kingdom'), 'the United Kingdom');
  assert.equal(withThe('Solomon Islands'), 'the Solomon Islands');
  assert.equal(withThe('France'), 'France');
});

test('country search finds short, accented and former names', () => {
  const find = makeSearch(['RUS', 'GBR', 'CIV', 'DEU', 'COD', 'COG'], nameOf);
  const first = (q) => find(q)[0]?.iso;
  assert.equal(first('UK'), 'GBR');
  assert.equal(first('britain'), 'GBR');
  assert.equal(first('cote'), 'CIV');
  assert.equal(first('USSR'), 'RUS');
  assert.equal(first('soviet'), 'RUS');
  assert.equal(first('West Germany'), 'DEU');
  assert.equal(first('DRC'), 'COD');
  // An exact name beats a name that merely contains it.
  assert.deepEqual(find('congo').map((m) => m.iso).sort(), ['COD', 'COG']);
  assert.deepEqual(find('   '), []);
});
