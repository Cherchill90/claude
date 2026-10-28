"""TrainingPeaks-Sync.

WICHTIG: TrainingPeaks bietet für Privatpersonen KEIN offenes API (nur Partner-Programm).
Zwei Wege:

1. EMPFOHLEN & robust: Dateien manuell exportieren (Workout -> Download/Export als FIT/TCX/CSV,
   oder das Original-Gerätefile) und in `data/inbox/` legen -> `python sync.py folder`.
2. EXPERIMENTELL (ungetestet): Zugriff über die inoffiziellen Web-Endpunkte mit Deinem
   Session-Cookie `Production_tpAuth` (Browser-Dev-Tools -> Application -> Cookies).
   Die Endpunkte sind nicht dokumentiert und können sich jederzeit ändern. Nutzung auf eigenes
   Risiko und ggf. entgegen den TrainingPeaks-Nutzungsbedingungen.
"""
from __future__ import annotations

import os
from datetime import date, timedelta
from pathlib import Path

import requests

from .. import ingest
from ..parsers import parse_file

TOKEN_URL = "https://tpapi.trainingpeaks.com/users/v3/token"
USER_URL = "https://tpapi.trainingpeaks.com/users/v3/user"
BASE = "https://tpapi.trainingpeaks.com/fitness/v6/athletes"


def sync(days: int = 30, log=print) -> tuple[int, int, list[str]]:
    cookie = os.environ.get("TP_AUTH_COOKIE")
    if not cookie:
        raise SystemExit("Setze TP_AUTH_COOKIE (Wert des Cookies 'Production_tpAuth'), "
                         "oder exportiere Dateien nach data/inbox/ und nutze `sync.py folder`.")
    s = requests.Session()
    r = s.get(TOKEN_URL, headers={"Cookie": f"Production_tpAuth={cookie}"}, timeout=30)
    r.raise_for_status()
    s.headers["Authorization"] = f"Bearer {r.json()['token']['access_token']}"
    athlete_id = s.get(USER_URL, timeout=30).json()["user"]["personId"]
    a, b = date.today() - timedelta(days=days), date.today()
    workouts = s.get(f"{BASE}/{athlete_id}/workouts/{a}/{b}", timeout=60).json()
    log(f"TrainingPeaks: {len(workouts)} Workouts")
    new = skipped = 0
    errors = []
    for w in workouts:
        wid = w.get("workoutId")
        try:
            resp = s.get(f"{BASE}/{athlete_id}/workouts/{wid}/rawzipfiledata", timeout=60)
            if resp.status_code != 200 or not resp.content:
                continue  # geplante Workouts / manuelle Einträge ohne Datei
            for act in parse_file(Path(f"{wid}.zip"), resp.content):
                act["name"] = w.get("title") or act["name"]
                if ingest.add_activity(act, "trainingpeaks"): new += 1
                else: skipped += 1
        except Exception as e:
            errors.append(f"{wid}: {e}")
    return new, skipped, errors
