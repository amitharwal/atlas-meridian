import { defineConfig } from 'vite';

export default defineConfig({
  // Relative paths, so the built site works wherever it's hosted — including
  // GitHub Pages, which serves it from a sub-folder named after the repository.
  base: './',
  build: {
    // The map, plus the pages under /daily/, /rankings/ and /compare/. (Country
    // pages are built separately by pipeline/build_profiles.mjs.)
    rollupOptions: {
      input: {
        main: 'index.html',
        daily: 'daily/index.html',
        rankings: 'rankings/index.html',
        compare: 'compare/index.html',
      },
    },
  },
});
