"""SQLite-Persistenz: Workouts, Schwellenwerte, Planung."""
from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from datetime import date

import numpy as np
import pandas as pd

from . import config

SCHEMA = """
CREATE TABLE IF NOT EXISTS workouts(
  uid TEXT PRIMARY KEY, start_time TEXT, date TEXT, sport TEXT, name TEXT, source TEXT,
  duration_s INTEGER, distance_m REAL, ascent_m REAL,
  avg_power REAL, np REAL, if_ REAL, tss REAL, tss_method TEXT, vi REAL, work_kj REAL,
  avg_hr REAL, max_hr REAL, avg_cad REAL, ef REAL, decoupling REAL, ftp_used REAL,
  mmp TEXT, fatigue TEXT, tags TEXT DEFAULT '', notes TEXT DEFAULT '');
CREATE INDEX IF NOT EXISTS ix_w_date ON workouts(date);
CREATE TABLE IF NOT EXISTS thresholds(date TEXT PRIMARY KEY, ftp REAL, lthr REAL, weight REAL);
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS races(
  id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT, name TEXT, sport TEXT, priority TEXT,
  duration_h REAL, tss REAL, notes TEXT DEFAULT '');
CREATE TABLE IF NOT EXISTS wellness(
  date TEXT PRIMARY KEY, sleep_s INTEGER, deep_s INTEGER, light_s INTEGER, rem_s INTEGER, awake_s INTEGER,
  sleep_score REAL, hrv_night REAL, hrv_week REAL, hrv_status TEXT, hrv_low REAL, hrv_high REAL,
  resting_hr REAL, source TEXT);
CREATE TABLE IF NOT EXISTS planned(
  id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT, name TEXT, sport TEXT,
  tss REAL, duration_min REAL, notes TEXT DEFAULT '');
"""

DEFAULT_SETTINGS = {"sex": "m", "max_hr": "190", "rest_hr": "50", "crank_mm": "172.5",
                    "ctl_tau": "42", "atl_tau": "7"}


MIGRATIONS = {"workouts": [("ngp", "REAL"), ("avg_speed", "REAL"), ("smm", "TEXT")],
              "thresholds": [("run_pace", "REAL"), ("lthr_run", "REAL")]}


def _migrate(con) -> None:
    for table, cols in MIGRATIONS.items():
        have = {r[1] for r in con.execute(f"PRAGMA table_info({table})")}
        for name, typ in cols:
            if name not in have:
                con.execute(f"ALTER TABLE {table} ADD COLUMN {name} {typ}")


@contextmanager
def connect():
    config.ensure_dirs()
    con = sqlite3.connect(config.DB_PATH)
    con.row_factory = sqlite3.Row
    con.executescript(SCHEMA)
    _migrate(con)
    try:
        yield con
        con.commit()
    finally:
        con.close()


# ---- Einstellungen -------------------------------------------------------
def get_settings() -> dict:
    with connect() as c:
        s = dict(DEFAULT_SETTINGS)
        s.update({r["key"]: r["value"] for r in c.execute("SELECT * FROM settings")})
    return s


def set_setting(key: str, value) -> None:
    with connect() as c:
        c.execute("INSERT OR REPLACE INTO settings VALUES(?,?)", (key, str(value)))


def add_threshold(day: str, ftp=None, lthr=None, weight=None, run_pace=None, lthr_run=None) -> None:
    """Schwellenwerte ab Datum. run_pace in s/km. None = bestehenden Wert des Tages behalten."""
    new = dict(ftp=ftp, lthr=lthr, weight=weight, run_pace=run_pace, lthr_run=lthr_run)
    with connect() as c:
        old = c.execute("SELECT * FROM thresholds WHERE date=?", (day,)).fetchone()
        o = dict(old) if old else {}
        vals = {k: (v if v is not None else o.get(k)) for k, v in new.items()}
        c.execute("INSERT OR REPLACE INTO thresholds(date,ftp,lthr,weight,run_pace,lthr_run) VALUES(?,?,?,?,?,?)",
                  (day, *vals.values()))


def thresholds_df() -> pd.DataFrame:
    with connect() as c:
        return pd.read_sql("SELECT * FROM thresholds ORDER BY date", c)


def threshold_on(day: str, field: str, default=None):
    """Letzter eingetragener Wert <= day (sonst frühester Eintrag, sonst default)."""
    df = thresholds_df()
    df = df.dropna(subset=[field])
    if df.empty:
        return default
    past = df[df["date"] <= day]
    row = past.iloc[-1] if len(past) else df.iloc[0]
    return float(row[field])


# ---- Workouts --------------------------------------------------------------
def upsert_workout(w: dict) -> None:
    w = dict(w)
    for k in ("mmp", "fatigue", "smm"):
        w[k] = json.dumps(w.get(k) or {})
    cols = ",".join(w)
    with connect() as c:
        c.execute(f"INSERT OR REPLACE INTO workouts({cols}) VALUES({','.join('?' * len(w))})",
                  list(w.values()))


def workouts_df(start: str | None = None, end: str | None = None, sport: str | None = None) -> pd.DataFrame:
    q, p = "SELECT * FROM workouts WHERE 1=1", []
    if start: q += " AND date>=?"; p.append(start)
    if end: q += " AND date<=?"; p.append(end)
    if sport and sport != "Alle": q += " AND sport=?"; p.append(sport)
    with connect() as c:
        df = pd.read_sql(q + " ORDER BY start_time", c, params=p)
    for k in ("mmp", "fatigue", "smm"):
        df[k] = df[k].map(lambda s: json.loads(s) if s else {})
    return df


def has_workout(uid: str) -> bool:
    with connect() as c:
        return c.execute("SELECT 1 FROM workouts WHERE uid=?", (uid,)).fetchone() is not None


def delete_workout(uid: str) -> None:
    with connect() as c:
        c.execute("DELETE FROM workouts WHERE uid=?", (uid,))
    (config.STREAM_DIR / f"{uid}.npz").unlink(missing_ok=True)


def update_workout(uid: str, **fields) -> None:
    with connect() as c:
        c.execute(f"UPDATE workouts SET {','.join(f'{k}=?' for k in fields)} WHERE uid=?",
                  [*fields.values(), uid])


# ---- Streams ---------------------------------------------------------------
def save_stream(uid: str, df: pd.DataFrame) -> None:
    config.ensure_dirs()
    np.savez_compressed(config.STREAM_DIR / f"{uid}.npz",
                        **{c: df[c].to_numpy(dtype="float32") for c in df.columns})


def load_stream(uid: str) -> pd.DataFrame:
    with np.load(config.STREAM_DIR / f"{uid}.npz") as z:
        return pd.DataFrame({k: z[k] for k in z.files})


# ---- Planung ---------------------------------------------------------------
def planned_df() -> pd.DataFrame:
    with connect() as c:
        return pd.read_sql("SELECT * FROM planned ORDER BY date", c)


def add_planned(day: str, name: str, tss: float, sport="Cycling", duration_min=None, notes="") -> None:
    with connect() as c:
        c.execute("INSERT INTO planned(date,name,sport,tss,duration_min,notes) VALUES(?,?,?,?,?,?)",
                  (day, name, sport, tss, duration_min, notes))


def delete_planned(pid: int) -> None:
    with connect() as c:
        c.execute("DELETE FROM planned WHERE id=?", (pid,))


def clear_planned_from(day: str) -> None:
    with connect() as c:
        c.execute("DELETE FROM planned WHERE date>=?", (day,))


# ---- Wettkämpfe ------------------------------------------------------------
def races_df() -> pd.DataFrame:
    with connect() as c:
        return pd.read_sql("SELECT * FROM races ORDER BY date", c)


def add_race(day: str, name: str, sport="Cycling", priority="B", duration_h=None, tss=None, notes="") -> None:
    with connect() as c:
        c.execute("INSERT INTO races(date,name,sport,priority,duration_h,tss,notes) VALUES(?,?,?,?,?,?,?)",
                  (day, name, sport, priority, duration_h, tss, notes))


def delete_race(rid: int) -> None:
    with connect() as c:
        c.execute("DELETE FROM races WHERE id=?", (rid,))


# ---- Erholung (Schlaf/HRV) --------------------------------------------------
WELLNESS_COLS = ["date", "sleep_s", "deep_s", "light_s", "rem_s", "awake_s", "sleep_score", "hrv_night", "hrv_week",
                 "hrv_status", "hrv_low", "hrv_high", "resting_hr", "source"]


def upsert_wellness(row: dict) -> None:
    vals = [row.get(c) for c in WELLNESS_COLS]
    with connect() as c:
        c.execute(f"INSERT OR REPLACE INTO wellness({','.join(WELLNESS_COLS)}) VALUES({','.join('?' * len(WELLNESS_COLS))})", vals)


def wellness_df(start: str | None = None, end: str | None = None) -> pd.DataFrame:
    q, p = "SELECT * FROM wellness WHERE 1=1", []
    if start: q += " AND date>=?"; p.append(start)
    if end: q += " AND date<=?"; p.append(end)
    with connect() as c:
        return pd.read_sql(q + " ORDER BY date", c, params=p)


def has_wellness(day: str) -> bool:
    with connect() as c:
        return c.execute("SELECT 1 FROM wellness WHERE date=?", (day,)).fetchone() is not None
