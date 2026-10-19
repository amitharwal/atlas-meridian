// Writes public/data/places.json: every country's name and continent, taken
// from the map shapes. The rankings and compare pages need names but not the
// (much bigger) shapes. Run by `npm run build:map`.
import { readFileSync, writeFileSync } from 'node:fs';

const topology = JSON.parse(readFileSync('public/data/countries.topo.json', 'utf8'));
const places = Object.fromEntries(
  topology.objects.countries.geometries
    .map((g) => g.properties)
    .filter((p) => p.iso3 !== 'ATA')
    .map((p) => [p.iso3, [p.name, p.continent]]),
);
writeFileSync('public/data/places.json', JSON.stringify(places));
console.log(`Wrote ${Object.keys(places).length} places`);
