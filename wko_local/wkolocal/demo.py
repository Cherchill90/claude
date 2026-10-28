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


def generate(days=240, seed=1) -> int:
    rng = np.random.default_rng(seed)
    today = datetime.now(timezone.utc).replace(hour=7, minute=0, second=0, microsecond=0)
    db.add_threshold((today - timedelta(days=days)).strftime("%Y-%m-%d"), ftp=235, lthr=165, weight=72)
    db.add_threshold((today - timedelta(days=days // 2)).strftime("%Y-%m-%d"), ftp=255)
    n = 0
    for i in range(days, 0, -1):
        day = today - timedelta(days=i)
        dow = day.weekday()
        ftp = 235 + 30 * (days - i) / days
        kind = {0: None, 1: "intervals", 2: "easy", 3: "vo2", 4: None, 5: "race" if i % 21 < 7 else "easy", 6: "easy"}[dow]
        if not kind or rng.random() < 0.08:
            continue
        secs = {"easy": 5400, "intervals": 4500, "vo2": 4200, "race": 7200}[kind] + int(rng.integers(-600, 900))
        act = dict(df=_ride(rng, ftp, kind, secs), start=day, sport="Cycling", name=f"Demo {kind}")
        n += bool(ingest.add_activity(act, "demo"))
    return n
