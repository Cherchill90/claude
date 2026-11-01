# Notenapp – Notenverwaltung für Lehrkräfte

Eigenständige Web-App (React + Vite). Funktionsumfang und Bedienkonzept orientieren sich an der
NotenBox für Mac: Klasse/Fach/Bereich-Auswahl links, Reiter **Noten · Schüler · Listen · Sitzplan**,
Klasse-Menü rechts oben.

## Start

```bash
cd notenapp
npm install
npm run dev      # Entwicklung, http://localhost:5173
npm run build    # statische Dateien in dist/ (per Doppelklick nicht lauffähig, über Webserver öffnen)
npm test         # Tests der Notenberechnung
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

**Klasse-Menü**
- Klassen verwalten (Schüler inkl. Listenimport, Fächer, Bereichsgruppen/Bereiche mit Gewichten und Farben, Benotungsart, Plus/Minus-Wert, Rundung, Halbjahresgewichtung)
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

- Synchronisation mit Mobilgeräten, Nextcloud oder WebDAV. Daten liegen lokal im Browser,
  deshalb regelmäßig eine Sicherheitskopie erstellen.
- Import von NotenBox-Dateien (`.nbw`). Das Format ist verschlüsselt und proprietär.
  Weg zur Übernahme: In der NotenBox als Excel exportieren, als CSV speichern und hier unter
  „Import von Fächern mit Noten“ einlesen. Format: `Nachname;Vorname;Arbeit 1;Arbeit 2;…`
- Etikettendruck
