// Finding a country by name, including common short names and former names.

// Other names people type. Keys are our codes; the map's own English name is
// always searchable too.
const ALIASES = {
  USA: ['USA', 'US', 'United States', 'America'],
  GBR: ['UK', 'Britain', 'Great Britain', 'England'],
  RUS: ['Russian Federation', 'USSR'],
  CIV: ["Côte d'Ivoire", 'Cote dIvoire'],
  MMR: ['Burma'],
  CZE: ['Czechia'],
  TUR: ['Türkiye', 'Turkiye'],
  SWZ: ['Swaziland'],
  MKD: ['Macedonia'],
  COD: ['DRC', 'DR Congo', 'Congo-Kinshasa', 'Zaire'],
  COG: ['Congo-Brazzaville'],
  KOR: ['Korea', 'Republic of Korea'],
  PRK: ['DPRK'],
  TLS: ['Timor-Leste'],
  CPV: ['Cabo Verde'],
  LAO: ['Lao PDR'],
  VAT: ['Holy See'],
  PSE: ['State of Palestine'],
  IRN: ['Persia'],
  LKA: ['Ceylon'],
  NLD: ['Holland'],
  ARE: ['UAE'],
  BIH: ['Bosnia'],
  EU: ['European Union'],
};

// Lower case, accents and punctuation removed: "Côte d'Ivoire" -> "cote divoire".
const normalise = (text) =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, '')
    .trim();

// `codes` are every place on the map or in the speeches; `nameOf` names them.
export function makeSearch(codes, nameOf) {
  const entries = codes.map((iso) => {
    const name = nameOf(iso, 9999);
    // Former names of the same UN seat, e.g. Soviet Union for Russia.
    const former = [...new Set([nameOf(iso, 1950), nameOf(iso, 1995)])].filter((n) => n !== name);
    const names = [name, ...former, ...(ALIASES[iso] ?? [])];
    return { iso, name, former, keys: names.map(normalise) };
  });

  return function find(query, limit = 6) {
    const q = normalise(query);
    if (!q) return [];
    const scored = [];
    for (const entry of entries) {
      let best = 0;
      for (const key of entry.keys) {
        if (key === q) best = Math.max(best, 4);
        else if (key.startsWith(q)) best = Math.max(best, 3);
        else if (key.split(' ').some((word) => word.startsWith(q))) best = Math.max(best, 2);
        else if (key.includes(q)) best = Math.max(best, 1);
      }
      if (best) scored.push({ ...entry, score: best });
    }
    return scored.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)).slice(0, limit);
  };
}
