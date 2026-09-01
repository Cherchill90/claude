import { useMemo, useState } from 'react';
import { useAppState, useAppDispatch } from './state/store.jsx';
import { todayISO, minutesSinceMidnight } from './lib/time.js';
import Onboarding from './components/Onboarding.jsx';
import AddSheet from './components/AddSheet.jsx';
import Heute from './screens/Heute.jsx';
import Tagesband from './screens/Tagesband.jsx';
import Woche from './screens/Woche.jsx';
import Daten from './screens/Daten.jsx';
import Mehr from './screens/Mehr.jsx';

const TABS = [
  { key: 'heute', label: 'Heute' },
  { key: 'band', label: 'Tagesband' },
  { key: 'woche', label: 'Woche' },
  { key: 'daten', label: 'Daten' },
  { key: 'mehr', label: 'Mehr' },
];

export default function App() {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const [tab, setTab] = useState('heute');
  const [addSheet, setAddSheet] = useState(null); // { cat, min, from } | null

  const defaultAddCat = useMemo(
    () => (state.cats.find((c) => c.name === 'Verwaltung') || state.cats[0])?.name || '',
    [state.cats]
  );

  const openAdd = (initial = {}) => {
    const min = initial.min ?? 45;
    const now = minutesSinceMidnight(new Date());
    const from = initial.from ?? Math.max(0, Math.min(1439 - min, Math.round(now / 15) * 15 - min));
    setAddSheet({
      cat: initial.cat ?? defaultAddCat,
      min,
      from,
    });
    setTab('heute');
  };
  const closeAdd = () => setAddSheet(null);

  const saveAdd = () => {
    if (!addSheet) return;
    dispatch({
      type: 'ADD_ENTRY',
      date: todayISO(),
      name: addSheet.cat,
      min: addSheet.min,
      from: addSheet.from,
      source: 'Nachtrag',
    });
    setAddSheet(null);
  };

  if (!state.onboardingDone) {
    return <Onboarding />;
  }

  return (
    <div className="app-shell">
      <main className="app-content">
        {tab === 'heute' && <Heute onOpenAdd={() => openAdd()} onGoBand={() => setTab('band')} />}
        {tab === 'band' && <Tagesband onOpenAdd={openAdd} />}
        {tab === 'woche' && <Woche />}
        {tab === 'daten' && <Daten />}
        {tab === 'mehr' && <Mehr />}
      </main>

      <nav className="tab-bar">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            className="tab-btn"
            onClick={() => setTab(t.key)}
          >
            <div
              className="tab-mark"
              style={{ background: tab === t.key ? 'var(--color-accent)' : 'transparent' }}
            />
            <div
              className="tab-label"
              style={{ color: tab === t.key ? 'var(--color-accent-800)' : 'rgba(32,30,29,.45)' }}
            >
              {t.label}
            </div>
          </button>
        ))}
      </nav>

      {addSheet && (
        <AddSheet
          value={addSheet}
          onChange={setAddSheet}
          onClose={closeAdd}
          onSave={saveAdd}
        />
      )}
    </div>
  );
}
