"""Power-Profil, Phänotyp und Fatigue Resistance.

Die Referenzwerte sind eine Näherung an die übliche Power-Profile-Tabelle (Anker: Untrainiert /
Weltklasse in W/kg, dazwischen log-linear interpoliert). Frauen = 0.88 x Männer. Anker bei
Bedarf in ANCHORS anpassen – sie sind keine exakte Kopie der Originaltabelle.
"""
from __future__ import annotations

import numpy as np

# Dauer(s): (untrainiert, weltklasse) W/kg, Männer
ANCHORS = {5: (9.0, 25.0), 60: (3.2, 11.5), 300: (1.9, 7.6), 1200: (1.6, 6.7)}
LEVELS = [(0, "Untrainiert"), (12, "Fair"), (25, "Moderat"), (40, "Gut"), (55, "Sehr gut"),
          (70, "Ausgezeichnet"), (85, "Exzellent"), (97, "Weltklasse")]
LABEL = {5: "5 s (Sprint)", 60: "1 min (Anaerob)", 300: "5 min (VO2max)", 1200: "20 min (Schwelle)"}


def score(duration: int, watts: float, weight: float, sex="m") -> float:
    lo, hi = ANCHORS[duration]
    k = 0.88 if sex == "f" else 1.0
    wkg = watts / weight / k
    return float(np.clip((np.log(max(wkg, 1e-3)) - np.log(lo)) / (np.log(hi) - np.log(lo)) * 100, 0, 100))


def level(sc: float) -> str:
    return [n for t, n in LEVELS if sc >= t][-1]


def profile(mmp: dict, weight: float, sex="m") -> list[dict]:
    rows = []
    for d in ANCHORS:
        w = mmp.get(d) or mmp.get(str(d))
        if w:
            sc = score(d, w, weight, sex)
            rows.append(dict(Dauer=LABEL[d], d=d, Watt=round(w), WperKg=round(w / weight, 2),
                             Score=round(sc), Level=level(sc)))
    return rows


def phenotype(rows: list[dict]) -> tuple[str, str]:
    """Heuristische Einordnung anhand der Score-Verteilung (keine WKO-Logik)."""
    s = {r["d"]: r["Score"] for r in rows}
    if len(s) < 4:
        return "Unbestimmt", "Zu wenige Bestwerte (5 s, 1, 5, 20 min nötig)."
    sprint, anaer, vo2, thr = s[5], s[60], s[300], s[1200]
    if sprint - thr >= 15 and sprint >= max(anaer, vo2):
        return "Sprinter", "Starke Spitzenleistung, relativ schwächere Dauerleistung."
    if thr - sprint >= 15 and thr >= vo2 - 5:
        return "Zeitfahrer / Diesel", "Hohe Schwellenleistung, begrenzte Spitzen."
    if max(anaer, vo2) - thr >= 10 and max(anaer, vo2) - sprint >= 5:
        return "Pursuiter / Puncheur", "Stark im 1–5-min-Bereich (FRC/VO2max)."
    return "Allrounder", "Ausgeglichenes Profil über alle Dauern."


def fatigue_resistance(workouts_fatigue: list[dict]) -> dict:
    """Beste Leistung je (kJ, Dauer) über viele Workouts und % vom frischen Bestwert."""
    best: dict[tuple[int, int], float] = {}
    for f in workouts_fatigue:
        for kj, d in (f or {}).items():
            for dur, w in d.items():
                k = (int(kj), int(dur))
                best[k] = max(best.get(k, 0), w)
    fresh = {d: w for (kj, d), w in best.items() if kj == 0}
    table = {}
    for (kj, d), w in sorted(best.items()):
        if d in fresh and fresh[d]:
            table.setdefault(d, {})[kj] = (w, w / fresh[d] * 100)
    return table
