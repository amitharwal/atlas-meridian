import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import { longDate } from './src/format.js';

// Counts quoted in the pages' text ("34 measures", "1946 to 2025"), worked out
// from the data so they stay right when it changes, and the site's address.
// Written in the HTML as {{name}}.
function siteFacts() {
  const read = (path) => JSON.parse(readFileSync(`public/data/${path}`, 'utf8'));
  const speeches = read('speeches.json');
  const speechCount = Object.values(speeches.shares).reduce((n, years) => n + Object.keys(years).length, 0);
  return {
    // The published address, for links shared elsewhere (set once, in package.json).
    site: JSON.parse(readFileSync('package.json', 'utf8')).homepage,
    indicators: read('indicators/index.json').length,
    topics: read('topics.json').length,
    firstYear: speeches.years[0],
    lastYear: speeches.years[1],
    // When the World Bank figures last changed (pipeline/build_indicators.py).
    updated: longDate(read('indicators/updated.json').updated),
    // Rounded down to the thousand: "over 11,000".
    speeches: (Math.floor(speechCount / 1000) * 1000).toLocaleString('en'),
  };
}

const fillFacts = {
  name: 'fill-site-facts',
  transformIndexHtml(html) {
    const facts = siteFacts();
    return html.replace(/\{\{(\w+)\}\}/g, (match, name) => {
      if (!(name in facts)) throw new Error(`Unknown placeholder ${match} in a page`);
      return String(facts[name]);
    });
  },
};

export default defineConfig({
  // Relative paths, so the built site works wherever it's hosted — including
  // GitHub Pages, which serves it from a sub-folder named after the repository.
  base: './',
  plugins: [fillFacts],
  build: {
    // The map, plus the pages under /daily/, /rankings/ and /compare/. (Country
    // pages are built separately by pipeline/build_profiles.mjs, which finds
    // the fonts' stylesheet through the manifest.)
    manifest: true,
    rollupOptions: {
      input: {
        main: 'index.html',
        daily: 'daily/index.html',
        rankings: 'rankings/index.html',
        compare: 'compare/index.html',
        chart: 'chart/index.html',
        fonts: 'src/fonts.css',
      },
    },
  },
});
