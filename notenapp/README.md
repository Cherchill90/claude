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

## iPhone als Web-App (empfohlen: kostenlos, ohne Ablaufdatum)

Die Notenapp läuft auf dem iPhone als Web-App vom Home-Bildschirm: offline, ohne App Store, ohne
Apple-Entwicklerkonto und ohne 7-Tage-Grenze. Die Noten liegen auf dem iPhone in der Web-App
(IndexedDB). Abgeglichen wird über eine verschlüsselte Datei in **iCloud Drive**.

### Einmalig: Web-App veröffentlichen (GitHub Pages, kostenlos)

Die fertige Web-App liegt im Ordner `docs/` dieses Repositorys. Auf github.com:

1. Repository → **Settings → Pages**
2. „Build and deployment“ → Source: **Deploy from a branch**
3. Branch: `claude/cool-galileo-yis581`, Ordner: **/docs** → **Save**
4. Nach etwa einer Minute ist die App erreichbar unter **https://cherchill90.github.io/claude/**

Im Repository liegt nur der Programmcode, keine Noten. Die Noten bleiben auf deinen Geräten und
in deiner iCloud.

Nach Änderungen an der App: `npm run web:publish`, dann committen und pushen.

### Auf dem iPhone installieren

1. In **Safari** die Adresse öffnen → Teilen-Symbol → **Zum Home-Bildschirm**.
2. Die Notenapp ab jetzt **immer über das Symbol** starten, nicht über Safari. Nur so bleiben die
   Daten dauerhaft gespeichert (Safari löscht Daten von Webseiten, die man 7 Tage nicht besucht,
   Home-Bildschirm-Apps sind davon ausgenommen).

### Abgleich über iCloud Drive

**Mac (einmalig):** Notenapp → ⌘Y → Reiter „☁︎ iCloud-Datei“ → Sync-Passwort festlegen →
„Über Sync-Datei abgleichen“ einschalten. Der Mac legt `iCloud Drive/Notenapp/notenapp-sync.json`
an und gleicht ab dann **automatisch** ab (alle 10 Sekunden auf Änderungen geprüft, eigene
Änderungen nach 5 Sekunden geschrieben).

**iPhone:** ⟳ Sync → dasselbe Sync-Passwort eintragen (einmalig), dann:

1. **1 · Sync-Datei öffnen** → iCloud Drive → Notenapp → `notenapp-sync.json`. Änderungen vom Mac
   werden übernommen, eigene bleiben erhalten.
2. **2 · In iCloud speichern** → „In Dateien sichern“ → iCloud Drive → Notenapp → **Ersetzen**.

Faustregel: vor dem Unterricht öffnen, nach dem Unterricht speichern.

**Was passiert, wenn …**
- **… man „Beide behalten“ statt „Ersetzen“ tippt?** Es entsteht „notenapp-sync 2.json“. Der Mac
  führt beide Dateien zusammen und räumt die Kopie auf.
- **… dieselbe Note auf beiden Geräten geändert wurde?** Es gilt die neuere Änderung. Alles andere
  wird bis auf die einzelne Note zusammengeführt.
- **… man das Passwort falsch eingibt?** Die Datei wird nicht angefasst, es erscheint ein Hinweis.

**Datenschutz:** Die Sync-Datei ist mit AES-256 verschlüsselt (Schlüssel aus dem Sync-Passwort
per PBKDF2). Apple und iCloud sehen nur unlesbare Daten. Ob Lehrkräfte verschlüsselte Notendaten
in einer privaten Cloud ablegen dürfen, regelt das jeweilige Bundesland bzw. die Schule. Bitte
dort klären.

## iPhone-/iPad-App (nativ, mit Xcode)

Die iPhone-App ist dieselbe Notenapp, als native iOS-App verpackt (Capacitor). Sie speichert ihre
Daten auf dem iPhone und gleicht sie über das WLAN mit der Mac-App ab.

### Installieren (am Mac, einmalig etwa 15 Minuten)

Voraussetzungen: **Xcode** (kostenlos im Mac App Store), eine **Apple-ID**, iPhone mit iOS 16 oder neuer
und ein Kabel.

```bash
cd ~/notenapp-repo && git pull
```

```bash
cd notenapp && npm install && npm run ios
```

`npm run ios` baut die App und öffnet das Projekt in Xcode. Dort:

1. Links „App“ anklicken → Reiter **Signing & Capabilities** → bei **Team** die eigene Apple-ID wählen
   („Add an Account …“ beim ersten Mal).
2. Meldet Xcode, die Bundle-ID sei vergeben: `de.notenapp.ios` z. B. in `de.deinname.notenapp` ändern.
3. iPhone per Kabel anschließen, oben in der Geräteauswahl das iPhone wählen, **▶ (Run)** klicken.
4. Auf dem iPhone beim ersten Mal:
   - Einstellungen → Datenschutz & Sicherheit → **Entwicklermodus** einschalten (Neustart).
   - Einstellungen → Allgemein → **VPN & Geräteverwaltung** → dem eigenen Entwicklerprofil vertrauen.

**Laufzeit:** Mit einer kostenlosen Apple-ID läuft die App **7 Tage**. Danach in Xcode erneut auf ▶
klicken; die Daten bleiben erhalten. Mit dem Apple Developer Program (99 €/Jahr) läuft sie 1 Jahr
und lässt sich per TestFlight ohne Kabel installieren.

### Mit dem Mac synchronisieren

1. Mac: Notenapp → **☰ Klasse → Synchronisation mit iPhone …** (⌘Y) → „Synchronisation erlauben“.
   Fragt macOS nach eingehenden Verbindungen: **Erlauben**.
2. Mac: **„iPhone/iPad koppeln“** zeigt Adresse, Port und einen 8-stelligen Code (10 Minuten gültig).
3. iPhone: oben **⟳ Sync** → Adresse, Port und Code eintragen → **Koppeln**. iOS fragt nach dem
   lokalen Netzwerk: **Erlauben**.
4. Danach genügt **⟳ Sync**. Beim Öffnen der App wird automatisch synchronisiert (abschaltbar).

**Wie abgeglichen wird:**
- Drei-Wege-Abgleich bis auf die einzelne Note. Änderungen auf beiden Geräten bleiben erhalten.
  Wurde dieselbe Note auf beiden Geräten unterschiedlich geändert, gilt die neuere Änderung.
- Neue und gelöschte Arbeiten, Schüler und Fächer werden übernommen. Ist etwas auf einem Gerät
  gelöscht und auf dem anderen geändert worden, bleibt die Änderung erhalten.
- Klassen mit eigenem Passwort werden als Ganzes abgeglichen und bleiben verschlüsselt.
- Geräte-Einstellungen (Design, gewählte Klasse) werden nicht übertragen.

**Sicherheit:**
- Es gibt keine Cloud: Die Daten gehen nur im WLAN direkt zwischen iPhone und Mac hin und her.
- Der Code selbst wird nie übertragen. Das iPhone weist ihn kryptografisch nach (PBKDF2), danach
  erhält es einen zufälligen 256-Bit-Schlüssel.
- Jede Übertragung ist mit AES-256-GCM verschlüsselt. Mitgeschnittene Anfragen lassen sich nicht
  wiederholen.
- Nach 10 falschen Codes endet die Kopplung. Geräte lassen sich am Mac jederzeit entfernen.

**Voraussetzungen:** Der Mac muss wach sein, die Notenapp muss dort geöffnet und entsperrt sein,
und beide Geräte müssen im selben WLAN sein. In manchen Schul-WLANs ist die Verbindung zwischen
Geräten gesperrt. Dann funktioniert der Abgleich nur zu Hause oder über einen Hotspot des iPhones.

**Backups auf dem iPhone:** vor jeder Synchronisation und beim Wechsel in den Hintergrund (nur wenn
sich etwas geändert hat), unter Dateien → Auf meinem iPhone → Notenapp → Backups. Backups älter als
3 Monate werden gelöscht. Exporte (CSV, Sicherheitskopie) liegen daneben unter „Exporte“.
Drucken ist auf dem iPhone nicht verfügbar.

## Entwicklung

```bash
npm run dev      # Browser-Version, http://localhost:5173 (speichert im localStorage)
npm test         # Tests: Notenberechnung, CSV, Abgleich, Verschlüsselung, Sync-Server, Backups
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

- Synchronisation über Nextcloud/WebDAV oder über das Internet (nur WLAN, direkt mit dem Mac).
- Android-App.
- Signierung und Notarisierung bei Apple (dafür wäre ein Apple-Developer-Konto für 99 €/Jahr nötig).
- Import von NotenBox-Dateien (`.nbw`). Das Format ist verschlüsselt und proprietär.
  Weg zur Übernahme: In der NotenBox als Excel exportieren, als CSV speichern und hier unter
  „Import von Fächern mit Noten“ einlesen. Format: `Nachname;Vorname;Arbeit 1;Arbeit 2;…`
- Etikettendruck
