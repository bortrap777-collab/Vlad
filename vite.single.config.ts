// Single-file build: everything (code, styles, fonts) in one HTML; images and sounds are
// embedded afterwards by tools/make-single.mjs. Used for playing offline on a phone.
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  base: './',
  publicDir: false,
  plugins: [viteSingleFile()],
  build: {
    outDir: 'dist-single',
    target: 'es2018',
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
    chunkSizeWarningLimit: 4000,
    modulePreload: false,
    // a classic (non-module) script runs in more phone browsers and in-app viewers
    rollupOptions: { output: { format: 'iife', inlineDynamicImports: true } },
  },
});
