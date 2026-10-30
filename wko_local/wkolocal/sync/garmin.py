"""Garmin-Connect-Sync über die inoffizielle Bibliothek `garminconnect` (kein offizielles API).

Zugangsdaten: Umgebungsvariablen GARMIN_EMAIL / GARMIN_PASSWORD (nur beim ersten Login nötig;
danach werden Tokens in data/garmin_tokens wiederverwendet). Bei aktiver 2FA wird der Code
interaktiv abgefragt.
"""
from __future__ import annotations

import getpass
import os
import sys
import time
from datetime import date, timedelta

from .. import config, ingest
from ..parsers import parse_file
from pathlib import Path


def _prompt_mfa() -> str:
    """2FA-Code: im Terminal per Eingabe, in der App per Datei (GARMIN_MFA_FILE), sonst klarer Fehler."""
    f = os.environ.get("GARMIN_MFA_FILE")
    if f:
        p = Path(f)
        p.unlink(missing_ok=True)
        print("MFA_REQUIRED", flush=True)          # Signal an die Oberfläche
        for _ in range(300):                        # bis zu 5 min warten
            if p.exists() and p.read_text().strip():
                code = p.read_text().strip()
                p.unlink(missing_ok=True)
                return code
            time.sleep(1)
        raise RuntimeError("2FA-Code wurde nicht rechtzeitig eingegeben.")
    if sys.stdin and sys.stdin.isatty():
        return input("2FA-Code: ")
    raise RuntimeError("Garmin verlangt einen 2FA-Code, aber es ist keine Eingabe möglich. "
                       "In der App: Sync-Button nutzen (dort gibt es ein Eingabefeld) oder im Terminal ./sync.command garmin.")


def _login():
    from garminconnect import Garmin
    config.ensure_dirs()
    tok = str(config.TOKEN_DIR)
    try:
        g = Garmin(prompt_mfa=_prompt_mfa)
        g.login(tok)                                # gespeichertes Token
        return g
    except Exception:
        pass
    interactive = bool(sys.stdin and sys.stdin.isatty())
    email = os.environ.get("GARMIN_EMAIL") or (input("Garmin E-Mail: ") if interactive else "")
    pw = os.environ.get("GARMIN_PASSWORD") or (getpass.getpass("Garmin Passwort: ") if interactive else "")
    if not email or not pw:
        raise SystemExit("Keine Garmin-Zugangsdaten: in der App E-Mail/Passwort eingeben oder im Terminal ./sync.command garmin ausführen.")
    g = Garmin(email, pw, prompt_mfa=_prompt_mfa)
    g.login(tok)
    return g


def sync_wellness(g, days: int, log=print) -> tuple[int, list[str]]:
    """Schlaf + HRV je Tag. Letzte 3 Tage werden immer neu geladen (Daten werden nachträglich ergänzt)."""
    from .. import db
    from ..wellness import parse_day
    new, errors, consecutive = 0, [], 0
    today = date.today()
    for i in range(days, -1, -1):
        day = (today - timedelta(days=i)).isoformat()
        if i > 3 and db.has_wellness(day):
            continue
        try:
            sleep = g.get_sleep_data(day)
            hrv = g.get_hrv_data(day)
            row = parse_day(day, sleep, hrv)
            if row:
                db.upsert_wellness(row); new += 1
            consecutive = 0
        except Exception as e:
            consecutive += 1
            errors.append(f"Schlaf/HRV {day}: {e}")
            if consecutive >= 3:       # vermutlich Rate-Limit/Sperre: abbrechen statt weiter zu hämmern
                errors.append("Abbruch nach 3 Fehlern in Folge – später erneut versuchen.")
                break
        time.sleep(0.4)
    log(f"Garmin Schlaf/HRV: {new} Tage gespeichert")
    return new, errors


def sync(days: int = 30, since: date | None = None, log=print, wellness: bool = True, only_wellness: bool = False) -> tuple[int, int, list[str]]:
    from garminconnect import Garmin
    g = _login()
    if only_wellness:
        n, errs = sync_wellness(g, days, log)
        return n, 0, errs
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
    if wellness:
        try:
            _, werrs = sync_wellness(g, (date.today() - start).days if since else days, log)
            errors += werrs
        except Exception as e:
            errors.append(f"Schlaf/HRV: {e}")
    return new, skipped, errors
