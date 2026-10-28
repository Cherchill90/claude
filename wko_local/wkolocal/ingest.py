"""Import: Parser -> Kennzahlen -> DB + Stream-Datei. Plus Neuberechnung bei FTP-Änderung."""
from __future__ import annotations

from pathlib import Path

import pandas as pd

from . import db, metrics
from .parsers import parse_file


def _thr(day: str):
    s = db.get_settings()
    ftp = db.threshold_on(day, "ftp", 200.0)
    lthr = db.threshold_on(day, "lthr", None)
    return ftp, lthr, float(s["rest_hr"])


def add_activity(act: dict, source: str, overwrite=False) -> str | None:
    """Speichert eine geparste Aktivität. Rückgabe: uid, oder None wenn Duplikat."""
    start = pd.Timestamp(act["start"]).tz_convert("UTC") if pd.Timestamp(act["start"]).tzinfo else pd.Timestamp(act["start"]).tz_localize("UTC")
    df = act["df"]
    if len(df) < 30:
        return None
    uid = f"{start:%Y%m%dT%H%M%S}_{act['sport']}"
    if db.has_workout(uid) and not overwrite:
        return None
    day = f"{start:%Y-%m-%d}"
    ftp, lthr, rest = _thr(day)
    m = metrics.summarize(df, ftp, lthr, rest)
    dist = float(df["distance"].dropna().iloc[-1]) if df["distance"].notna().any() else None
    alt = df["altitude"].dropna()
    ascent = float(alt.rolling(5, min_periods=1).mean().diff().clip(lower=0).sum()) if len(alt) > 5 else None
    db.upsert_workout(dict(uid=uid, start_time=f"{start:%Y-%m-%d %H:%M:%S}", date=day, sport=act["sport"],
                           name=act.get("name") or uid, source=source, distance_m=dist, ascent_m=ascent, **m))
    db.save_stream(uid, df)
    return uid


def import_path(path: Path, source="file") -> tuple[int, int, list[str]]:
    """Importiert Datei oder Ordner. Rückgabe: (neu, übersprungen, Fehler)."""
    files = [path] if path.is_file() else sorted(p for p in path.rglob("*") if p.is_file())
    new = skipped = 0
    errors = []
    for f in files:
        if f.suffix.lower() not in {".fit", ".tcx", ".gpx", ".csv", ".gz", ".zip"}:
            continue
        try:
            for act in parse_file(f):
                if add_activity(act, source): new += 1
                else: skipped += 1
        except Exception as e:  # defekte Datei darf den Rest nicht stoppen
            errors.append(f"{f.name}: {e}")
    return new, skipped, errors


def recompute_all() -> int:
    """Alle Workouts mit aktuellen FTP/LTHR-Verläufen neu berechnen (nach Schwellenwert-Änderung)."""
    wk = db.workouts_df()
    for _, w in wk.iterrows():
        df = db.load_stream(w["uid"])
        ftp, lthr, rest = _thr(w["date"])
        m = metrics.summarize(df, ftp, lthr, rest)
        db.update_workout(w["uid"], **{k: (__import__("json").dumps(v) if k in ("mmp", "fatigue") else v)
                                       for k, v in m.items()})
    return len(wk)
