// Sorts the 193 UN member states into five difficulty tiers for the daily
// "Guess the Country" game, and writes public/data/game.json.
//
// A country's score mixes how big it looks on the map (land area, measured from
// our own shapes), its population and the size of its economy: big, populous,
// well-known countries are easiest. To move a country by hand, add it to MOVES.
//
// Run by hand after reviewing (`npm run build:game`), not on every build, so
// the monthly data refresh never reshuffles the game's schedule.
import { readFileSync, writeFileSync } from 'node:fs';
import { feature } from 'topojson-client';

// Hand adjustments: ISO code -> tier (1 = easiest, 5 = hardest).
const MOVES = {};

// The 193 UN member states.
const UN_MEMBERS = `AFG ALB DZA AND AGO ATG ARG ARM AUS AUT AZE BHS BHR BGD BRB BLR BEL BLZ BEN BTN BOL BIH BWA BRA BRN BGR BFA BDI
CPV KHM CMR CAN CAF TCD CHL CHN COL COM COG COD CRI CIV HRV CUB CYP CZE PRK DNK DJI DMA DOM ECU EGY SLV GNQ ERI EST SWZ ETH
FJI FIN FRA GAB GMB GEO DEU GHA GRC GRD GTM GIN GNB GUY HTI HND HUN ISL IND IDN IRN IRQ IRL ISR ITA JAM JPN JOR KAZ KEN KIR
KWT KGZ LAO LVA LBN LSO LBR LBY LIE LTU LUX MDG MWI MYS MDV MLI MLT MHL MRT MUS MEX FSM MCO MNG MNE MAR MOZ MMR NAM NRU NPL
NLD NZL NIC NER NGA MKD NOR OMN PAK PLW PAN PNG PRY PER PHL POL PRT QAT KOR MDA ROU RUS RWA KNA LCA VCT WSM SMR STP SAU SEN
SRB SYC SLE SGP SVK SVN SLB SOM ZAF SSD ESP LKA SDN SUR SWE CHE SYR TJK THA TLS TGO TON TTO TUN TUR TKM TUV UGA UKR ARE GBR
TZA USA URY UZB VUT VEN VNM YEM ZMB ZWE`.split(/\s+/);

const WEIGHTS = { area: 0.5, population: 0.25, gdp: 0.25 };
const TIERS = 5;

const read = (path) => JSON.parse(readFileSync(`public/data/${path}`, 'utf8'));
const topology = read('countries.topo.json');
const shapes = Object.fromEntries(feature(topology, topology.objects.countries).features.map((f) => [f.properties.iso3, f]));

if (UN_MEMBERS.length !== 193) throw new Error(`Expected 193 UN members, got ${UN_MEMBERS.length}`);
const missing = UN_MEMBERS.filter((iso) => !shapes[iso]);
if (missing.length) throw new Error(`No map shape for: ${missing.join(' ')}`);

// Land area in km², from the map shapes (sinusoidal projection: accurate
// enough to rank countries by size).
const KM_PER_DEGREE = 111.32;
function ringArea(ring) {
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[i + 1];
    sum += x1 * Math.cos((y1 * Math.PI) / 180) * y2 - x2 * Math.cos((y2 * Math.PI) / 180) * y1;
  }
  return Math.abs(sum / 2) * KM_PER_DEGREE ** 2;
}
function area({ geometry }) {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  return polygons.reduce((total, [outer, ...holes]) => total + ringArea(outer) - holes.reduce((s, h) => s + ringArea(h), 0), 0);
}

// The latest figure for each country.
function latestValues(id) {
  const { values } = read(`indicators/${id}.json`);
  return Object.fromEntries(Object.entries(values).map(([iso, series]) => [iso, series[Math.max(...Object.keys(series))]]));
}
const population = latestValues('population');
const gdp = latestValues('gdp');

// Each measure on a log scale, as a z-score; a missing figure counts as average.
function zScores(raw) {
  const logs = Object.fromEntries(UN_MEMBERS.filter((iso) => raw[iso] > 0).map((iso) => [iso, Math.log(raw[iso])]));
  const xs = Object.values(logs);
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length);
  return (iso) => (logs[iso] === undefined ? 0 : (logs[iso] - mean) / sd);
}
const z = {
  area: zScores(Object.fromEntries(UN_MEMBERS.map((iso) => [iso, area(shapes[iso])]))),
  population: zScores(population),
  gdp: zScores(gdp),
};

const ranked = UN_MEMBERS.map((iso) => ({
  iso,
  score: Object.entries(WEIGHTS).reduce((sum, [measure, weight]) => sum + weight * z[measure](iso), 0),
})).sort((a, b) => b.score - a.score);

const tiers = Array.from({ length: TIERS }, () => []);
ranked.forEach(({ iso }, i) => {
  const tier = MOVES[iso] ?? Math.floor((i * TIERS) / ranked.length) + 1;
  tiers[tier - 1].push(iso);
});

writeFileSync('public/data/game.json', JSON.stringify({ tiers }));
const names = Object.fromEntries(Object.entries(shapes).map(([iso, f]) => [iso, f.properties.name]));
tiers.forEach((list, i) => console.log(`\nTier ${i + 1} (${list.length}): ${list.map((iso) => names[iso]).join(', ')}`));
