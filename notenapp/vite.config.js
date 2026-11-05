import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: './',
  plugins: [
    react(),
    // Web-App fürs iPhone („Zum Home-Bildschirm“): offline nutzbar, ohne Ablaufdatum.
    // Registriert wird der Service Worker nur in der Web-Version (siehe main.jsx), nicht in der Mac-/iOS-App.
    VitePWA({
      injectRegister: null,
      registerType: 'autoUpdate',
      includeAssets: ['icon-180.png'],
      manifest: {
        name: 'Notenapp',
        short_name: 'Notenapp',
        description: 'Notenverwaltung für Lehrkräfte',
        lang: 'de',
        start_url: './',
        scope: './',
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#1c5cab',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      workbox: { globPatterns: ['**/*.{js,css,html,png,svg,ico}'], navigateFallback: 'index.html', cleanupOutdatedCaches: true },
    }),
  ],
});
