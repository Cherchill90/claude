import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

import { initStorage, platform } from './storage.js';

// Web-App: Offline-Cache (Service Worker) nur in der Browser-Version über HTTPS bzw. localhost
if (platform === 'web' && 'serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  import('virtual:pwa-register').then(({ registerSW }) => registerSW({ immediate: true })).catch(() => {});
}

initStorage()
  .catch((e) => console.error('Speicher konnte nicht geladen werden', e))
  .finally(() => createRoot(document.getElementById('root')).render(<App />));
