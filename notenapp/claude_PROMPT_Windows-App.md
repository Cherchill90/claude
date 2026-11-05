# Prompt: Notenverwaltung als Windows-App

Erstelle eine Windows-Desktop-App zur Notenverwaltung für Lehrkräfte. Funktionsumfang und
Bedienkonzept orientieren sich an der Mac-App „NotenBox“. Nachgebaut werden nur Funktionen und
Bedienlogik, weder Code noch Grafiken noch das Dateiformat der NotenBox. Bedienoberfläche, Texte
und Hilfe sind auf Deutsch.

## 1. Technik und Auslieferung

- Electron + React + Vite. Daten werden lokal gespeichert, es gibt keinen Server.
- Installer über electron-builder als NSIS-`.exe` für Windows 10/11 (x64, optional arm64), mit
  Startmenü- und Desktop-Verknüpfung und Deinstallation. Zusätzlich eine portable Variante.
- Build-Befehl `npm run dist:win`. Beschreibe, wie man auf einem Windows-PC baut. Optional: eine
  GitHub-Actions-Pipeline auf `windows-latest`, die den Installer als Artefakt bereitstellt.
- Ohne Code-Signing-Zertifikat warnt Windows SmartScreen. Erkläre in der README den Weg „Weitere
  Informationen → Trotzdem ausführen“.
- Sicherheit im Fenster: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.
  Der Datenzugriff läuft nur über ein Preload-Skript per IPC.
- Wichtig: `prompt()` funktioniert in Electron nicht. Für Eingaben eigene Dialoge verwenden.

## 2. Automatisches Speichern und Backups

- Speicherort: `%APPDATA%\Notenapp\notenapp-daten.json`.
- Jede Änderung wird nach etwa 250 ms automatisch gespeichert. Das Schreiben ist atomar: erst in
  eine temporäre Datei, dann umbenennen. Ungültiges JSON wird nie gespeichert. Eine Anzeige oben
  rechts zeigt „✓ Gespeichert“ / „Speichert …“ / „⚠ Speicherfehler“.
- **Vor jedem Beenden wird ein Backup angelegt.** Ablauf:
  1. Das Beenden abfangen (`before-quit`).
  2. Die Oberfläche speichert sofort, mit Timeout als Absicherung.
  3. Die Datendatei wird nach `%APPDATA%\Notenapp\Backups\Notenapp-Backup-JJJJ-MM-TT_hh-mm-ss.json`
     kopiert.
  4. Erst dann beendet sich die App.
- Das Schließen des letzten Fensters beendet die App, damit das Backup immer entsteht.
- **Backups, die älter als 3 Monate sind, werden automatisch gelöscht**, beim Start und beim
  Beenden. Maßgeblich ist das Datum im Dateinamen, ersatzweise das Änderungsdatum. Andere Dateien
  im Ordner bleiben unangetastet.
- Menü „Backup wiederherstellen …“: Vorher wird der aktuelle Stand selbst gesichert. Zusätzlich
  gibt es „Backup-Ordner im Explorer zeigen“.
- Speicher- und Backup-Logik liegt in einem eigenen Modul ohne Electron-Abhängigkeit und hat
  Unit-Tests.

## 3. Aufbau der Oberfläche

**Linke Seitenleiste:**
- Klasse (gruppiert nach Schuljahr), Fach, Umschalter „1. HJ / 2. HJ / Jahr“.
- Darunter kontextabhängige Listen, je nach Reiter.

**Reiter oben:**
- **Noten**
- **Schüler**
- **Listen ▾** mit Strichlisten, Fach auf einen Blick, Schüler auf einen Blick, Durchschnitte,
  Zeugnisnoten, Klassenlisten, Klassenbuch
- **Sitzplan**

**Rechts oben:** Speicheranzeige, Menü „☰ Klasse“, „Drucken“, „Hilfe“.

**Native Windows-Menüleiste (deutsch):**
- Datei/Klasse: Klassen verwalten (Strg+O), Neue Klasse (Strg+N), Klasse versetzen,
  Sicherheitskopie exportieren (Strg+S), Importieren, Import von Fächern mit Noten, Backup
  wiederherstellen, Backup-Ordner zeigen, Sperren (Strg+L), Drucken (Strg+P), Einstellungen,
  Beenden
- Bearbeiten: Rückgängig, Ausschneiden, Kopieren, Einfügen, Alles auswählen
- Ansicht: Zoom, Vollbild
- Hilfe

**Allgemein:**
- Hell- und Dunkelmodus (wie System oder fest wählbar).
- Leerer Startbildschirm mit den Knöpfen „Neue Klasse“, „Beispielklasse laden“, „Noten aus CSV
  importieren“ und „Sicherheitskopie importieren“.
- **Demo- und Testdaten enthalten keine echten Namen**, nur „Schüler 01“ usw.

## 4. Datenmodell

- **Klasse:** Name, Schuljahr (z. B. 2026/27), Benotungseinstellungen, Fächer, Schüler, Arbeiten,
  Zeugnisnoten-Überschreibungen, Strichlisten-Kategorien und -Einträge, Klassenbuch-Stunden,
  bis zu 3 Sitzpläne.
- **Fach:** Name, Gewicht im Gesamtschnitt, Berechnungsart („Durchschnitte gewichten“ /
  „Jede Note einzeln gewichten“), Gruppierung an/aus, Bereichsgruppen, Bereiche, Fachteilnahme
  (Liste ausgeschlossener Schüler).
  - Gruppe: Name, Kürzel, Gewicht.
  - Bereich: Name, Kürzel, Gewicht, Farbe, optional zugehörige Gruppe.
- **Arbeit:** Titel, Fach, Bereich, Halbjahr, Datum (optional, „Mit Datum“), Schreibschutz,
  „Individuell gewichten“ mit Gewicht, Notenschlüssel (an/aus, maximale Punkte, Prozentgrenzen),
  Notiz. Je Schüler ein Ergebnis aus Note, Punkten, Notiz und eigenem Datum.
- **Schüler:** Vorname, Nachname, Foto (verkleinert auf etwa 192 px, JPEG), Bemerkung, Notiz pro
  Fach, Erinnerung pro Fach.

## 5. Benotung und Berechnung

- **Benotungsart pro Klasse:**
  - Noten 1–6 mit Tendenzen (2+, 3−, 2,5), Plus/Minus-Wert einstellbar (Standard 0,25; 0,33 für
    Drittelnoten), Schalter „Plus/Minus im Schnitt berücksichtigen“.
  - Oder Notenpunkte 0–15.
- **Ungültige Eingaben** werden rot markiert.
- **Rundung:** Auswahl „2,376 ≈ 2“ / „≈ 2,4“ / „≈ 2,38“ / „≈ 2,376“ (0–3 Nachkommastellen).
  Anzeige und Zeugnisnote beruhen auf dem gerundeten Schnitt.
- **Zeugnisnote:**
  - Noten: ab einer einstellbaren Schwelle (Standard x,50) zur schlechteren Note.
  - Punkte: ab ,5 aufrunden.
  - Manuell überschreibbar; leeres Feld bedeutet gerundeter Schnitt.
- **Bereichsschnitt:** gewichtetes Mittel der Arbeiten (Gewicht 1 oder individuell).
- **„Durchschnitte gewichten“ (Standard):**
  1. Gruppenschnitt = gewichtetes Mittel der Bereiche der Gruppe.
  2. Fachschnitt = gewichtetes Mittel aus Gruppen und losen Bereichen.
  3. Bereiche ohne Noten zählen nicht.
- **„Jede Note einzeln gewichten“:** Alle Noten kommen in einen Topf. Gewicht jeder Note =
  Arbeit × Bereich × Gruppe.
- **Gruppierung aus:** Gruppen werden ignoriert, die Bereiche zählen direkt.
- **Halbjahresgewichtung:**
  - „Ø – Gesamt aus allen Noten“
  - 1:1, 1:2, 2:1, „Nur 2. Halbjahr“
  - eigene Gewichte
- **Gesamtschnitt** über alle Fächer, nach Fachgewicht. Nur Fächer, an denen der Schüler
  teilnimmt.
- **Notenschlüssel:**
  - Prozentgrenzen pro Notenstufe, editierbar.
  - Standard für Noten: 1 ≥ 92 %, 2 ≥ 81 %, 3 ≥ 67 %, 4 ≥ 50 %, 5 ≥ 30 %, sonst 6.
  - Für Punkte eine eigene Standardtabelle von 15 (≥ 95 %) bis 0.
  - Anzeige der Punktbereiche je Note. Die Note wird aus den Punkten berechnet.
- Alle Rechenregeln mit Unit-Tests absichern.

## 6. Reiter „Noten“

- **Links:** Bereichsauswahl (nach Gruppen gegliedert), Liste der Arbeiten mit Datum und Ø, Knopf
  „+ Neue Arbeit“, Schülerzahl.
- **Mitte links, „Arbeitsdetails“:** Titel, Schreibschutz, Mit Datum + Datum, Halbjahr, Bereich,
  Individuell gewichten, Notenschlüssel (Max.-Punkte, Tabelle bearbeiten), Notiz zur Arbeit,
  „Noten importieren“ (eine Note pro Zeile einfügen), Arbeit löschen.
- **Mitte, Eingabe:** Schülerliste mit Foto (ein-/ausblendbar), ein- oder zweispaltig. Notenfeld
  bzw. Punkte- und Notenfeld. Enter/↓/↑ springen zum nächsten Schüler.
- **Rechts:** gewählter Schüler mit „Notiz zur Leistung“ und eigenem Datum. Darunter Ø der Arbeit
  und Notenspiegel als horizontale Balken mit Anzahl und Prozent.

## 7. Reiter „Schüler“

- **Links:** Schülerliste mit Foto bzw. Initialen und Fachschnitt; „Schüler bearbeiten“.
- **Mitte:**
  - Leistungsverlauf als Liniendiagramm, eine Linie je Bereich in Bereichsfarbe, mit Legende und
    Hover-Tooltip. Bei Noten liegt „besser“ oben.
  - Notentabelle: Kopf mit Gruppen und Bereichen samt Ø, Gewicht und Anzahl.
- **Noten in dieser Tabelle direkt bearbeiten:**
  - Jede Arbeit des Bereichs ist eine Zeile, auch ohne Note.
  - Eingaben ändern dieselben Daten wie die Notenansicht, beide Ansichten sind sofort synchron.
  - Schreibschutz, Notenschlüssel (Punktefeld) und Fachteilnahme werden beachtet.
  - Leere letzte Zeile „+“: Eine Note eintippen legt eine neue Arbeit mit heutigem Datum im Bereich
    an.
  - Der Titel unter der Note öffnet die Arbeit in der Notenansicht.
- **Rechts, einklappbar:**
  - „Zeugnisnoten“ für 1. HJ, 2. HJ und Jahr: Ø, gerundet, überschreibbar.
  - „Statistik & Notizen“: Foto wählen/entfernen, Erinnerung im Fach, Notiz zum Fach, allgemeine
    Bemerkung, Strichlisten-Zählung, Fehlzeiten.

## 8. Listen

Alle Listen lassen sich drucken bzw. als PDF speichern und als Excel-kompatible CSV exportieren
(Semikolon, UTF-8 mit BOM).

- **Strichlisten:**
  - Kategorien frei definierbar. Standard: Hausaufgaben vergessen, Material vergessen, Mitarbeit +,
    Mitarbeit −, Störung.
  - „+“ setzt einen Strich mit Datum und optionalem Kurztext. Einträge lassen sich ansehen und
    löschen.
- **Fach auf einen Blick:** Bereichsschnitte (Kürzel als Spaltenkopf), Gruppenschnitte, Ø Fach,
  Zeugnisnote. Nach dem Versetzen zusätzlich die Vorjahresnote.
- **Schüler auf einen Blick:** pro Schüler alle Fächer mit Einzelnoten, Ø 1. HJ / 2. HJ / Jahr,
  Zeugnisnote, Notiz, Gesamtschnitt, Strichlisten. Druck mit Seitenumbruch pro Schüler.
- **Durchschnitte:** je Fach 1. HJ / 2. HJ / Jahr plus Gesamt. Fußzeile mit Klassenschnitt.
- **Zeugnisnoten:** Tabelle Schüler × Fächer, direkt überschreibbar.
- **Klassenlisten:** nummeriert, optional mit Fotos, einstellbare Zahl von Leerspalten.
- **Klassenbuch:**
  - Stunden mit Datum, Fach, Thema und Hausaufgabe.
  - Anwesenheit pro Schüler: fehlt / entschuldigt / verspätet.
  - Übersicht der Fehlzeiten.

## 9. Sitzplan

- Bis zu 3 Pläne pro Klasse, Reihen und Plätze einstellbar.
- **Modus „Bearbeiten“:**
  - Schüler per Drag & Drop oder Klick-dann-Klick platzieren; besetzte Plätze werden getauscht.
  - „Alphabetisch füllen“, „Alle Plätze leeren“.
- **Modus „Unterricht“:**
  - Arbeit wählen oder „+ Neue mündliche Note (heute)“.
  - Ein Klick auf einen Schüler öffnet einen Dialog: Note eintragen, Strich setzen, Notiz zum Fach,
    Erinnerung sehen, „Schülerdetails öffnen“.
  - Die Note erscheint als Plakette am Platz.

## 10. Klassen verwalten

- **Übersicht als Kacheln:** Name, Schülerzahl, Fächer, Schuljahr. Knöpfe: Bearbeiten, Schüler,
  Sitzplan, „versetzen“, Löschen. Die aktive Klasse ist hervorgehoben.
- **Assistent mit den Schritten Allgemein → Fächer → Schüler → Übersicht** (Pfeile ‹ ›,
  „Fertig“).
- **Allgemein:**
  - Klassenname.
  - **Passwort pro Klasse** mit Wiederholung. Die Klasse wird mit AES-256-GCM verschlüsselt, der
    Schlüssel über PBKDF2 mit 250.000 Runden abgeleitet.
  - Schuljahr.
  - Noteneinstellungen, Rundung, Gewichtung der Halbjahre.
- **Fächer, als Baum Fach → Gruppe → Bereich:**
  - Inline bearbeitbare Namen, Kürzel und Gewichte; Papierkorb; Sortieren per Drag & Drop.
  - Platzhalterzeilen „Neuer Bereich“, „Neue Gruppe“, „Neues Fach“ für **jedes** Fach, auch für
    importierte. Eine neue Gruppe schaltet die Gruppierung automatisch ein.
  - Rechtes Detailfeld beim Fach: Berechnungsart, „Gruppierung“, „Fachteilnahme x von y“ mit
    Checkliste.
  - Rechtes Detailfeld bei der Gruppe: Checkliste „Bereiche in dieser Gruppe“.
  - Rechtes Detailfeld beim Bereich: Farbe, Gruppe wählen inkl. „+ Neue Gruppe …“.
- **Schüler:**
  - Tabelle Vorname | Nachname | Foto, direkt bearbeitbar.
  - Leere letzte Zeile für neue Schüler (Enter).
  - „Liste einfügen“ aus Excel: Tab, „Nachname, Vorname“, „Nachname;Vorname“ oder
    „Vorname Nachname“.
  - Rechts: Foto, Löschen (entfernt auch Noten, Striche, Fehlzeiten, Sitzplätze), Fachteilnahme
    je Fach.
- **Übersicht:** Zusammenfassung aller Einstellungen, Fächer, Gruppen, Bereiche und Gewichte.
- **Klasse versetzen:** Neue Klasse im nächsten Schuljahr mit Name +1 (z. B. 5D → 6D), gleichen
  Schülern, Fächern, Einstellungen und Sitzplänen, ohne Noten. Die alte Klasse bleibt erhalten
  und ist als Vorjahr verknüpft.

## 11. Import und Export

- **Sicherheitskopie aller Klassen** als JSON exportieren und importieren (ersetzen oder
  hinzufügen).
- **CSV-Erkennung:** Wird über „Importieren“ eine CSV gewählt, leitet die App sie automatisch an
  den Noten-Import weiter, statt mit einem JSON-Fehler abzubrechen.
- **„Import von Fächern mit Noten“ (CSV, z. B. Excel-Export der NotenBox), mit Vorschau-Dialog:**
  - **Parser:** Anführungszeichen, Trenner `;` / Tab / `,`, UTF-8 oder Windows-1252 (Umlaute aus
    Excel). Eine `.xlsx` wird mit dem Hinweis „als CSV speichern“ abgewiesen.
  - **Automatische Erkennung:**
    - Anzahl der Kopfzeilen; verbundene Zellen erben von links.
    - Namensspalten: „Nachname, Vorname“, „Vorname Nachname“ oder zwei Spalten bzw. per Kopf
      „Vorname/Nachname“.
    - Notenspalten.
    - Datum im Kopf (TT.MM.JJJJ) wird zum Datum der Arbeit.
    - Ø-, Schnitt-, Zeugnis- und Gesamt-Spalten sowie Ø-Zeilen werden standardmäßig ausgelassen.
    - Notenpunkte und Noten werden unterschieden.
  - **Einstellbar:** Ziel-Klasse (oder neue Klasse), Ziel-Fach (oder neues Fach mit Dateiname als
    Vorschlag), Halbjahr, Kopfzeilen, Namensspalten. Je Spalte: importieren ja/nein, Titel, Datum,
    Bereich (vorhandener oder neuer Bereich mit Spaltenname).
  - **Vorschau:** Kopf-, Schüler- und übersprungene Zeilen farbig markiert. Zähler für gültige
    Werte und neu anzulegende Schüler.
  - **Andere Benotungsart:** Passt die Datei nicht zur Benotungsart der Klasse, bietet der Dialog
    an, die Klasse umzustellen.
  - **Zuordnung:** Schüler werden über den Namen zugeordnet, auch mit vertauschtem Vor- und
    Nachnamen. Fehlende Schüler werden angelegt.
  - **Ergebnis:** Importierte Fächer haben die Gruppierung eingeschaltet. Nach dem Import ist das
    neue Fach ausgewählt.

## 12. Farbskala für Leistungen

- Noten und Schnitte erhalten einen farbigen Hintergrund.
- Stufenlos von **grün (Note 1 / 15 Punkte)** über Gelb und Orange bis **rot (Note 4 und
  schlechter / 5 Punkte und weniger)**. Farbton = 130° × (1 − t), wobei t zwischen 0 und 1
  begrenzt wird:
  - Noten: t = (Wert − 1) / 3
  - Punkte: t = (15 − Wert) / 10
- **Angewendet auf:** Noteneingabe, Ø in der Arbeitenliste, Schülerliste, Notenzellen,
  Fachschnitt, Zeugnisnoten, alle Listen, Plakette im Sitzplan.
- Die Zahl bleibt immer sichtbar (wegen Rot-Grün-Sehschwäche).
- Eigene Töne für den Dunkelmodus. Die Farben werden mitgedruckt.
- In den Einstellungen abschaltbar.

## 13. Datenschutz und Sperre

- **Optionales globales Passwort:** Alle Daten werden verschlüsselt gespeichert, auch die Backups.
- **Automatische Sperre** nach einstellbarer Inaktivität (Standard 15 Minuten). Gilt für das
  globale Passwort und für Klassenpasswörter.
- **Sperrbildschirm** mit der Meldung „Falsches Passwort“ bei Fehleingabe.
- Kein Passwort-Reset möglich. Die README weist darauf hin.

## 14. Qualität und Lieferung

- Unit-Tests für Notenberechnung, CSV-Parser und Layout-Erkennung sowie Speichern und
  Backup-Aufbewahrung.
- Oberflächentest mit Playwright (Electron), der prüft:
  - Autosave in die Datei
  - Backup beim Beenden
  - Löschen alter Backups
  - Neustart mit erhaltenen Daten
  - Klassenpasswort
  - CSV-Import
- README auf Deutsch: Installation, Build, Speicherort, Backups, Wiederherstellen,
  SmartScreen-Hinweis, bekannte Grenzen.
- **Nicht enthalten:**
  - Synchronisation mit Mobilgeräten, Nextcloud oder WebDAV
  - Etikettendruck
  - Import des verschlüsselten NotenBox-Formats `.nbw`
