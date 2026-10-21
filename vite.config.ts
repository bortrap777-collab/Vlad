import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base: './' — приложение можно положить в любую папку хостинга (GitHub Pages, Netlify и т.д.)
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    target: ['safari15', 'chrome100'],
    sourcemap: false,
  },
});
