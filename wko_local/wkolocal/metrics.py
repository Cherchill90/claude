"""Kennzahlen pro Workout: NP/IF/TSS, MMP, Zonen, Quadranten, Intervalle, Entkopplung, W'bal."""
from __future__ import annotations

import math

import numpy as np
import pandas as pd
from scipy.signal import lfilter

# Standard-Dauern für die Mean-Max-Kurve (Sekunden)
DURATIONS = np.unique(np.round(np.concatenate([
    np.arange(1, 121), np.arange(125, 601, 5), np.arange(620, 3601, 20),
    np.arange(3700, 18001, 100)])).astype(int))
FATIGUE_KJ = (0, 1000, 2000, 3000)          # Arbeit vor dem Test
FATIGUE_DUR = (5, 60, 300, 1200)             # getestete Dauern

POWER_ZONES = [("Z1 Active Recovery", 0, .55), ("Z2 Endurance", .55, .75), ("Z3 Tempo", .75, .90),
               ("Z4 Threshold", .90, 1.05), ("Z5 VO2max", 1.05, 1.20),
               ("Z6 Anaerobic", 1.20, 1.50), ("Z7 Neuromuscular", 1.50, 99)]
# Pace-Zonen in % der Schwellengeschwindigkeit (Näherung nach gängigen Laufzonen-Modellen)
PACE_ZONES = [("Z1 Locker", 0, .78), ("Z2 Grundlage", .78, .88), ("Z3 Tempo", .88, .95),
              ("Z4 Schwelle", .95, 1.02), ("Z5 VO2max", 1.02, 1.10), ("Z6 Anaerob", 1.10, 99)]
HR_ZONES = [("Z1", 0, .68), ("Z2", .68, .83), ("Z3", .83, .94), ("Z4", .94, 1.05), ("Z5", 1.05, 99)]


def clean_power(p: np.ndarray) -> np.ndarray:
    p = np.nan_to_num(np.asarray(p, dtype=float), nan=0.0)
    return np.clip(p, 0, 3000)


def normalized_power(p: np.ndarray) -> float:
    p = clean_power(p)
    if len(p) < 30:
        return float(p.mean()) if len(p) else 0.0
    c = np.cumsum(np.insert(p, 0, 0.0))
    roll = (c[30:] - c[:-30]) / 30
    return float(np.mean(roll ** 4) ** 0.25)


def mean_max(p: np.ndarray, durations=DURATIONS) -> dict[int, float]:
    """Beste Durchschnittsleistung für jede Dauer (O(n) je Dauer via Cumsum)."""
    p = clean_power(p)
    c = np.cumsum(np.insert(p, 0, 0.0))
    out = {}
    for d in durations:
        d = int(d)
        if d > len(p):
            break
        out[d] = float(((c[d:] - c[:-d]) / d).max())
    return out


def fatigue_mmp(p: np.ndarray) -> dict[str, dict[int, float]]:
    """MMP nach vorangegangener Arbeit (kJ) – Basis der Fatigue-Resistance-Analyse."""
    p = clean_power(p)
    work = np.cumsum(p) / 1000
    out = {}
    for kj in FATIGUE_KJ:
        idx = 0 if kj == 0 else int(np.searchsorted(work, kj))
        out[str(kj)] = mean_max(p[idx:], FATIGUE_DUR) if idx < len(p) else {}
    return out


def tss_power(np_w: float, dur_s: float, ftp: float) -> tuple[float, float]:
    if not ftp or not np_w:
        return 0.0, 0.0
    if_ = np_w / ftp
    return if_, dur_s * np_w * if_ / (ftp * 3600) * 100


def tss_hr(avg_hr: float, dur_s: float, lthr: float, rest_hr: float) -> tuple[float, float]:
    """Näherung (hrTSS): IF über Herzfrequenzreserve, TSS = h * IF² * 100."""
    if not avg_hr or not lthr or lthr <= rest_hr:
        return 0.0, 0.0
    if_ = max(0.0, (avg_hr - rest_hr) / (lthr - rest_hr))
    return if_, dur_s / 3600 * if_ ** 2 * 100


def decoupling(p: np.ndarray, hr: np.ndarray) -> float | None:
    """Pw:HR-Entkopplung (%) zwischen 1. und 2. Hälfte (nach 10 min Warm-up)."""
    p, hr = clean_power(p), np.nan_to_num(np.asarray(hr, float))
    if len(p) < 40 * 60 or (hr > 0).mean() < .9:
        return None
    p, hr = p[600:], hr[600:]
    h = len(p) // 2
    ef = [normalized_power(p[a:b]) / max(hr[a:b].mean(), 1) for a, b in ((0, h), (h, len(p)))]
    return (ef[0] - ef[1]) / ef[0] * 100 if ef[0] else None


def time_in_zones(x: np.ndarray, ref: float, zones=POWER_ZONES) -> pd.DataFrame:
    x = np.nan_to_num(np.asarray(x, float))
    rows = []
    for name, lo, hi in zones:
        m = (x >= lo * ref) & (x < hi * ref) if lo else (x < hi * ref)
        rows.append((name, round(lo * ref), None if hi > 50 else round(hi * ref), int(m.sum())))
    df = pd.DataFrame(rows, columns=["Zone", "von", "bis", "Sekunden"])
    df["Anteil %"] = (df["Sekunden"] / max(df["Sekunden"].sum(), 1) * 100).round(1)
    return df


def quadrant_analysis(p, cad, ftp: float, crank_mm=172.5, ref_cad=90.0) -> dict:
    """AEPF/CPV-Quadranten (Coggan). Referenz: FTP bei ref_cad."""
    p, cad = clean_power(p), np.nan_to_num(np.asarray(cad, float))
    m = (cad > 20) & (p > 0)
    r = crank_mm / 1000
    cpv = cad[m] * 2 * math.pi / 60 * r                         # m/s
    aepf = p[m] / (cad[m] * 2 * math.pi / 60 * r)               # N
    cpv_ref = ref_cad * 2 * math.pi / 60 * r
    aepf_ref = ftp / cpv_ref
    q = np.select([(aepf >= aepf_ref) & (cpv >= cpv_ref), (aepf >= aepf_ref) & (cpv < cpv_ref),
                   (aepf < aepf_ref) & (cpv < cpv_ref)], [1, 2, 3], 4)
    names = {1: "QI", 2: "QII", 3: "QIII", 4: "QIV"}
    share = {names[i]: float((q == i).mean() * 100) if len(q) else 0.0 for i in names}
    return dict(aepf=aepf, cpv=cpv, quadrant=q, aepf_ref=aepf_ref, cpv_ref=cpv_ref, share=share)


def detect_intervals(p, threshold_w: float, min_s=60, max_gap_s=15, smooth_s=10) -> pd.DataFrame:
    """Auto-Intervalle: zusammenhängende Abschnitte mit geglätteter Leistung >= Schwelle."""
    p = clean_power(p)
    sm = pd.Series(p).rolling(smooth_s, min_periods=1, center=True).mean().to_numpy()
    above = sm >= threshold_w
    runs, start = [], None
    for i, a in enumerate(above):
        if a and start is None: start = i
        if not a and start is not None: runs.append([start, i]); start = None
    if start is not None: runs.append([start, len(p)])
    merged = []
    for r in runs:
        if merged and r[0] - merged[-1][1] <= max_gap_s: merged[-1][1] = r[1]
        else: merged.append(r)
    rows = []
    for a, b in merged:
        if b - a < min_s: continue
        seg = p[a:b]
        rows.append(dict(Start=a, Dauer_s=b - a, Ø_W=seg.mean(), NP=normalized_power(seg), Max_W=seg.max()))
    return pd.DataFrame(rows, columns=["Start", "Dauer_s", "Ø_W", "NP", "Max_W"])


def wbal(p, cp: float, w_prime: float) -> np.ndarray:
    """W'-Bilanz nach Skiba (2015, integral, rekursiv gelöst). Rückgabe: verbleibende J."""
    p = clean_power(p)
    below = p[p < cp]
    dcp = cp - (below.mean() if len(below) else 0)
    tau = 546 * math.exp(-0.01 * dcp) + 316
    exp_in = np.where(p > cp, p - cp, 0.0)
    a = math.exp(-1 / tau)
    used = lfilter([1.0], [1.0, -a], exp_in)   # E[t] = a*E[t-1] + exp_in[t]
    return w_prime - used


def get_speed(df: pd.DataFrame) -> np.ndarray:
    """Geschwindigkeit in m/s; fehlt sie, wird sie aus der Distanz abgeleitet."""
    sp = df["speed"].to_numpy(float) if "speed" in df else np.full(len(df), np.nan)
    if np.isnan(sp).mean() > .5 and "distance" in df and df["distance"].notna().mean() > .5:
        d = pd.Series(df["distance"].to_numpy(float)).interpolate(limit_direction="both")
        sp = d.diff().rolling(5, min_periods=1, center=True).mean().to_numpy()
    return np.clip(np.nan_to_num(sp, nan=0.0), 0, 12)


def _minetti(i: np.ndarray) -> np.ndarray:
    """Energiekosten des Laufens (J/kg/m) bei Steigung i (Minetti 2002)."""
    return 155.4 * i**5 - 30.4 * i**4 - 43.3 * i**3 + 46.3 * i**2 + 19.5 * i + 3.6


def grade_adjusted_speed(speed: np.ndarray, altitude: np.ndarray | None) -> np.ndarray:
    """Steigungskorrigierte Geschwindigkeit (GAP) per Minetti-Faktor; ohne Höhe = unverändert."""
    if altitude is None or np.isnan(altitude).mean() > .5:
        return speed
    alt = pd.Series(altitude).interpolate(limit_direction="both").rolling(15, min_periods=1, center=True).mean().to_numpy()
    dist_step = np.maximum(speed, 0.5)                         # m pro Sekunde
    grade = pd.Series(np.gradient(alt) / dist_step).rolling(10, min_periods=1, center=True).mean().to_numpy()
    grade = np.clip(grade, -0.30, 0.30)
    return speed * _minetti(grade) / 3.6


def normalized_graded_pace(speed: np.ndarray, altitude=None) -> float:
    """NGP als Geschwindigkeit (m/s): 4.-Potenz-Mittel der 30-s-gleitenden GAP."""
    return normalized_power(grade_adjusted_speed(speed, altitude))   # gleiche Mathematik wie NP


def tss_pace(ngp: float, dur_s: float, thr_speed: float) -> tuple[float, float]:
    """rTSS: IF = NGP / Schwellengeschwindigkeit, TSS = h * IF² * 100."""
    if not ngp or not thr_speed:
        return 0.0, 0.0
    if_ = ngp / thr_speed
    return if_, dur_s / 3600 * if_ ** 2 * 100


def km_splits(speed: np.ndarray, hr=None, altitude=None) -> pd.DataFrame:
    """Kilometer-Splits aus der Geschwindigkeitsreihe."""
    dist = np.cumsum(speed)
    rows = []
    for k in range(1, int(dist[-1] // 1000) + 1):
        a = 0 if k == 1 else int(np.searchsorted(dist, (k - 1) * 1000))
        b = int(np.searchsorted(dist, k * 1000))
        sec = b - a
        row = {"km": k, "Zeit_s": sec, "Pace_s_km": float(sec)}
        if hr is not None and np.nan_to_num(hr[a:b]).any():
            row["HR"] = float(np.nanmean(hr[a:b]))
        if altitude is not None and not np.isnan(altitude[a:b]).all():
            row["Hm_auf"] = float(np.clip(np.diff(altitude[a:b + 1][~np.isnan(altitude[a:b + 1])]), 0, None).sum()) if b > a else 0.0
        rows.append(row)
    return pd.DataFrame(rows)


def summarize(df: pd.DataFrame, ftp: float, lthr: float | None, rest_hr: float,
              sport: str = "Cycling", run_pace: float | None = None) -> dict:
    """Alle Workout-Kennzahlen aus einem 1-Hz-Stream.
    Rad: Leistung (NP/TSS). Lauf: Pace (NGP/rTSS, braucht run_pace in s/km), sonst hrTSS."""
    n = len(df)
    is_run = sport == "Running"
    p = clean_power(df["power"]) if ("power" in df and sport == "Cycling") else np.zeros(n)
    hr = np.nan_to_num(df["hr"].to_numpy(float)) if "hr" in df else np.zeros(n)
    cad = np.nan_to_num(df["cadence"].to_numpy(float)) if "cadence" in df else np.zeros(n)
    sp = get_speed(df)
    has_p = (p > 0).mean() > .2
    has_hr = (hr > 0).mean() > .5
    out = dict(duration_s=n, avg_hr=float(hr[hr > 0].mean()) if has_hr else None,
               max_hr=float(hr.max()) if has_hr else None,
               avg_cad=float(cad[cad > 0].mean()) if (cad > 0).any() else None,
               avg_power=None, np=None, if_=None, vi=None, work_kj=None, ef=None,
               decoupling=None, mmp={}, fatigue={}, smm={}, ngp=None, avg_speed=None,
               tss=0.0, tss_method="none", ftp_used=ftp)
    if (sp > 0).mean() > .3 and not (sport == "Cycling" and has_p):
        out["avg_speed"] = float(sp.mean())
    if is_run and (sp > 0).mean() > .3:
        alt = df["altitude"].to_numpy(float) if "altitude" in df else None
        ngp = normalized_graded_pace(sp, alt)
        out.update(ngp=ngp, smm=mean_max(sp))
        if has_hr:
            out["ef"] = ngp * 60 / out["avg_hr"]              # (m/min)/bpm
            out["decoupling"] = decoupling(sp * 100, hr)       # Pace:HR-Entkopplung (Skalierung irrelevant)
        if run_pace:
            if_, tss = tss_pace(ngp, n, 1000 / run_pace)
            out.update(if_=if_, tss=tss, tss_method="pace")
            return out
    if has_p:
        npw = normalized_power(p)
        if_, tss = tss_power(npw, n, ftp)
        out.update(avg_power=float(p.mean()), np=npw, if_=if_, tss=tss, tss_method="power",
                   vi=npw / p.mean() if p.mean() else None, work_kj=float(p.sum() / 1000),
                   mmp=mean_max(p), fatigue=fatigue_mmp(p))
        if has_hr:
            out["ef"] = npw / out["avg_hr"]
            out["decoupling"] = decoupling(p, hr)
    elif has_hr and lthr:
        if_, tss = tss_hr(out["avg_hr"], n, lthr, rest_hr)
        out.update(if_=if_, tss=tss, tss_method="hr")
    return out
