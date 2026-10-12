import { defineConfig } from 'vite';

export default defineConfig({
  // Relative paths, so the built site works wherever it's hosted — including
  // GitHub Pages, which serves it from a sub-folder named after the repository.
  base: './',
});
