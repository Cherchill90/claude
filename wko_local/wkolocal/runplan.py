"""Laufauswertung & Wettkampf-Taper nach dem Regelwerk „Evidenzbasierte Trainingsplanung für Ausdauerlauf“ (v1.0),
eingeschränkt auf Inhalte, die durch belastbare Studien gedeckt sind (Nutzervorgabe):

Übernommen
- Zusammenhang lockerer Umfang/Gesamtumfang ↔ Leistung (Großdatensatz, Beobachtung) – als Auswertung, ohne Sollwerte [Q6, Q4].
- Einzel-Lauf-Steigerung: > 10 % über dem längsten Lauf der letzten 30 Tage ↔ höheres Verletzungsrisiko (Kohorte, 5205 Läufer) [Q37].
- Taper: 2 Wochen, Umfang um 41–60 % senken (exponentiell), Intensität und Häufigkeit halten (Meta-Analyse) [Q36].
Nicht übernommen (keine belastbare Studie): 10-%-Wochenregel (RCT ohne Schutzeffekt [Q38]), Phasenanteile, Entlastungsrhythmus,
32-km-Deckel (Plan-Konvention [Q35]), feste Soll-Anteile je Zone und feste Anzahl Qualitätseinheiten (nur kleine Elite-Stichproben [Q33, Q34]).
Zonen dienen nur der Beschreibung; HFmax-Prozente sind eine Näherung aus kleinen Elite-Studien.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, timedelta

import numpy as np
import pandas as pd

DISCIPLINES = {"halbmarathon": "Halbmarathon", "marathon": "Marathon", "ultra_trail": "Ultra/Trail"}
ROAD = ("halbmarathon", "marathon")


# =================================================================== Zonen (Abschnitt 3)
@dataclass
class Zones:
    z1_hi: float | None          # HF-Obergrenze Z1 (bpm)
    z2_hi: float | None          # HF-Obergrenze Z2 (bpm)
    method: str
    grade: str
    pace_thr: float | None = None  # Schwellenpace s/km für Tempo-Ersatz


def run_zones(s: dict, lthr_run: float | None, max_hr_obs: float | None, run_pace: float | None) -> Zones:
    """Reihenfolge: Laktat/Test (LT1/LT2) > HFmax (82/92 %) > Lauf-LTHR (LT2≈LTHR, LT1≈90 %) > höchste gemessene HF."""
    f = lambda k: float(s[k]) if str(s.get(k, "")).strip() not in ("", "None", "0") else None
    lt1, lt2, hfmax = f("lt1_hr"), f("lt2_hr"), f("hf_max")
    if lt1 and lt2:
        return Zones(lt1, lt2, "LT1/LT2 aus Laktat- oder Feldtest", "E2", run_pace)
    if hfmax:
        return Zones(.82 * hfmax, .92 * hfmax, f"% HFmax (HFmax {hfmax:.0f}; Grenzen 82/92 %)", "E2", run_pace)
    if lthr_run:
        return Zones(.90 * lthr_run, lthr_run, f"aus Lauf-LTHR {lthr_run:.0f} (LT2≈LTHR, LT1≈90 % davon – Heuristik)", "H", run_pace)
    if max_hr_obs:
        return Zones(.82 * max_hr_obs, .92 * max_hr_obs, f"% der höchsten gemessenen HF ({max_hr_obs:.0f}) – unterschätzt HFmax eher", "H", run_pace)
    return Zones(None, None, "Tempo (Schwellenpace) – keine HF-Grundlage", "H", run_pace)


def zone_seconds(df: pd.DataFrame, z: Zones) -> tuple[np.ndarray, str]:
    """Sekunden in Z1/Z2/Z3 einer Einheit: HF-Stream, sonst Tempo, sonst keine Zuordnung."""
    hr = df["hr"].to_numpy(float) if "hr" in df else np.array([])
    if z.z1_hi and len(hr) and np.isfinite(hr).mean() > .5:
        h = hr[np.isfinite(hr) & (hr > 40)]
        return np.array([(h < z.z1_hi).sum(), ((h >= z.z1_hi) & (h < z.z2_hi)).sum(), (h >= z.z2_hi).sum()], float), "HF"
    if z.pace_thr and "speed" in df:
        v = np.nan_to_num(df["speed"].to_numpy(float)); v = v[v > .5]
        thr = 1000 / z.pace_thr
        return np.array([(v < .88 * thr).sum(), ((v >= .88 * thr) & (v < thr)).sum(), (v >= thr).sum()], float), "Tempo"
    return np.zeros(3), "keine"


# =================================================================== Wochenkennzahlen (4.1–4.2)
def weekly_stats(workouts: pd.DataFrame, load_stream, z: Zones) -> pd.DataFrame:
    """Je Woche (Mo–So): Lauf-Volumen, km, Zonenanteile, Qualität, längster Lauf, Häufigkeit, Höhenmeter, Cross-Training."""
    if workouts.empty:
        return pd.DataFrame()
    w = workouts.copy()
    w["woche"] = pd.to_datetime(w.date).dt.to_period("W-SUN").dt.start_time
    runs = w[w.sport == "Running"]
    rows, methods = [], {}
    for r in runs.itertuples():
        try:
            secs, how = zone_seconds(load_stream(r.uid), z)
        except Exception:
            secs, how = np.zeros(3), "keine"
        methods[how] = methods.get(how, 0) + 1
        tot = secs.sum()
        km = (r.distance_m or 0) / 1000 if pd.notna(r.distance_m) and r.distance_m else (r.avg_speed or 0) * r.duration_s / 1000
        rows.append(dict(woche=r.woche, date=r.date, h=r.duration_s / 3600, km=km, z1=secs[0], z2=secs[1], z3=secs[2],
                         quality=bool(tot and (secs[1] + secs[2]) / tot > .20), hm=r.ascent_m or 0))
    rr = pd.DataFrame(rows)
    cross = w[w.sport == "Cycling"].groupby("woche").duration_s.sum() / 3600
    weeks = pd.date_range(w.woche.min(), pd.Timestamp(date.today()).to_period("W-SUN").start_time, freq="W-MON")
    out = []
    for wk in weeks:
        x = rr[rr.woche == wk] if len(rr) else rr
        zt = x[["z1", "z2", "z3"]].sum().to_numpy() if len(x) else np.zeros(3)
        n = zt.sum()
        qdays = sorted({date.fromisoformat(d) for d in x[x.quality].date}) if len(x) else []
        out.append(dict(woche=wk.date(), volumen_h=float(x.h.sum()) if len(x) else 0.0, volumen_km=float(x.km.sum()) if len(x) else 0.0,
                        anteil_z1=zt[0] / n if n else np.nan, anteil_z2=zt[1] / n if n else np.nan, anteil_z3=zt[2] / n if n else np.nan,
                        qualitaet=len(qdays), qualitaet_folgetage=any((b - a).days == 1 for a, b in zip(qdays, qdays[1:])),
                        laengster_h=float(x.h.max()) if len(x) else 0.0, laengster_km=float(x.km.max()) if len(x) else 0.0,
                        laeufe=len(x), hm=float(x.hm.sum()) if len(x) else 0.0, cross_h=float(cross.get(wk, 0.0))))
    df = pd.DataFrame(out)
    df["hm_pro_km"] = np.where(df.volumen_km > 0, df.hm / df.volumen_km.replace(0, np.nan), np.nan)
    df.attrs["methods"] = methods
    return df


def baseline(stats: pd.DataFrame, today: date | None = None) -> tuple[float, float, list]:
    """Mittel der letzten 4 abgeschlossenen Wochen ohne Entlastungs- und Ausfallwochen (4.1)."""
    today = today or date.today()
    cur = pd.Timestamp(today).to_period("W-SUN").start_time.date()
    done = stats[stats.woche < cur].tail(8)
    if done.empty:
        return 0.0, 0.0, []
    med = done.volumen_h.median()
    keep, prev = [], None
    for r in done.itertuples():
        sick = med > 0 and r.volumen_h < .5 * med                        # Ausfall/Krankheit (H)
        deload = prev is not None and prev > 0 and r.volumen_h < .85 * prev  # Entlastungswoche (H)
        if not sick and not deload:
            keep.append(r)
        if not sick:
            prev = r.volumen_h
    keep = keep[-4:]
    if not keep:
        return 0.0, 0.0, []
    return float(np.mean([k.volumen_h for k in keep])), float(np.mean([k.volumen_km for k in keep])), [k.woche for k in keep]


# =================================================================== Prüfungen (nur belegte Aussagen)
@dataclass
class Check:
    regel: str
    status: str            # ok | warnung | info
    wert: float | str | None
    begruendung: str
    quelle: str


def longest_30d(runs: pd.DataFrame, day: date) -> float:
    """Längster Lauf (km) in den 30 Tagen vor `day`."""
    if runs.empty:
        return 0.0
    d = pd.to_datetime(runs.date).dt.date
    m = (d < day) & (d >= day - timedelta(days=30))
    km = runs.distance_m.fillna(0) / 1000
    return float(km[m].max()) if m.any() else 0.0


def spikes(runs: pd.DataFrame, days: int = 28) -> pd.DataFrame:
    """Läufe der letzten `days` Tage mit Distanz > 110 % des längsten Laufs der 30 Tage davor [Q37]."""
    if runs.empty:
        return pd.DataFrame()
    rows = []
    for r in runs.itertuples():
        d = date.fromisoformat(r.date)
        if (date.today() - d).days > days or not r.distance_m:
            continue
        ref = longest_30d(runs, d)
        if ref > 0 and r.distance_m / 1000 > 1.10 * ref:
            pct = (r.distance_m / 1000 / ref - 1) * 100
            rows.append(dict(Datum=r.date, Einheit=r.name, km=round(r.distance_m / 1000, 1), Referenz_km=round(ref, 1),
                             Steigerung=f"+{pct:.0f} %", Klasse="klein (>10–30 %)" if pct <= 30 else "mittel (>30–100 %)" if pct <= 100 else "groß (>100 %)"))
    return pd.DataFrame(rows)


def rule_check(stats: pd.DataFrame, runs: pd.DataFrame, today: date | None = None) -> list[Check]:
    today = today or date.today()
    out: list[Check] = []
    if stats.empty or stats.volumen_h.sum() == 0:
        return [Check("–", "info", None, "Keine Läufe im Auswertungszeitraum.", "–")]
    cur = pd.Timestamp(today).to_period("W-SUN").start_time.date()
    done = stats[stats.woche < cur]
    # Volumen (Beobachtung, Großdatensatz)
    tr = done.tail(12)
    if len(tr) >= 6:
        a, b = tr.volumen_h.iloc[:4].mean(), tr.volumen_h.iloc[-4:].mean()
        ch = (b / a - 1) * 100 if a else 0
        out.append(Check("Umfang", "info", round(ch, 1),
                         f"Laufumfang: Ø {b:.1f} h/Woche in den letzten 4 Wochen ({ch:+.0f} % gegenüber 8 Wochen davor). In 151.813 Marathons trainierten die Schnellsten "
                         "rund dreimal so viel, vor allem zusätzlich locker – ein Zusammenhang, kein Beweis, dass mehr Umfang bei Dir schneller macht.", "Q6, Q4"))
    # Intensitätsverteilung (beschreibend)
    l4 = done.tail(4); w = l4.volumen_h.fillna(0)
    if w.sum() > 0 and l4.anteil_z1.notna().any():
        z1 = float(np.nansum(l4.anteil_z1 * w) / w[l4.anteil_z1.notna()].sum())
        z2 = float(np.nansum(l4.anteil_z2 * w) / w[l4.anteil_z2.notna()].sum())
        out.append(Check("Verteilung", "info", round(z1, 2),
                         f"Locker (Z1) {z1 * 100:.0f} %, Z2 {z2 * 100:.0f} %, Z3 {(1 - z1 - z2) * 100:.0f} % der Laufzeit (4 Wochen). Im Großdatensatz hing ein höherer Z1-Anteil "
                         "mit schnelleren Marathonzeiten zusammen; ein belegter Sollwert existiert nicht.", "Q6"))
    # Einzel-Lauf-Steigerung (Kohorte)
    sp = spikes(runs)
    if len(sp):
        out.append(Check("Steigerung", "warnung", len(sp),
                         f"{len(sp)} Lauf/Läufe in 4 Wochen waren > 10 % länger als der längste Lauf der 30 Tage davor (z. B. {sp.iloc[-1].Datum}: {sp.iloc[-1].km} km vs. "
                         f"{sp.iloc[-1].Referenz_km} km). In einer Kohorte mit 5205 Läufern ging das mit 1,5- bis 2,3-fach höherem Verletzungsrisiko einher (Beobachtung).", "Q37"))
    else:
        out.append(Check("Steigerung", "ok", 0, "Kein Lauf war > 10 % länger als der längste Lauf der jeweils 30 Tage davor.", "Q37"))
    out.append(Check("10-%-Regel", "info", None, "Eine wöchentliche 10-%-Steigerungsregel verhinderte in einem RCT mit 532 Einsteigern keine Verletzungen – daher hier keine Wochen-Grenze.", "Q38"))
    return out


def next_long_run_cap(runs: pd.DataFrame, day: date) -> float | None:
    """Maximal empfohlene Distanz des nächsten Laufs: 110 % des längsten Laufs der letzten 30 Tage [Q37]."""
    ref = longest_30d(runs, day)
    return round(ref * 1.10, 1) if ref > 0 else None


# =================================================================== Taper (Meta-Analyse)
def taper_plan(peak_week_h: float, race_date: date, today: date | None = None) -> list[dict]:
    """2-Wochen-Taper: Umfang exponentiell auf ca. 40–59 % reduzieren (−41–60 %), Intensität und Häufigkeit halten [Q36]."""
    today = today or date.today()
    start = race_date - timedelta(days=14)
    rows = []
    for i in range(14):
        d = start + timedelta(days=i)
        if d < today:
            continue
        frac = float(np.exp(np.log(0.5) * (i + 1) / 14))           # exponentiell auf ca. 50 % des Ausgangsumfangs
        rows.append(dict(Datum=d, Umfang_Anteil=round(frac, 2)))
    wk1 = [r for r in rows if r["Datum"] < start + timedelta(days=7)]
    wk2 = [r for r in rows if r["Datum"] >= start + timedelta(days=7)]
    out = []
    for lbl, part in (("Taper-Woche 1", wk1), ("Rennwoche", wk2)):
        if part:
            f = float(np.mean([r["Umfang_Anteil"] for r in part]))
            out.append(dict(Woche=lbl, ab=str(part[0]["Datum"]), Umfang_h=round(peak_week_h * f, 1), Anteil=f"{f * 100:.0f} % der Ausgangswoche",
                            Intensität="unverändert (gleiche Qualitätseinheiten, kürzer)", Häufigkeit="unverändert (gleiche Zahl an Lauftagen)"))
    return out


def to_json(stats: pd.DataFrame, checks: list[Check], z: Zones, taper: list[dict], notes: list[str]) -> dict:
    l4 = stats.tail(4)
    f = lambda c: round(float(np.nanmean(l4[c])), 3) if len(l4) and l4[c].notna().any() else None
    return {"auswertung": {"zeitraum": f"{stats.woche.min()} bis {stats.woche.max()}" if len(stats) else "",
                           "volumen_h_4w": round(float(l4.volumen_h.mean()), 2) if len(l4) else 0,
                           "anteil_z1": f("anteil_z1"), "anteil_z2": f("anteil_z2"), "anteil_z3": f("anteil_z3"),
                           "regelstatus": [dict(regel=c.regel, status=c.status, wert=c.wert, begruendung=c.begruendung, quelle=c.quelle) for c in checks]},
            "taper": taper, "hinweise": notes,
            "annahmen": [f"Zonen: {z.method}", "Wochen Mo–So", "Qualitätseinheit = Z2+Z3 > 20 % der Einheit (nur beschreibend)"]}


# =================================================================== Fortschritt: Pace ↔ Herzfrequenz
def hr_speed_relation(df: pd.DataFrame, ref_hr: float, skip_s: int = 600) -> dict | None:
    """Steigungskorrigierte Geschwindigkeit bei Referenz-HF für einen Lauf.

    30-s-Abschnitte nach dem Aufwärmen (HF reagiert verzögert), nur gleichmäßige Abschnitte (Tempo-Schwankung < 10 %).
    Liegt die Referenz-HF im gemessenen Bereich: lineare Regression Geschwindigkeit ~ HF (keine Extrapolation);
    sonst Median der Abschnitte mit HF ± 4 bpm. Zusätzlich Effizienz (m/min je Herzschlag) der gleichmäßigen Abschnitte.
    """
    from .metrics import get_speed, grade_adjusted_speed
    if "hr" not in df or df["hr"].notna().mean() < .5 or len(df) < skip_s + 600:
        return None
    sp = get_speed(df)
    alt = df["altitude"].to_numpy(float) if "altitude" in df else None
    gap = grade_adjusted_speed(sp, alt)
    hr = df["hr"].to_numpy(float)
    n = (len(df) - skip_s) // 30
    rows = []
    for i in range(n):
        a, b = skip_s + i * 30, skip_s + (i + 1) * 30
        v, h = gap[a:b], hr[a:b]
        if np.isnan(h).mean() > .3 or v.mean() < 1.5 or v.mean() > 7:
            continue
        if v.std() / v.mean() > .10:
            continue
        rows.append((float(np.nanmean(h)), float(v.mean())))
    if len(rows) < 10:
        return None
    H, V = np.array(rows).T
    eff = float(np.median(V * 60 / H))
    if H.max() - H.min() >= 8 and H.min() - 3 <= ref_hr <= H.max() + 3:
        k, d = np.polyfit(H, V, 1)
        if k > 0:
            return dict(speed=float(k * ref_hr + d), n=len(rows), method="Regression", eff=eff, hr_mean=float(H.mean()))
    near = V[np.abs(H - ref_hr) <= 4]
    if len(near) >= 6:
        return dict(speed=float(np.median(near)), n=int(len(near)), method="Abschnitte ± 4 bpm", eff=eff, hr_mean=float(H.mean()))
    return dict(speed=None, n=len(rows), method="Referenz-HF nicht erreicht", eff=eff, hr_mean=float(H.mean()))
