export const DEFAULT_CATEGORIES = [
  { id: 'unterricht', name: 'Unterricht', letter: 'U', color: '#d67f48' },
  { id: 'vor-nachbereitung', name: 'Vor-/Nachbereitung', letter: 'B', color: '#b2622d' },
  { id: 'korrektur', name: 'Korrektur', letter: 'K', color: '#728157' },
  { id: 'elternarbeit', name: 'Elternarbeit', letter: 'E', color: '#8c491a' },
  { id: 'konferenzen', name: 'Konferenzen', letter: 'C', color: '#82796a' },
  { id: 'aufsicht-pausen', name: 'Aufsicht/Pausen', letter: 'A', color: '#aebf92' },
  { id: 'fortbildung', name: 'Fortbildung', letter: 'F', color: '#f6a06b' },
  { id: 'verwaltung', name: 'Verwaltung', letter: 'V', color: '#645c50' },
  { id: 'ags', name: 'AGs', letter: 'G', color: '#3d472b' },
];

export const PALETTE = [
  '#d67f48', '#b2622d', '#8c491a', '#728157', '#aebf92', '#3d472b', '#82796a', '#645c50', '#c0b6a5',
];

export const MAX_CATEGORIES = 9;

export const FALLBACK_CATEGORY = { name: '', letter: '?', color: '#c0b6a5' };

export function findCategory(cats, name) {
  return cats.find((c) => c.name === name) || { ...FALLBACK_CATEGORY, name, letter: name.slice(0, 1).toUpperCase() };
}
