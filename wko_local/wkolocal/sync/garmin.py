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
