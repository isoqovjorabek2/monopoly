import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages serves this project from https://<user>.github.io/monopoly/
// so assets must be requested from that sub-path. Override with BASE_PATH=/ for
// root deployments (Netlify, custom domain, local `vite preview`).
const base = process.env.BASE_PATH ?? '/monopoly/';

export default defineConfig({
  base,
  plugins: [react()],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 900,
  },
});
