"""Schlaf- und HRV-Daten: Parser für Garmin-Antworten und Erholungs-Einschätzung (Readiness).

Die Einschätzung vergleicht die letzten 3 Nächte mit Deiner eigenen Baseline (28 Nächte davor). Sie ist eine
Faustregel-Ampel, keine medizinische Aussage; Garmins eigene HRV-Bewertung wird nur zusätzlich angezeigt.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from .insights import Insight as I


def parse_day(day: str, sleep: dict | None, hrv: dict | None, source="garmin") -> dict | None:
    """Garmin get_sleep_data/get_hrv_data -> eine Zeile. None, wenn weder Schlaf noch HRV vorliegen."""
    sleep = sleep or {}
    dto = sleep.get("dailySleepDTO") or {}
    score = ((dto.get("sleepScores") or {}).get("overall") or {}).get("value")
    hs = (hrv or {}).get("hrvSummary") or {}
    base = hs.get("baseline") or {}
    night = hs.get("lastNightAvg") or sleep.get("avgOvernightHrv") or dto.get("avgSleepHRV")
    row = dict(date=day, sleep_s=dto.get("sleepTimeSeconds") or None, deep_s=dto.get("deepSleepSeconds"),
               light_s=dto.get("lightSleepSeconds"), rem_s=dto.get("remSleepSeconds"), awake_s=dto.get("awakeSleepSeconds"),
               sleep_score=score, hrv_night=night, hrv_week=hs.get("weeklyAvg"), hrv_status=hs.get("status"),
               hrv_low=base.get("balancedLow"), hrv_high=base.get("balancedUpper"),
               resting_hr=sleep.get("restingHeartRate") or dto.get("restingHeartRate"), source=source)
    if not row["sleep_s"] and not row["hrv_night"]:
        return None
    return row


def readiness(df: pd.DataFrame, today=None) -> dict:
    """Ampel aus HRV, Schlaf und Ruhepuls. state: ok | reduced | low | unknown; items: Liste von Insight."""
    if df.empty:
        return dict(state="unknown", points=0, items=[I("info", "Keine Schlaf-/HRV-Daten – Garmin-Sync mit „HRV & Schlaf“ ausführen.")])
    d = df.copy(); d["d"] = pd.to_datetime(d.date); d = d.sort_values("d").set_index("d")
    today = pd.Timestamp(today if today is not None else d.index.max()).normalize()
    d = d[d.index <= today]
    recent = d[d.index > today - pd.Timedelta(days=3)]
    base = d[(d.index <= today - pd.Timedelta(days=3)) & (d.index > today - pd.Timedelta(days=31))]
    items, pts = [], 0
    if len(recent) == 0:
        return dict(state="unknown", points=0, items=[I("info", f"Letzte Erholungsdaten sind älter als 3 Tage ({d.index.max():%d.%m.}) – Sync ausführen.")])
    # --- HRV
    h3, hb = recent.hrv_night.dropna(), base.hrv_night.dropna()
    if len(h3) >= 2 and len(hb) >= 10 and hb.std() > 0:
        z, drop = (h3.mean() - hb.mean()) / hb.std(), (h3.mean() / hb.mean() - 1) * 100
        txt = f"HRV (letzte {len(h3)} Nächte) {h3.mean():.0f} ms vs. Baseline {hb.mean():.0f} ± {hb.std():.0f} ms ({drop:+.0f} %)"
        if z <= -1.5: items.append(I("bad", txt + " – deutlich unter Deiner Norm: Hinweis auf hohe Belastung, Krankheit oder Stress.")); pts += 2
        elif z <= -1.0: items.append(I("warn", txt + " – unter Deiner Norm.")); pts += 1
        elif z >= 1.0: items.append(I("good", txt + " – überdurchschnittlich, gut erholt."))
        else: items.append(I("good", txt + " – im normalen Bereich."))
    elif len(h3):
        items.append(I("info", f"HRV letzte Nächte {h3.mean():.0f} ms – für eine Bewertung fehlen noch Daten (mind. 10 Nächte Baseline)."))
    st = recent.hrv_status.dropna()
    if len(st) and str(st.iloc[-1]).upper() in ("LOW", "UNBALANCED", "POOR"):
        items.append(I("info", f"Garmin bewertet Deine HRV als „{st.iloc[-1]}“."))
    # --- Schlaf
    s3 = recent.sleep_s.dropna() / 3600
    if len(s3):
        avg, last = s3.mean(), s3.iloc[-1]
        txt = f"Schlaf: Ø {avg:.1f} h in den letzten {len(s3)} Nächten (letzte Nacht {last:.1f} h)"
        if avg < 6 or last < 5: items.append(I("bad", txt + " – deutlich zu wenig, Regeneration eingeschränkt.")); pts += 2
        elif avg < 7: items.append(I("warn", txt + " – etwas knapp (Richtwert für Sportler 7–9 h).")); pts += 1
        else: items.append(I("good", txt + " – ausreichend."))
    sc = recent.sleep_score.dropna()
    if len(sc) and sc.mean() < 60:
        items.append(I("warn", f"Schlafscore Ø {sc.mean():.0f} (< 60): schlechte Schlafqualität.")); pts += 1
    # --- Ruhepuls
    r3, rb = recent.resting_hr.dropna(), base.resting_hr.dropna()
    if len(r3) >= 2 and len(rb) >= 10:
        delta = r3.mean() - rb.median()
        txt = f"Ruhepuls {r3.mean():.0f} bpm ({delta:+.0f} vs. Baseline {rb.median():.0f})"
        if delta >= 8: items.append(I("bad", txt + " – deutlich erhöht (Krankheit/Übermüdung möglich).")); pts += 2
        elif delta >= 5: items.append(I("warn", txt + " – erhöht.")); pts += 1
        else: items.append(I("good", txt + " – normal."))
    state = "low" if pts >= 3 else "reduced" if pts == 2 else "ok"
    head = {"low": I("bad", "Erholung: deutlich eingeschränkt – heute/morgen Belastung reduzieren."),
            "reduced": I("warn", "Erholung: leicht eingeschränkt – keine harte Einheit erzwingen."),
            "ok": I("good", "Erholung: unauffällig – Daten sprechen nicht gegen Training.")}[state]
    return dict(state=state, points=pts, items=[head, *items], last_date=recent.index.max())


ADJ_PER_POINT = 5.0     # TSB-Punkte Abzug je Erholungs-Punkt (Heuristik, nicht validiert)
ADJ_CAP = 25.0


def form_adjustment(points: int) -> float:
    return min(ADJ_CAP, ADJ_PER_POINT * max(points, 0))


def adjusted_form(pmc_df: pd.DataFrame, wellness: pd.DataFrame, days: int = 120) -> pd.DataFrame:
    """Ergänzt die PMC um readiness_pts und tsb_adj = TSB − Abzug aus Schlaf/HRV/Ruhepuls.
    CTL/ATL/TSB bleiben unverändert (reine Trainingslast); der Abzug gilt nur für Tage mit Erholungsdaten
    (Bewertung je Tag aus den 3 Nächten bis zu diesem Tag gegen 28 Nächte davor)."""
    out = pmc_df.copy()
    out["readiness_pts"] = 0
    if wellness.empty or out.empty:
        out["tsb_adj"] = out["tsb"]
        return out
    first = wellness.date.min()
    for d in out.index[-days:]:
        if f"{d:%Y-%m-%d}" < first:
            continue
        r = readiness(wellness, d)
        if r["state"] != "unknown":
            out.loc[d, "readiness_pts"] = r["points"]
    out["tsb_adj"] = out["tsb"] - out["readiness_pts"].map(form_adjustment)
    return out
