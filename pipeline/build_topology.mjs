// Packs the country shapes into TopoJSON, which stores each shared border once
// and rounds points to a fine grid (about 400 m). The file the site downloads
// shrinks by more than half compared with plain GeoJSON.
//
// Run from the project root after build_countries.py:  npm run build:map
import { readFileSync, writeFileSync } from 'node:fs';
import { topology } from 'topojson-server';

const INPUT = 'pipeline/build/countries.geojson';
const OUTPUT = 'public/data/countries.topo.json';

const countries = JSON.parse(readFileSync(INPUT, 'utf8'));
const packed = JSON.stringify(topology({ countries }, 1e5));
writeFileSync(OUTPUT, packed);
console.log(`Wrote ${countries.features.length} countries to ${OUTPUT} (${Math.round(packed.length / 1024)} KB)`);
