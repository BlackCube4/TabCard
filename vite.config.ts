import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    lib: {
      entry: 'tab-card.ts',
      name: 'TabCard',
      formats: ['es'],
      fileName: () => `tab-card.js`
    },
    outDir: 'dist',
  }
});