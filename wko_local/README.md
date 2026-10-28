# WKO Lokal – Trainingsanalyse im Stil von WKO5

Lokale Python-App: Daten aus Garmin Connect / TrainingPeaks / Dateien → SQLite → Streamlit-Oberfläche.

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

## Funktionen (WKO5-Entsprechungen)
| Ansicht | Inhalt |
|---|---|
| Dashboard | CTL/ATL/TSB, mFTP/FRC/Pmax, Wochen-TSS, PD-Kurve |
| Workout-Analyse | Zeitreihe, NP/IF/TSS/VI/kJ/Pw:HR, Auto-Intervalle, Zonen, Quadrantenanalyse (AEPF/CPV), W'-Bilanz (dFRC-Äquivalent), MMP |
| Power-Duration-Kurve | MMP je Zeitraum, Vergleich, Modell (mFTP, FRC, Pmax, Stamina), Zonen aus Modell, Intervall-Planer |
| PMC | CTL/ATL/TSB, Rampenrate |
| Zeit in Zonen | 7 Leistungszonen, Wochenverlauf, Polarisierung |
| Profil & Phänotyp | Power-Profil-Level, heuristischer Phänotyp |
| Fatigue Resistance | Bestleistung nach 0/1000/2000/3000 kJ Vorbelastung |
| Fortschritt | Gleitende Modellparameter (mFTP/FRC/Pmax) und Bestwerte |
| Planung | CTL-Aufbauplan, Einzel-Workouts, PMC-Prognose |

## Grenzen (bitte lesen)
- **Kein WKO-Klon.** Das PD-Modell ist eine eigene Näherung; Werte weichen von WKO5 ab. Training Impact Score (TIS), Smart Segments, Subjektiv/Objektiv-Vergleich und die proprietären Chart-Bibliothek sind **nicht** enthalten.
- Power-Profil-Referenzwerte und Phänotyp-Regeln sind Näherungen/Heuristiken (`wkolocal/profile.py`).
- **Garmin:** inoffizielle Bibliothek `garminconnect`; kann bei Garmin-Änderungen brechen.
- **TrainingPeaks:** kein offenes API für Privatpersonen. Der Cookie-Zugriff (`TP_AUTH_COOKIE`) ist ungetestet, basiert auf nicht dokumentierten Endpunkten und kann gegen die Nutzungsbedingungen verstoßen. Robust: Dateien exportieren → `data/inbox/`.
- FIT-Import wurde nicht mit echten Garmin-Dateien getestet (CSV-Import und Analysekern sind getestet).
