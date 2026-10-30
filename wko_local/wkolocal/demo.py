"""Synthetische Trainingsdaten (Zufallsdaten – nur zum Ausprobieren der Software)."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import numpy as np
import pandas as pd

from . import db, ingest


def _ride(rng, ftp, kind, secs):
    t = np.arange(secs)
    p = rng.normal(0.62 * ftp, 15, secs)
    if kind == "intervals":
        for s in range(900, secs - 600, 900):
            p[s:s + 480] = rng.normal(1.0 * ftp, 8, 480)
    elif kind == "vo2":
        for s in range(900, secs - 400, 600):
            p[s:s + 180] = rng.normal(1.15 * ftp, 10, 180)
    elif kind == "race":
        p = rng.normal(0.75 * ftp, 60, secs)
        for s in range(600, secs - 300, 700):
            p[s:s + 20] = rng.normal(2.2 * ftp, 60, 20)
        p[-1500:-300] = rng.normal(1.0 * ftp, 15, 1200)
        p[-60:-50] = rng.normal(3.2 * ftp, 80, 10)
    p = np.clip(p, 0, None)
    p = pd.Series(p).rolling(3, min_periods=1).mean().to_numpy()
    hr = 60 + 105 * np.clip(pd.Series(p).rolling(60, min_periods=1).mean() / ftp, 0, 1.3) + rng.normal(0, 2, secs) + t / secs * 6
    cad = np.clip(rng.normal(88, 8, secs) - (p > 1.2 * ftp) * 8, 0, 130)
    return pd.DataFrame(dict(power=p, hr=hr, cadence=cad, speed=p / 25, altitude=100 + 20 * np.sin(t / 600),
                             distance=np.cumsum(p / 25))).astype("float32")


def _run(rng, kind, secs):
    t = np.arange(secs)
    v = rng.normal(3.1, 0.12, secs)
    if kind == "tempo":
        v[600:secs - 600] = rng.normal(3.75, 0.1, secs - 1200)
    elif kind == "intervals":
        for s in range(600, secs - 400, 420):
            v[s:s + 180] = rng.normal(4.3, 0.12, 180)
    v = pd.Series(v).rolling(5, min_periods=1).mean().to_numpy()
    alt = 100 + 15 * np.sin(t / 400)
    hr = 95 + 22 * np.clip(pd.Series(v).rolling(45, min_periods=1).mean(), 0, 5) + rng.normal(0, 1.5, secs) + t / secs * 5
    return pd.DataFrame(dict(power=np.zeros(secs), hr=hr, cadence=rng.normal(168, 4, secs), speed=v, altitude=alt,
                             distance=np.cumsum(v))).astype("float32")


def generate(days=240, seed=1) -> int:
    rng = np.random.default_rng(seed)
    today = datetime.now(timezone.utc).replace(hour=7, minute=0, second=0, microsecond=0)
    db.add_threshold((today - timedelta(days=days)).strftime("%Y-%m-%d"), ftp=235, lthr=165, weight=72)
    db.add_threshold((today - timedelta(days=days // 2)).strftime("%Y-%m-%d"), ftp=255)
    db.add_threshold((today - timedelta(days=days)).strftime("%Y-%m-%d"), run_pace=285, lthr_run=170)
    n = 0
    for i in range(days, 0, -1):
        day = today - timedelta(days=i)
        dow = day.weekday()
        ftp = 235 + 30 * (days - i) / days
        if dow in (0, 4) and rng.random() < 0.8:
            rk = "tempo" if dow == 4 else ("intervals" if i % 14 < 7 else "easy")
            secs = {"easy": 2700, "tempo": 3300, "intervals": 3300}[rk] + int(rng.integers(-300, 300))
            n += bool(ingest.add_activity(dict(df=_run(rng, rk, secs), start=day, sport="Running", name=f"Demo Lauf {rk}"), "demo"))
        kind = {0: None, 1: "intervals", 2: "easy", 3: "vo2", 4: None, 5: "race" if i % 21 < 7 else "easy", 6: "easy"}[dow]
        if not kind or rng.random() < 0.08:
            continue
        secs = {"easy": 5400, "intervals": 4500, "vo2": 4200, "race": 7200}[kind] + int(rng.integers(-600, 900))
        act = dict(df=_ride(rng, ftp, kind, secs), start=day, sport="Cycling", name=f"Demo {kind}")
        n += bool(ingest.add_activity(act, "demo"))
    # Schlaf/HRV (letzte 5 Tage bewusst schlechter, damit die Auswertung etwas zeigt)
    for i in range(days, -1, -1):
        day = (today - timedelta(days=i)).strftime("%Y-%m-%d")
        bad = i <= 2
        sleep_h = float(np.clip(rng.normal(5.6 if bad else 7.4, 0.5), 4, 9.5))
        hrv = float(rng.normal(52 if bad else 68, 5))
        db.upsert_wellness(dict(date=day, sleep_s=int(sleep_h * 3600), deep_s=int(sleep_h * 3600 * .18), light_s=int(sleep_h * 3600 * .55),
                                rem_s=int(sleep_h * 3600 * .22), awake_s=int(sleep_h * 3600 * .05), sleep_score=float(np.clip(rng.normal(55 if bad else 78, 6), 30, 98)),
                                hrv_night=hrv, hrv_week=hrv, hrv_status="UNBALANCED" if bad else "BALANCED", hrv_low=58.0, hrv_high=78.0,
                                resting_hr=float(rng.normal(58 if bad else 51, 1.5)), source="demo"))
    return n
