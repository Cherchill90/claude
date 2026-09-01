import { createContext, useContext, useEffect, useMemo, useReducer } from 'react';
import { DEFAULT_CATEGORIES, MAX_CATEGORIES } from '../lib/categories.js';
import { loadState, saveState, newPseudonym } from '../lib/storage.js';
import { minutesSinceMidnight, todayISO } from '../lib/time.js';

const SOLL_STUNDEN_VOLLZEIT = 40; // Hessen: Vollzeit = 25,5 Deputatsstunden = 40 Zeitstunden

function initialState() {
  const saved = loadState();
  if (saved) {
    return {
      cats: DEFAULT_CATEGORIES,
      hidden: [],
      entries: [],
      running: null,
      onboardingDone: false,
      ob: 1,
      consent: true,
      deputat: 100,
      participate: true,
      pseudonym: newPseudonym(),
      syncLog: [],
      ...saved,
    };
  }
  return {
    cats: DEFAULT_CATEGORIES,
    hidden: [],
    entries: [],
    running: null,
    onboardingDone: false,
    ob: 1,
    consent: true,
    deputat: 100,
    participate: true,
    pseudonym: newPseudonym(),
    syncLog: [],
  };
}

function reducer(state, action) {
  switch (action.type) {
    case 'START_TIMER': {
      if (state.running) return state;
      const d = new Date();
      return {
        ...state,
        running: {
          name: action.name,
          startTs: d.getTime(),
          startDate: todayISO(d),
          label: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`,
        },
      };
    }
    case 'STOP_TIMER': {
      if (!state.running) return state;
      const min = Math.max(1, Math.round((Date.now() - state.running.startTs) / 60000));
      const from = Math.max(0, Math.min(1439, minutesSinceMidnight(new Date(state.running.startTs))));
      const entry = {
        id: `e_${Date.now()}`,
        date: state.running.startDate,
        name: state.running.name,
        from,
        min,
        source: 'Timer',
      };
      return { ...state, running: null, entries: [...state.entries, entry] };
    }
    case 'DISCARD_TIMER':
      return { ...state, running: null };

    case 'ADD_ENTRY': {
      const entry = {
        id: `e_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        date: action.date,
        name: action.name,
        from: action.from,
        min: Math.max(1, Math.round(action.min)),
        source: action.source,
      };
      return { ...state, entries: [...state.entries, entry] };
    }
    case 'DELETE_ENTRY':
      return { ...state, entries: state.entries.filter((e) => e.id !== action.id) };

    case 'MOVE_ENTRY_START':
      return {
        ...state,
        entries: state.entries.map((e) =>
          e.id === action.id ? { ...e, from: Math.min(1440 - e.min, Math.max(0, action.from)) } : e
        ),
      };

    case 'ADD_CATEGORY': {
      if (state.cats.length >= MAX_CATEGORIES) return state;
      const name = action.name.trim();
      if (!name || state.cats.some((c) => c.name === name)) return state;
      const id = `c_${Date.now()}`;
      return {
        ...state,
        cats: [...state.cats, { id, name, letter: name.slice(0, 1).toUpperCase(), color: action.color }],
      };
    }
    case 'DELETE_CATEGORY':
      return { ...state, cats: state.cats.filter((c) => c.name !== action.name) };
    case 'TOGGLE_CATEGORY_VISIBLE':
      return {
        ...state,
        hidden: state.hidden.includes(action.name)
          ? state.hidden.filter((n) => n !== action.name)
          : [...state.hidden, action.name],
      };
    case 'MOVE_CATEGORY': {
      const j = action.index + action.direction;
      if (j < 0 || j >= state.cats.length) return state;
      const cats = state.cats.slice();
      [cats[action.index], cats[j]] = [cats[j], cats[action.index]];
      return { ...state, cats };
    }

    case 'SET_DEPUTAT':
      return { ...state, deputat: action.percent };
    case 'SET_PARTICIPATE':
      return { ...state, participate: action.value };
    case 'TOGGLE_CONSENT':
      return { ...state, consent: !state.consent };
    case 'SET_OB_STEP':
      return { ...state, ob: action.step };
    case 'COMPLETE_ONBOARDING':
      return { ...state, onboardingDone: true };
    case 'MARK_SYNCED': {
      const entry = { date: action.date, rows: action.rows, sentAt: action.sentAt };
      const rest = state.syncLog.filter((l) => l.date !== action.date);
      return { ...state, syncLog: [entry, ...rest].sort((a, b) => (a.date < b.date ? 1 : -1)) };
    }

    default:
      return state;
  }
}

const AppStateContext = createContext(null);
const AppDispatchContext = createContext(null);

export function AppProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, undefined, initialState);

  useEffect(() => {
    saveState(state);
  }, [state]);

  return (
    <AppStateContext.Provider value={state}>
      <AppDispatchContext.Provider value={dispatch}>{children}</AppDispatchContext.Provider>
    </AppStateContext.Provider>
  );
}

export function useAppState() {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error('useAppState must be used within AppProvider');
  return ctx;
}

export function useAppDispatch() {
  const ctx = useContext(AppDispatchContext);
  if (!ctx) throw new Error('useAppDispatch must be used within AppProvider');
  return ctx;
}

export function useSollStunden() {
  return SOLL_STUNDEN_VOLLZEIT;
}

export function sollWeekMinutes(state) {
  return Math.round(((SOLL_STUNDEN_VOLLZEIT * state.deputat) / 100) * 60);
}

export function sollDayMinutes(state) {
  return Math.round(sollWeekMinutes(state) / 5);
}
