# Notenapp – Notenverwaltung für Lehrkräfte

Eigenständige Web-App (React + Vite). Funktionsumfang und Bedienkonzept orientieren sich an der
NotenBox für Mac: Klasse/Fach/Bereich-Auswahl links, Reiter **Noten · Schüler · Listen · Sitzplan**,
Klasse-Menü rechts oben.

## Mac-App installieren

Voraussetzung: Node.js (https://nodejs.org, LTS) auf dem Mac. Dann im Terminal:

```bash
cd notenapp
npm install
npm run dist:mac
```

Ergebnis: `release/Notenapp-1.0.0-arm64.dmg` (Apple Silicon) und `release/Notenapp-1.0.0.dmg` (Intel).
DMG öffnen und Notenapp in „Programme“ ziehen. Die App ist nicht bei Apple notarisiert: Beim ersten
Start Rechtsklick auf die App → „Öffnen“ → „Öffnen“ bestätigen. Falls macOS meldet, die App sei
„beschädigt“:

```bash
xattr -cr /Applications/Notenapp.app
```

Direkt starten ohne Installation: `npm run app`.

### Speichern und Backups (Mac-App)

- **Automatisches Speichern:** Jede Eingabe wird nach 0,25 s in
  `~/Library/Application Support/Notenapp/notenapp-daten.json` geschrieben (atomar, über eine
  temporäre Datei). Oben rechts steht „✓ Gespeichert“.
- **Backup bei jedem Beenden:** Beim Beenden (⌘Q oder Fenster schließen) wird zuerst der letzte
  Stand gespeichert, dann eine Kopie nach `…/Notenapp/Backups/Notenapp-Backup-JJJJ-MM-TT_hh-mm-ss.json`
  gelegt.
- **Aufbewahrung:** Backups, die älter als 3 Monate sind, löscht die App beim Start und beim Beenden.
- **Wiederherstellen:** Menü „Klasse → Backup wiederherstellen …“. Der aktuelle Stand wird vorher
  selbst gesichert. „Backup-Ordner im Finder zeigen“ öffnet den Ordner.
- Mit Passwort (global oder pro Klasse) sind auch die Backups verschlüsselt.

## Entwicklung

```bash
npm run dev      # Browser-Version, http://localhost:5173 (speichert im localStorage)
npm test         # Tests: Notenberechnung + Speichern/Backups
```

## Funktionen

**Noten**
- Arbeiten pro Fach und Bereich mit Datum, Halbjahr, Notiz, Schreibschutz und individueller Gewichtung
- Noten 1–6 mit Tendenzen (2+, 3−, 2,5) oder Notenpunkte 0–15; Eingabeprüfung
- Notenschlüssel: Punkte eingeben, Note wird über Prozentgrenzen berechnet (Grenzen editierbar)
- Notiz und Datum zu jeder einzelnen Note
- Notenspiegel mit Klassenschnitt; Noten aus Excel einfügen; ein- oder zweispaltige Eingabe, Fotos ein/aus

**Schüler**
- Leistungsverlauf je Bereich, Notentabelle nach Bereichsgruppen und Bereichen mit Schnitten
- Zeugnisnoten (1. HJ, 2. HJ, Jahr): gerundeter Schnitt oder manuell überschrieben
- Foto, Erinnerung und Notiz pro Fach, allgemeine Bemerkung, Strichlisten- und Fehlzeitenstatistik

**Listen** (alle druckbar bzw. als PDF; Export als Excel-kompatible CSV)
- Strichlisten (Kategorien frei definierbar, Kurztext, Einträge mit Datum)
- Fach auf einen Blick (inkl. Vorjahresnote nach dem Versetzen), Schüler auf einen Blick
- Durchschnitte (HJ1/HJ2/Jahr, Klassenschnitt), Zeugnisnoten, Klassenlisten (Fotos, Leerspalten)
- Klassenbuch: Stunden mit Thema/Hausaufgabe, Anwesenheit (fehlt/entschuldigt/verspätet), Fehlzeiten-Übersicht

**Sitzplan**
- Bis zu drei Pläne pro Klasse, Reihen/Plätze einstellbar, Drag & Drop, alphabetisch füllen
- Unterrichtsmodus: Schüler antippen → Note, Strich oder Notiz direkt eintragen

**Klassen verwalten** (Kacheln wie in der NotenBox: bearbeiten, Schüler, Sitzplan, versetzen, löschen)
- Assistent Allgemein → Fächer → Schüler → Übersicht
- Allgemein: Name, Passwort pro Klasse (verschlüsselt), Schuljahr, Noten/Notenpunkte, Plus/Minus, Rundung (2,376 ≈ 2,38 / 2,4 / 2), Gewichtung der Halbjahre
- Fächer: Baum aus Fach → Gruppe → Bereich mit Kürzel und Gewicht, sortierbar per Drag & Drop; je Fach „Durchschnitte gewichten“ oder „Jede Note einzeln gewichten“, Gruppierung an/aus, Fachteilnahme
- Schüler: Vorname/Nachname direkt in der Liste, Fotos, Fachteilnahme je Schüler, Liste aus Excel einfügen

**Klasse-Menü**
- Klasse versetzen (neues Schuljahr ohne Noten, Vorjahr verknüpft)
- Sicherheitskopie aller Klassen (JSON), Import, Import von Fächern mit Noten (CSV)
- Passwortschutz: Daten AES-256-verschlüsselt im Browser, automatische Sperre nach Inaktivität
- Hell/Dunkel, Tastenkürzel (⌘/Strg + O, N, S, P)

## Berechnung

1. Bereichsschnitt = gewichtetes Mittel der Arbeiten (Gewicht 1 oder individuell)
2. Gruppenschnitt = gewichtetes Mittel der Bereiche der Gruppe
3. Fachschnitt = gewichtetes Mittel aus Gruppen und losen Bereichen; Bereiche ohne Noten zählen nicht
4. Jahr: alle Noten gemeinsam oder Halbjahresschnitte gewichtet (einstellbar)
5. Zeugnisnote: Rundung ab einstellbarer Schwelle (Standard x,50 → schlechtere Note)

## Nicht enthalten

- Synchronisation mit Mobilgeräten, Nextcloud oder WebDAV.
- Signierung und Notarisierung bei Apple (dafür wäre ein Apple-Developer-Konto für 99 €/Jahr nötig).
- Import von NotenBox-Dateien (`.nbw`). Das Format ist verschlüsselt und proprietär.
  Weg zur Übernahme: In der NotenBox als Excel exportieren, als CSV speichern und hier unter
  „Import von Fächern mit Noten“ einlesen. Format: `Nachname;Vorname;Arbeit 1;Arbeit 2;…`
- Etikettendruck
