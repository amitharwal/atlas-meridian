// Loading the generated data files and naming the countries in them.

// Relative to this code file, not the page, so it works from every page (/,
// /rankings/, …) and under GitHub Pages' sub-path. The file sits one folder
// below the site root both while developing (src/) and once built (assets/).
// (Kept in a variable: Vite rewrites `new URL(…, import.meta.url)` as an asset import.)
const here = import.meta.url;
export const dataUrl = (path) => new URL(`../data/${path}`, here).href;

export async function loadJson(path) {
  const response = await fetch(dataUrl(path));
  if (!response.ok) throw new Error(`Couldn't load ${path} (${response.status})`);
  return response.json();
}

// Speakers with no shape on today's map.
const FORMER_STATES = {
  CSK: 'Czechoslovakia',
  DDR: 'East Germany',
  YMD: 'South Yemen',
  EU: 'European Union',
};

// UN seats that passed to a country under a new name. Up to and including the
// given year, speeches on that seat were made under the old name.
const SEAT_RENAMES = {
  RUS: [1991, 'Soviet Union'],
  DEU: [1990, 'West Germany'],
  YEM: [1989, 'North Yemen'],
};

export function makeNamer(countries) {
  const names = Object.fromEntries(countries.features.map((f) => [f.properties.iso3, f.properties.name]));
  return function nameOf(iso3, year) {
    const rename = SEAT_RENAMES[iso3];
    if (rename && year <= rename[0]) return rename[1];
    if (iso3 === 'YUG') return year >= 2003 ? 'Serbia and Montenegro' : 'Yugoslavia';
    return FORMER_STATES[iso3] ?? names[iso3] ?? iso3;
  };
}

// Places whose largest piece of land is smaller than this (in square degrees,
// roughly 150 km across) are too small to see or click on the map, so they
// also get a dot marker. That's most island states, plus places like Malta.
const SMALL_AREA = 2;

// A rough centre for each country, used to fly the map there: the middle of
// its largest piece of land (so France centres on Europe, not French Guiana).
// Also returns dot markers for the small places.
export function shapeInfo(countries) {
  const centreOf = {};
  const dots = [];
  for (const f of countries.features) {
    const { type, coordinates } = f.geometry;
    const polygons = type === 'Polygon' ? [coordinates] : coordinates;
    let best = null;
    for (const polygon of polygons) {
      let box = [Infinity, Infinity, -Infinity, -Infinity];
      for (const [x, y] of polygon[0]) {
        box = [Math.min(box[0], x), Math.min(box[1], y), Math.max(box[2], x), Math.max(box[3], y)];
      }
      const area = (box[2] - box[0]) * (box[3] - box[1]);
      if (!best || area > best.area) best = { area, box };
    }
    const iso = f.properties.iso3;
    centreOf[iso] = [(best.box[0] + best.box[2]) / 2, (best.box[1] + best.box[3]) / 2];
    if (best.area < SMALL_AREA) {
      dots.push({ type: 'Feature', properties: { iso3: iso }, geometry: { type: 'Point', coordinates: centreOf[iso] } });
    }
  }
  return { centreOf, dots: { type: 'FeatureCollection', features: dots } };
}

// The address-friendly form of a name: "Côte d'Ivoire" -> "cote-divoire".
// Used for country profile pages, so the map and the page builder must agree.
export const slugOf = (name) =>
  name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

// "Prime Minister Frank Bainimarama" from a speakers.json entry [name, title, rank].
// Long titles are cut to the main role: "Prime Minister and Minister for
// Finance, Economic Growth…" becomes "Prime Minister".
export function speakerLabel(entry) {
  if (!entry?.[0]) return null;
  const [name, title] = entry;
  if (!title) return name;
  const role = title.length > 28 ? title.split(/,| and /)[0].trim() : title;
  return `${role} ${name.replace(/^(Mr|Mrs|Ms|Dr)\.? /, '')}`;
}

// Country names that read with "the" in a sentence: "It was the Soviet Union".
export function withThe(name) {
  if (/^the /i.test(name)) return name;
  return /^(United|Soviet|Czech|Dominican|Central African|Democratic|Republic of|Federated|European|Netherlands|Philippines|Bahamas|Maldives|Comoros|Seychelles|Gambia)|Islands$/.test(
    name,
  )
    ? `the ${name}`
    : name;
}
