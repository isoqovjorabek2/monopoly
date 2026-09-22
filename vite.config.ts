import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

// GitHub Pages serves this project from https://<user>.github.io/monopoly/
// so assets must be requested from that sub-path. Override with BASE_PATH=/ for
// root deployments (Netlify, custom domain, local `vite preview`).
const base = process.env.BASE_PATH ?? '/monopoly/';

export default defineConfig({
  base,
  plugins: [
    react(),
    // Omertà's screens are the Mafia app's own, which are written in
    // Tailwind. Its utilities carry a tw: prefix, so they can never collide
    // with the rest of the site's class names.
    tailwindcss(),
    VitePWA({
      // A new service worker waits for the player to ask for it: the host's
      // tab IS the table, so nothing here may force a reload. The toast in
      // ui/pwa.ts calls the update function when the player says so.
      registerType: 'prompt',
      // public/manifest.webmanifest is the manifest - written by hand so the
      // one file serves both deploy bases through relative URLs.
      manifest: false,
      // Registered by hand in main.tsx (virtual:pwa-register), so dev stays
      // clean and production registration is explicit.
      injectRegister: false,
      workbox: {
        // The app shell: code, styles, the html entry, the icons. Art and
        // audio are far too heavy to precache - they are runtime-cached
        // below, so a missing file still costs nothing on first play.
        globPatterns: ['**/*.{js,css,html,svg,webmanifest}', 'icons/*.png'],
        navigateFallback: `${base}index.html`,
        // The partyhall.io deploy shares an origin with the auth, lobby,
        // peer-broker and panel services. A navigation to any of them must
        // never be answered with the app's index.html.
        navigateFallbackDenylist: [/^\/auth\//, /^\/lobbies\//, /^\/peer\//, /^\/admin(\/|$)/, /\/legal\//],
        runtimeCaching: [
          {
            // Generated art and recorded cues: stable names, immutable
            // enough, fetched lazily. Cache-first with a month-long shelf.
            urlPattern: ({ url, sameOrigin }) =>
              sameOrigin && /\/(art|audio)\//.test(url.pathname),
            handler: 'CacheFirst',
            options: {
              cacheName: 'media',
              expiration: { maxEntries: 240, maxAgeSeconds: 30 * 24 * 60 * 60 },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\//,
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'google-fonts-css' },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\//,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-webfonts',
              expiration: { maxEntries: 30, maxAgeSeconds: 365 * 24 * 60 * 60 },
            },
          },
          // Everything else - PeerJS signalling, the lobby directory, the
          // auth service - is network-only by omission. A cached answer from
          // any of those would be a lie.
        ],
      },
    }),
  ],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 900,
  },
});
