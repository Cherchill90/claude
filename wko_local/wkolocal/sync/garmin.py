"""Garmin-Connect-Sync über die inoffizielle Bibliothek `garminconnect` (kein offizielles API).

Zugangsdaten: Umgebungsvariablen GARMIN_EMAIL / GARMIN_PASSWORD (nur beim ersten Login nötig;
danach werden Tokens in data/garmin_tokens wiederverwendet). Bei aktiver 2FA wird der Code
interaktiv abgefragt.
"""
from __future__ import annotations

import getpass
import os
from datetime import date, timedelta

from .. import config, ingest
from ..parsers import parse_file
from pathlib import Path


def _login():
    from garminconnect import Garmin
    config.ensure_dirs()
    tok = str(config.TOKEN_DIR)
    try:
        g = Garmin()
        g.login(tok)
        return g
    except Exception:
        pass
    try:
        email = os.environ.get("GARMIN_EMAIL") or input("Garmin E-Mail: ")
        pw = os.environ.get("GARMIN_PASSWORD") or getpass.getpass("Garmin Passwort: ")
        g = Garmin(email, pw, prompt_mfa=lambda: input("2FA-Code: "))
    except EOFError:
        raise SystemExit("Garmin-Anmeldung braucht interaktive Eingabe. Einmalig im Terminal ausführen: "
                         "./sync.command garmin  (danach funktioniert der Button in der App ohne Passwort).")
    g.login(tok)
    return g


def sync(days: int = 30, since: date | None = None, log=print) -> tuple[int, int, list[str]]:
    from garminconnect import Garmin
    g = _login()
    start = since or (date.today() - timedelta(days=days))
    acts = g.get_activities_by_date(start.isoformat(), date.today().isoformat())
    log(f"Garmin: {len(acts)} Aktivitäten seit {start}")
    new = skipped = 0
    errors = []
    for a in acts:
        aid = str(a["activityId"])
        try:
            raw = g.download_activity(aid, dl_fmt=Garmin.ActivityDownloadFormat.ORIGINAL)  # ZIP mit .fit
            for act in parse_file(Path(f"{aid}.zip"), raw):
                act["name"] = a.get("activityName") or act["name"]
                if ingest.add_activity(act, "garmin"): new += 1
                else: skipped += 1
        except Exception as e:
            errors.append(f"{aid} ({a.get('activityName')}): {e}")
    return new, skipped, errors
