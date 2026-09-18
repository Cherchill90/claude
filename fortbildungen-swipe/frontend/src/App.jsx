import React, { useState } from 'react';
import { AuthProvider, useAuth } from './lib/AuthContext.jsx';
import AuthScreen from './components/AuthScreen.jsx';
import ChangePasswordScreen from './components/ChangePasswordScreen.jsx';
import SwipeDeck from './components/SwipeDeck.jsx';
import CreateTrainingForm from './components/CreateTrainingForm.jsx';
import MyTrainings from './components/MyTrainings.jsx';
import AdminEmployees from './components/AdminEmployees.jsx';

const TABS = [
  { id: 'discover', label: 'Entdecken', icon: '🔥' },
  { id: 'create', label: 'Neu', icon: '➕' },
  { id: 'mine', label: 'Meine', icon: '📋' },
];

const ADMIN_TAB = { id: 'admin', label: 'Verwaltung', icon: '🛠️' };

function Shell() {
  const { user, logout } = useAuth();
  const [tab, setTab] = useState('discover');
  const [refreshKey, setRefreshKey] = useState(0);
  const [showChangePassword, setShowChangePassword] = useState(false);

  function handleCreated() {
    setRefreshKey((k) => k + 1);
    setTab('discover');
  }

  if (!user) return <AuthScreen />;
  if (user.mustChangePassword) return <ChangePasswordScreen forced />;
  if (showChangePassword) {
    return <ChangePasswordScreen onCancel={() => setShowChangePassword(false)} />;
  }

  const tabs = user.role === 'admin' ? [...TABS, ADMIN_TAB] : TABS;

  return (
    <div className="app-shell">
      <header className="app-header">
        <span className="app-title">Fortbildungen Swipe</span>
        <div className="app-header-user">
          <span>{user.name}</span>
          <button type="button" className="logout-btn" onClick={() => setShowChangePassword(true)}>
            Passwort
          </button>
          <button type="button" className="logout-btn" onClick={logout}>
            Abmelden
          </button>
        </div>
      </header>

      <main className="app-main">
        {tab === 'discover' && <SwipeDeck refreshKey={refreshKey} />}
        {tab === 'create' && <CreateTrainingForm onCreated={handleCreated} />}
        {tab === 'mine' && <MyTrainings refreshKey={refreshKey} />}
        {tab === 'admin' && user.role === 'admin' && <AdminEmployees />}
      </main>

      <nav className="app-nav">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            className={tab === t.id ? 'active' : ''}
            onClick={() => setTab(t.id)}
          >
            <span className="nav-icon">{t.icon}</span>
            <span>{t.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Shell />
    </AuthProvider>
  );
}
