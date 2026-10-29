# Fortbildungen Swipe

Eine "Tinder für Fortbildungen"-App, die als reine HTML/JS-Anwendung im
Browser läuft (kein natives App-Paket): Mitarbeiter:innen legen eigene
Fortbildungen an (mit Pflichtangaben für Datum und Uhrzeit) und können
bestehende Fortbildungen per Wisch nach rechts (Interesse) oder links (kein
Interesse) bewerten. Bei Interesse wird der eigene Name in eine
Teilnahmeliste eingetragen, die **nur für die anbietende Person** sichtbar
ist.

Der Zugang wird über die betriebseigene E-Mail-Adresse und ein von der
Verwaltung vergebenes Initialpasswort geregelt — es gibt keine offene
Selbstregistrierung.

## Struktur

- `backend/` — Express-API mit SQLite (better-sqlite3), JWT-Auth
- `frontend/` — React/Vite-App mit Tinder-artigem Swipe-Deck (framer-motion);
  `npm run build` erzeugt ein statisches `dist/index.html`, das auf jedem
  internen Webserver ausgeliefert werden kann.

## Backend starten

```bash
cd backend
npm install
npm run dev        # http://localhost:4000
```

Umgebungsvariablen (optional):

| Variable                | Zweck                                                                 |
| ------------------------ | ---------------------------------------------------------------------- |
| `ADMIN_EMAIL`             | E-Mail des ersten Verwaltungskontos (Standard: `admin@firma.example`) |
| `ADMIN_INITIAL_PASSWORD`  | Initialpasswort des ersten Verwaltungskontos (sonst zufällig erzeugt und einmalig ins Log geschrieben) |
| `COMPANY_EMAIL_DOMAIN`    | Wenn gesetzt (z. B. `firma.de`), werden nur E-Mail-Adressen dieser Domain für neue Konten akzeptiert |
| `JWT_SECRET`               | Signaturschlüssel für Sessions (unbedingt in Produktion setzen)       |
| `DB_PATH`                  | Pfad zur SQLite-Datei (Standard: `backend/data.sqlite`)               |

Beim allerersten Start ohne bestehende Konten wird automatisch ein
Verwaltungskonto angelegt; die Zugangsdaten werden einmalig in der
Konsole ausgegeben.

## Frontend starten

```bash
cd frontend
npm install
npm run dev         # http://localhost:5173
```

Die Frontend-API-URL lässt sich per `VITE_API_URL` überschreiben
(Standard: `http://localhost:4000/api`).

## Funktionsweise

- **Zugang**: Anmeldung ausschließlich mit betriebseigener E-Mail-Adresse
  und Passwort. Neue Konten (Mitarbeiter:innen oder weitere
  Verwaltungskonten) werden ausschließlich über die
  **Mitarbeiterverwaltung** angelegt — dabei wird ein zufälliges
  Initialpasswort erzeugt, das die Verwaltung weitergibt. Beim ersten Login
  muss dieses Initialpasswort durch ein eigenes ersetzt werden, bevor die
  App nutzbar ist (serverseitig erzwungen, nicht nur im Frontend).
- **Verwaltung** (nur für Konten mit Rolle „admin“): Mitarbeiterkonten
  anlegen (Name, E-Mail, Rolle) und entfernen; das erzeugte Initialpasswort
  wird einmalig angezeigt.
- **Neu**: eigene Fortbildung anlegen — Titel, Beschreibung, Ort sowie
  **Datum und Uhrzeit als Pflichtfelder**.
- **Entdecken**: Fortbildungen anderer Mitarbeiter:innen als Kartenstapel,
  nach rechts wischen (Interesse) oder links (kein Interesse) — per
  Drag-Geste oder Buttons.
- **Meine**: eigene angebotene Fortbildungen inkl. Teilnahmeliste (nur für
  die anbietende Person sichtbar, serverseitig via `403` abgesichert) sowie
  eine Übersicht der Fortbildungen, für die man selbst Interesse bekundet hat.

## Hinweis zum E-Mail-Versand

Die App verschickt keine E-Mails selbst (kein SMTP-Versand). Die
Verwaltung gibt Initialpasswörter manuell über den bestehenden
betrieblichen E-Mail-Kanal weiter. Soll das automatisiert werden, müsste
ein SMTP-Anbindung ergänzt werden.
