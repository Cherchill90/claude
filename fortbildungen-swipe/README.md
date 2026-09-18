# Fortbildungen Swipe

Eine "Tinder für Fortbildungen"-App: Nutzer:innen legen eigene Fortbildungen an
(mit Pflichtangaben für Datum und Uhrzeit) und können bestehende Fortbildungen
per Wisch nach rechts (Interesse) oder links (kein Interesse) bewerten. Bei
Interesse wird der eigene Name in eine Teilnahmeliste eingetragen, die **nur
für die anbietende Person** sichtbar ist.

## Struktur

- `backend/` — Express-API mit SQLite (better-sqlite3), JWT-Auth
- `frontend/` — React/Vite-App mit Tinder-artigem Swipe-Deck (framer-motion)

## Backend starten

```bash
cd backend
npm install
npm run dev        # http://localhost:4000
```

## Frontend starten

```bash
cd frontend
npm install
npm run dev         # http://localhost:5173
```

Die Frontend-API-URL lässt sich per `VITE_API_URL` überschreiben
(Standard: `http://localhost:4000/api`).

## Funktionsweise

- **Registrieren/Anmelden** mit Name + Passwort (JWT-Session).
- **Neu**: eigene Fortbildung anlegen — Titel, Beschreibung, Ort sowie
  **Datum und Uhrzeit als Pflichtfelder**.
- **Entdecken**: Fortbildungen anderer Nutzer:innen als Kartenstapel, nach
  rechts wischen (Interesse) oder links (kein Interesse) — per Drag-Geste
  oder Buttons.
- **Meine**: eigene angebotene Fortbildungen inkl. Teilnahmeliste (nur für
  die anbietende Person sichtbar, serverseitig via `403` abgesichert) sowie
  eine Übersicht der Fortbildungen, für die man selbst Interesse bekundet hat.
