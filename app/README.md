# Zeitwaage — Arbeitszeit-Erfassung für Lehrkräfte

Implementation of the "Zeitwaage" design (`Zeiterfassung Lehrkraft.dc.html`, option 1a) as a
real app: a React PWA frontend and a minimal Express/Excel backend for the anonymized
school-wide data collection ("Datenraum" → Sammelstelle).

## Structure

- `frontend/` — React + Vite PWA. Installable on the home screen, works offline after first
  load. All entries, categories, deputat and onboarding state persist in `localStorage`.
- `backend/` — Express service exposing `POST /api/sync`, which receives anonymized
  per-day-per-category minute totals and writes them into a shared `.xlsx` workbook
  (`backend/data/arbeitszeit_<school>.xlsx`) using `exceljs`. This is the "zentrale Tabelle"
  from design option 1e — the mobile app never sends raw timestamps, names, or notes, only
  `{ pseudonym, date, category, minutes, deputat% }`.

## Scope

Implements design option **1a** in full: onboarding (incl. consent + Deputat selection),
Heute (live timer + quick entry + Tagesprotokoll), Tagesband (0–24h draggable day view),
Woche (Soll-Ist, Verlauf, Verteilung), Datenraum (participation, field transparency, row
preview, sync), and Mehr (Deputat, category management — reorder/hide/delete/add, max 9).

Not implemented (out of scope per the design bundle's own "next steps" / exploratory
options, and not selected for this build): the slider quick-entry variant (1c), the dark
evening variant (1d) as a real theme, and an admin UI for the central spreadsheet (1e) —
1e's *output* is what the backend produces, but there's no admin-facing UI for it here.

## Running locally

```bash
cd backend && npm install && npm run dev   # http://localhost:8787
cd frontend && npm install && npm run dev  # http://localhost:5173 (proxies /api to :8787)
```

For production, build the frontend (`npm run build` in `frontend/`) and serve `dist/`
behind the same origin as the backend (or configure CORS/base URL), and run the backend
with a process manager. `backend/data/` should be persisted (e.g. a volume) since it holds
the central workbook.

## Native iOS app (Xcode project)

`frontend/ios/` is a real Xcode project generated with [Capacitor](https://capacitorjs.com/),
wrapping the same React app — no separate native codebase to maintain. **Building and
running it requires a Mac with Xcode**; that can't be done from this (Linux) environment,
so this repo only prepares the project.

```bash
cd frontend
npm install
npm run ios:sync    # builds the web app and copies it into ios/App/App/public
npm run ios:open    # opens ios/App/App.xcworkspace in Xcode
```

In Xcode: pick a simulator (or your device) from the scheme toolbar and press ⌘R.
First launch will run CocoaPods automatically; if it doesn't, run `pod install` inside
`ios/App` yourself (needs [CocoaPods](https://cocoapods.org/) installed).

**Sync only works once the backend is reachable over HTTPS from the device/simulator** —
inside the app bundle there's no `localhost:8787` to proxy to. Point the native build at
your real backend before syncing:

```bash
VITE_API_BASE_URL=https://your-backend.example.com npm run ios:sync
```

Without that, the app still works fully offline (timer, entries, categories, Woche) —
only "Heutige Zeilen jetzt senden" needs the backend. For local development against a
backend running on your Mac's LAN IP over plain HTTP, iOS's App Transport Security will
block the request by default; add a temporary `NSExceptionDomains` entry for that IP in
`ios/App/App/Info.plist`, or test against a real HTTPS deployment instead.

App id is `de.zeitwaage.app`, display name "Zeitwaage" — change either via
`capacitor.config.json` (then re-run `npm run ios:sync`) or directly in Xcode. The bundled
app icon (`ios/App/App/Assets.xcassets/AppIcon.appiconset`) is a placeholder — swap it for
a real design before any TestFlight/App Store submission.

For distribution beyond your own device, you'll additionally need an Apple Developer
account (for code signing and TestFlight/App Store) — none of that is set up here.

## Notes on fidelity vs. the source design

- Colors, spacing, radii, and typography are ported from `organic.css` as CSS custom
  properties (`frontend/src/styles/tokens.css`); layout/markup was rebuilt as React
  components rather than copying the prototype's `sc-if`/`sc-for` template directives,
  per the handoff README's instruction to match visual output, not internal structure.
  The iOS device-frame chrome (`ios-frame.jsx`) was intentionally **not** ported — this is
  a real installable PWA, not a mockup rendered inside a phone bezel.
- The prototype's hardcoded demo numbers (seed entries, a fake `weekBase` for prior days,
  static category "week" totals) were replaced with real computation from persisted,
  dated entries — a fresh install starts empty and grows from actual usage.
- Found and fixed a rounding bug present in the original design's `hm()`/`hmShort()`
  helpers: rounding hours and minutes separately could render "29:60" instead of "30:00"
  when a live timer's fractional elapsed minutes pushed the remainder to exactly 60.
