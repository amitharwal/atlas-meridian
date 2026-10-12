import { defineConfig } from 'vite';

export default defineConfig({
  // Relative paths, so the built site works wherever it's hosted — including
  // GitHub Pages, which serves it from a sub-folder named after the repository.
  base: './',
  build: {
    // Two pages: the map, and the daily puzzle at /daily/.
    rollupOptions: {
      input: { main: 'index.html', daily: 'daily/index.html' },
    },
  },
});
