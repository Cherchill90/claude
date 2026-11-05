import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

import { initStorage } from './storage.js';

initStorage()
  .catch((e) => console.error('Speicher konnte nicht geladen werden', e))
  .finally(() => createRoot(document.getElementById('root')).render(<App />));
