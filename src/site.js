// What the rankings and compare pages share: the menu bar, country names and
// which countries have a profile page.
import { loadJson, makeNamer, slugOf } from './data.js';
import { fillNav } from './nav.js';
import './pages.css';

export async function loadSite() {
  fillNav('../');
  const [places, regions, indicators, topics, speeches] = await Promise.all([
    loadJson('places.json'),
    loadJson('regions.json'),
    loadJson('indicators/index.json'),
    loadJson('topics.json'),
    loadJson('speeches.json'),
  ]);
  // makeNamer expects map features; places.json has just the parts it reads.
  const nameOf = makeNamer({ features: Object.entries(places).map(([iso3, [name]]) => ({ properties: { iso3, name } })) });
  const todayName = (iso) => nameOf(iso, 9999);
  // Pages exist for every country with World Bank figures or UN speeches.
  const hasProfile = (iso) => Boolean(regions[iso] || speeches.shares[iso]);
  const profileUrl = (iso) => `../country/${slugOf(todayName(iso))}/`;
  return { places, regions, indicators, topics, speeches, nameOf, todayName, hasProfile, profileUrl };
}

export function showError(error) {
  const status = document.getElementById('status');
  status.textContent = "Couldn't load the data. Please check your connection and refresh the page.";
  status.hidden = false;
  throw error;
}
