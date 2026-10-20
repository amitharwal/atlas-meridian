// Checks on the generated data in public/data, so a bad download or a broken
// pipeline is caught before the site is published.
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { feature } from 'topojson-client';
import { makeNamer, shapeInfo, slugOf } from '../src/data.js';
import { makeLayers, yearRange } from '../src/layers.js';

const read = (path) => JSON.parse(readFileSync(`public/data/${path}`, 'utf8'));
const indicators = read('indicators/index.json');
const topics = read('topics.json');
const speeches = read('speeches.json');
const regions = read('regions.json');
const topology = read('countries.topo.json');
const countries = feature(topology, topology.objects.countries);
const nameOf = makeNamer(countries);
const thisYear = new Date().getFullYear();

test('every indicator has a full data file and a world median', () => {
  const world = read('indicators/world.json');
  const ids = indicators.map((i) => i.id);
  assert.equal(new Set(ids).size, ids.length, 'two indicators share an id');
  for (const ind of indicators) {
    for (const key of ['id', 'code', 'label', 'unit', 'format', 'group', 'source', 'years']) {
      assert.ok(ind[key] !== undefined, `${ind.id} has no ${key}`);
    }
    const file = read(`indicators/${ind.id}.json`);
    const count = Object.keys(file.values).length;
    assert.ok(count >= 100, `${ind.id}: only ${count} countries`);
    assert.deepEqual(file.years, ind.years, `${ind.id}: years differ from the index`);
    assert.ok(ind.years[0] >= 1960 && ind.years[1] <= thisYear && ind.years[1] >= thisYear - 8, `${ind.id}: odd years ${ind.years}`);
    assert.ok(Object.keys(world[ind.id] ?? {}).length > 0, `${ind.id} has no world median`);
  }
});

test('indicators and speech topics fit together', async () => {
  const layers = makeLayers({ topics, speeches, indicators, years: speeches.years });
  const topicIds = new Set(topics.map((t) => t.id));
  const pairs = indicators.filter((i) => i.pairs).map((i) => i.pairs);
  assert.equal(new Set(pairs).size, pairs.length, 'a topic is paired with two indicators');
  for (const pair of pairs) assert.ok(topicIds.has(pair), `pairs with unknown topic ${pair}`);
  assert.equal(layers.speaker.years[1], speeches.years[1], 'speaker map stops before the latest speeches');
  // Speech maps fill in once the speeches are loaded, all at once.
  assert.equal(layers.peace.ready, false);
  await layers.climate.load();
  for (const topic of topics) {
    const layer = layers[topic.id];
    assert.ok(layer.ready && layer.stops.length === 5 && Object.keys(layer.world).length > 50, `${topic.id} wasn't filled in`);
  }
  assert.ok(layers.climate.value('FJI', 2021).value > 0);
  assert.equal(layers.climate.value('FJI', 1950), null);
  for (const shares of Object.values(speeches.shares)) {
    for (const values of Object.values(shares)) assert.equal(values.length, topics.length);
  }
});

test('every country file and region belongs to a known place', () => {
  const stats = readdirSync('public/data/stats').map((f) => f.replace('.json', ''));
  assert.ok(stats.length >= 200, `only ${stats.length} country files`);
  for (const iso of stats) assert.ok(regions[iso], `stats/${iso}.json has no region`);
  for (const iso of Object.keys(speeches.shares)) assert.ok(existsSync(`public/data/countries/${iso}.json`), `no speech detail for ${iso}`);
});

test('every country page gets its own address', () => {
  const codes = [...new Set([...Object.keys(speeches.shares), ...Object.keys(regions)])].filter((iso) => nameOf(iso, 9999) !== iso);
  const seen = {};
  for (const iso of codes) {
    const slug = slugOf(nameOf(iso, 9999));
    assert.ok(slug, `${iso} has an empty address`);
    assert.ok(!seen[slug], `${iso} and ${seen[slug]} share the address ${slug}`);
    seen[slug] = iso;
  }
});

test('every game answer is on the map and has a name', () => {
  const { centreOf } = shapeInfo(countries);
  const { tiers } = read('game.json');
  for (const iso of tiers.flat()) {
    assert.ok(centreOf[iso], `${iso} has no shape`);
    assert.notEqual(nameOf(iso, 9999), iso, `${iso} has no name`);
  }
});

test('the year slider stays within what a measure covers', () => {
  const timeline = speeches.years;
  assert.deepEqual(yearRange({}, timeline), timeline);
  assert.deepEqual(yearRange({ years: [1960, 2024] }, [1946, 2025]), [1960, 2024]);
  assert.deepEqual(yearRange({ years: [1940, 2030] }, [1946, 2025]), [1946, 2025]);
});
