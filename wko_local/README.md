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

## Oberfläche
- Navigation in Bereichen (Übersicht · Analyse · Planung · Daten) mit Icons; Filter für Sportart und Zeitraum in der Seitenleiste.
- Dashboard mit Empfehlungskarte, Form-Kacheln mit Mini-Verläufen, klickbaren „Letzten Einheiten“ (Klick öffnet die Workout-Analyse).
- Hell/Dunkel folgt der Systemeinstellung (umschaltbar: Menü ⋮ → Settings). Design: `.streamlit/config.toml`, `wkolocal/ui.py` (validierte Farbpalette, keine Doppel-Y-Achsen – mehrere Messgrößen als gestapelte Teilgrafiken mit gemeinsamer Zeitachse).
- Geschwindigkeit: alle teuren Berechnungen (PMC, Modelle, Zonen, Fortschritt, Empfehlung) werden zwischengespeichert und nur nach Datenänderung neu berechnet; Interaktionen ca. 0,2–0,5 s. Der allererste Aufruf nach dem Start dauert einige Sekunden.

## Rad oder Lauf wählen, Kraft dazu
- Dashboard: Unter der Empfehlung wählst Du **Rad** oder **Lauf** („empfohlen“ markiert die Regel-Wahl). Die Einheit wird für die gewählte Sportart neu zusammengestellt; nach einem harten/langen Lauf wird ein gewählter Lauf locker statt hart (Stoßbelastung).
- Bei **Lauf** kann eine **Krafteinheit** dazu geplant werden (`wkolocal/strength.py`): Programm je nach Erfahrung (Einsteiger/Geübt, unter „Athlet & Daten → Einstellungen“), Zeitpunkt (am Tag harter Läufe, nach dem Lauf, mit Abstand), keine schwere Beinkraft vor Schlüsseleinheiten/Wettkampf, ≥ 48 h zwischen Krafteinheiten, 2×/Woche bzw. 1× Erhalt im Wettkampfblock. Erledigte Einheiten per Knopf erfassen; Garmin-Krafteinheiten werden erkannt. Quellen: Q24–Q32.

## Laufauswertung (nur studienbelegte Regeln)
Ansicht **Analyse → Laufauswertung** (`wkolocal/runplan.py`), abgeleitet aus dem Regelwerk „Evidenzbasierte Trainingsplanung für Ausdauerlauf“ v1.0, beschränkt auf belastbare Studien:
- Wochenumfang, Intensitätsverteilung (3 Zonen nach HF; Methode wird angezeigt), Läufe/Woche – beschreibend, ohne Sollwerte [Q6, Q4].
- **Einzel-Lauf-Steigerung:** Warnung bei Läufen > 10 % über dem längsten Lauf der letzten 30 Tage; die Tagesempfehlung begrenzt Läufe entsprechend [Q37].
- **Taper:** 2 Wochen, Umfang exponentiell −41–60 %, Intensität und Häufigkeit unverändert – in Auswertung und Tagesempfehlung (A-Rennen) [Q36].
- Nicht übernommen: 10-%-Wochenregel [Q38], Phasenanteile, Entlastungsrhythmus, 32-km-Deckel [Q35], feste Zonen-Sollwerte [Q33, Q34]. JSON-Export der Auswertung.

## Trainingsempfehlung & Wettkämpfe
- **Dashboard → „Trainingsempfehlung für morgen“:** regelbasiert aus Form (TSB), harten Einheiten der letzten Tage, Trainingsserie, Rampe, Wettkämpfen und Plan – mit konkreter Einheit (Dauer, Watt- bzw. Pace-Bereiche, geschätzte TSS) und Begründung. Dein Befinden (Gut/Normal/Müde/Krank) stellst Du direkt darüber ein. Schlaf/HRV/Termine kennt das Programm nicht. Regeln: `wkolocal/recommend.py`.
- **PMC → „Wettkämpfe anlegen & verwalten“:** Datum, Name, Sportart, Priorität A/B/C, erwartete Dauer/Intensität (→ TSS-Schätzung). Wettkämpfe erscheinen als Markierung im PMC, die Prognose (gepunktet) zeigt Fitness/Form am Renntag; Tapering, Aktivierung und Erholung nach dem Rennen fließen in die Empfehlung ein.

## Schlaf, HRV & Ruhepuls (Garmin)
- `python sync.py garmin` lädt jetzt zusätzlich **Schlaf (Dauer, Phasen, Score), HRV (Nacht, 7-Tage, Garmin-Normbereich) und Ruhepuls**; nur Wellness: `python sync.py wellness --days 90`; abwählbar mit `--no-wellness` bzw. dem Haken in der App. Die letzten 3 Tage werden immer neu geladen (Garmin ergänzt Daten nachträglich). Pro Tag sind 2 Abrufe nötig – ein erster Lauf über viele Monate dauert einige Minuten; bei 3 Fehlern in Folge bricht der Sync ab (mögliche Sperre).
- Neue Ansicht **„Erholung (HRV & Schlaf)“**: Ampel aus den letzten 3 Nächten gegen Deine Baseline (28 Nächte davor) für HRV, Schlaf, Schlafscore und Ruhepuls.
- **Form:** CTL/ATL/TSB bleiben reine Trainingslast. Zusätzlich gibt es **„Form inkl. Erholung“** = TSB − 5 je Warnsignal (max. 25), im Dashboard und als gestrichelte Linie im PMC. Diese angepasste Form steuert die Trainingsempfehlung; bei stark eingeschränkter Erholung wird zusätzlich eine Stufe herabgestuft. Der Abzug ist eine Heuristik, nicht wissenschaftlich kalibriert.
- Die Felder der Garmin-Antworten sind aus der Bibliotheksdokumentation übernommen; gegen echte Konten wurde nicht getestet.

## Quellen & Evidenz
Ansicht **„Quellen & Evidenz“** listet die Studien hinter den Hinweisen (aus drei Trainings-Videos und einer Websuche), je mit Video-Aussage, Befund laut Abstract und Grenzen; Datei: `wkolocal/evidence.py`. Einordnung statt Übernahme: Mehrere Trainerbehauptungen (z. B. „90/10 optimal“, Kohlenhydrate hätten die Peloton-FTP gehoben) sind durch die zitierten Studien nicht gedeckt und wurden nicht als Regel übernommen. Supplement-Empfehlungen sind bewusst nicht Teil der App. Die Trainingsempfehlung zeigt unter „Quellen zu dieser Empfehlung“ die zugrunde liegenden Studien ([Qn]) mit Grenzen. Übernommen wurden: Verpflegungsrichtwerte nach Dauer/Intensität, optionale Steigerungen für Läufer, optionaler später intensiver Block in langen Einheiten, langer Lauf (≥ 90 min) zählt zum Intensitätskontingent, Hinweis auf lange Einheiten, wenn 14 Tage keine (Rad ≥ 2 h, Lauf ≥ 1,5 h) stattfand, Hinweis auf Umfang unter dem 4-Wochen-Schnitt, Kraft-Zusatz (2×/Woche), differenziertere Texte zu Zonenverteilung und Ermüdungsresistenz (kJ/kg-Anzeige).

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
