import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api } from './api.js';

const AuthContext = createContext(null);
const STORAGE_KEY = 'fortbildungen-swipe:auth';

export function AuthProvider({ children }) {
  const [auth, setAuth] = useState(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  });

  useEffect(() => {
    try {
      if (auth) localStorage.setItem(STORAGE_KEY, JSON.stringify(auth));
      else localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Speicher nicht verfügbar (z. B. privater Modus) – Session bleibt nur in-memory.
    }
  }, [auth]);

  const login = useCallback(async (email, password) => {
    const result = await api.login(email, password);
    setAuth(result);
    return result;
  }, []);

  const logout = useCallback(() => setAuth(null), []);

  const markPasswordChanged = useCallback((user) => {
    setAuth((prev) => (prev ? { ...prev, user } : prev));
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user: auth?.user ?? null,
        token: auth?.token ?? null,
        login,
        logout,
        markPasswordChanged,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth muss innerhalb von AuthProvider verwendet werden.');
  return ctx;
}
