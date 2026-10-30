# WKO Lokal – Trainingsanalyse im Stil von WKO5

Lokale Python-App: Daten aus Garmin Connect / TrainingPeaks / Dateien → SQLite → Streamlit-Oberfläche.

## Als Mac-App installieren (eigenes Fenster, kein Browser)
```bash
cd claude/wko_local
./setup_mac.sh            # einmalig (Python-Umgebung)
./install_mac_app.sh      # baut "WKO Lokal.app" nach ~/Applications  (--system: /Applications, --uninstall: entfernen)
```
Danach per Spotlight (Cmd+Leertaste → „WKO Lokal“) oder Launchpad starten; Dock-Symbol → Optionen → „Im Dock behalten“.
Die App ist ein dünner Starter, der die `.venv` und den Code im Projektordner nutzt und die Oberfläche in einem nativen Fenster (pywebview/WKWebView) zeigt.
- **Projektordner nicht verschieben/löschen** (Pfad ist eingebaut; sonst `./install_mac_app.sh` erneut). Daten liegen in `wko_local/data/` – regelmäßig sichern (z. B. Time Machine).
- Updates: `git pull` im Projektordner, danach ggf. `./setup_mac.sh`; die App selbst muss nicht neu gebaut werden.
- Nicht signiert/notarisiert (nur lokal gebaut). Gatekeeper stört dabei normalerweise nicht, weil die App auf Deinem Mac entsteht; bei Warnung: Rechtsklick → Öffnen.
- Logs bei Problemen: `~/Library/Logs/WKO Lokal.log` und `WKO Lokal server.log`. Ist pywebview nicht nutzbar, öffnet sich automatisch der Browser.
- Garmin-Erstanmeldung mit 2FA einmalig im Terminal (`./sync.command garmin`); danach funktioniert der Button in der App.

## Fehlersuche (Mac)
- **`ImportError … incompatible architecture (have 'arm64', need 'x86_64')`**: Python lief als Intel-Prozess (Rosetta), die Pakete sind aber für Apple Silicon. `git pull && ./setup_mac.sh` erkennt eine solche Umgebung, baut sie neu und startet Python künftig immer nativ (`arch -arm64`). Die Skripte und die App erzwingen das jetzt selbst.
  Ursachen sind meist ein Terminal mit „Mit Rosetta öffnen“ (Programme → Dienstprogramme → Terminal → Informationen) oder ein Intel-Homebrew unter `/usr/local`; Apple-Silicon-Homebrew liegt unter `/opt/homebrew`.
- Prüfen: `uname -m` (soll `arm64` sein) und `.venv/bin/python -c "import platform; print(platform.machine())"`.

## Mac im Terminal (Apple Silicon / Intel)
```bash
git clone -b claude/beautiful-bardeen-tnb36k https://github.com/Cherchill90/claude.git
cd claude/wko_local
./setup_mac.sh          # legt .venv an (braucht Python >= 3.11, sonst: brew install python@3.12)
./sync.command garmin --days 365     # erster Login fragt E-Mail/Passwort/2FA, danach gecachte Tokens
./start.command         # öffnet http://localhost:8501
```
`start.command` / `sync.command` lassen sich auch per Doppelklick im Finder starten (beim ersten Mal:
Rechtsklick → Öffnen, wegen Gatekeeper). Alle Daten bleiben lokal im Ordner `data/`.
Ein Garmin-Passwort wird nicht gespeichert; nur das Token-Cache liegt in `data/garmin_tokens` – Ordner nicht teilen.

## Start
```bash
pip install -r requirements.txt
python sync.py demo                 # optional: synthetische Beispieldaten
python sync.py garmin --days 90     # GARMIN_EMAIL / GARMIN_PASSWORD (Tokens werden gecacht)
python sync.py folder               # Dateien aus data/inbox/ (FIT, TCX, GPX, CSV, ZIP, .gz)
python sync.py trainingpeaks        # experimentell, siehe unten
streamlit run app.py
```
Daten liegen unter `data/` (überschreibbar mit `WKOLOCAL_HOME`). Nach Änderung von FTP/LTHR:
`python sync.py recompute` oder Button in „Athlet & Daten“.

## Einordnung der Daten
Jede Ansicht zeigt oben eine **automatische Einordnung** (farbige Kernaussage + Details) und einen aufklappbaren Abschnitt „Wie lese ich diese Ansicht?“.
Beispiele: War die Einheit gut für ihr Ziel (Erholung/Grundlage/Tempo/Schwelle/VO2max – automatisch erkannt oder oben wählbar)? Neue Bestwerte oder höhere Effizienz gegenüber den 90 Tagen davor?
Ist die Form (TSB) passend, die Rampe tragbar, der FTP-Wert noch aktuell? Die Regeln stehen in `wkolocal/insights.py` und sind Richtwerte, keine individuelle Diagnose; Schwellen dort anpassbar.

## Funktionen (WKO5-Entsprechungen)
| Ansicht | Inhalt |
|---|---|
| Dashboard | CTL/ATL/TSB, mFTP/FRC/Pmax, Wochen-TSS, PD-Kurve |
| Workout-Analyse | Rad: Zeitreihe, NP/IF/TSS/VI/kJ/Pw:HR, Auto-Intervalle, Zonen, Quadrantenanalyse (AEPF/CPV), W'-Bilanz (dFRC-Äquivalent), MMP |
| Lauf: Pace & Critical Speed | Pace-Duration-Kurve, Critical Speed/D'-Modell (2 Parameter), Wochenkilometer, Efficiency Factor |
| Power-Duration-Kurve | MMP je Zeitraum, Vergleich, Modell (mFTP, FRC, Pmax, Stamina), Zonen aus Modell, Intervall-Planer |
| PMC | CTL/ATL/TSB, Rampenrate |
| Zeit in Zonen | 7 Leistungszonen, Wochenverlauf, Polarisierung |
| Profil & Phänotyp | Power-Profil-Level, heuristischer Phänotyp |
| Fatigue Resistance | Bestleistung nach 0/1000/2000/3000 kJ Vorbelastung |
| Fortschritt | Gleitende Modellparameter (mFTP/FRC/Pmax) und Bestwerte |
| Planung | CTL-Aufbauplan, Einzel-Workouts, PMC-Prognose |

## Laufen
- Läufe: Pace-Zeitreihe, Splits je km, steigungskorrigierte Pace (GAP) und NGP, **rTSS = h · (NGP/Schwellenpace)² · 100**, Pace-/HR-Zonen, Pace:HR-Entkopplung.
- Dafür unter „Athlet & Daten“ **Lauf-Schwellenpace** (z. B. 4:45) und Lauf-LTHR eintragen, sonst nur grobe HR-Näherung (hrTSS). Die Schwellenpace gilt als ca. 60-min-Bestpace; CS aus dem Modell liefert einen Startwert.
- Lauf-Leistungsdaten (Stryd/Garmin Running Power) werden **nicht** ausgewertet. Rad- und Lauf-TSS fließen gemeinsam in die PMC; die Vergleichbarkeit hängt von sauber gesetzten Schwellen ab.

## Grenzen (bitte lesen)
- **Kein WKO-Klon.** Das PD-Modell ist eine eigene Näherung; Werte weichen von WKO5 ab. Training Impact Score (TIS), Smart Segments, Subjektiv/Objektiv-Vergleich und die proprietären Chart-Bibliothek sind **nicht** enthalten.
- Power-Profil-Referenzwerte und Phänotyp-Regeln sind Näherungen/Heuristiken (`wkolocal/profile.py`).
- **Garmin:** inoffizielle Bibliothek `garminconnect`; kann bei Garmin-Änderungen brechen.
- **TrainingPeaks:** kein offenes API für Privatpersonen. Der Cookie-Zugriff (`TP_AUTH_COOKIE`) ist ungetestet, basiert auf nicht dokumentierten Endpunkten und kann gegen die Nutzungsbedingungen verstoßen. Robust: Dateien exportieren → `data/inbox/`.
- FIT-Import wurde nicht mit echten Garmin-Dateien getestet (CSV-Import und Analysekern sind getestet).
