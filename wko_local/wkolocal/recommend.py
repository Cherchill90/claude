"""Regelbasierte Trainingsempfehlung für den nächsten Tag.

Grundlage ist NUR die Belastungshistorie (CTL/ATL/TSB, harte Tage, Wettkämpfe, Plan) plus Deine Eingabe zum
Befinden. Schlaf, HRV, Stress, Krankheit, Termine sind nicht bekannt. Das sind Faustregeln, keine Trainingsplanung.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, timedelta

import numpy as np
import pandas as pd

from . import pmc as pmc_mod
from .wellness import form_adjustment
from .evidence import refs

WEEKDAYS = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"]
FEELINGS = ["Gut", "Normal", "Müde", "Krank"]


@dataclass
class Rec:
    day: date
    kind: str
    sport: str
    level: str                       # good | info | warn
    headline: str
    details: list[str] = field(default_factory=list)
    duration_min: tuple[int, int] | None = None
    tss: tuple[int, int] | None = None
    reasons: list[str] = field(default_factory=list)
    plan_note: tuple[str, str] | None = None


# ------------------------------------------------------------------ Formatierung / Sitzungsbausteine
def cited_ids(rec: "Rec") -> list[str]:
    """Quellenkürzel [Qn], die in Details/Begründung der Empfehlung vorkommen (für die Quellenanzeige)."""
    import re
    ids = re.findall(r"Q\d+", " ".join([*rec.details, *rec.reasons]))
    return sorted(set(ids), key=lambda s: int(s[1:]))


def _pace(sec_km: float) -> str:
    m, s = divmod(int(round(sec_km)), 60)
    return f"{m}:{s:02d}"


def _w(ftp: float, lo: float, hi: float) -> str:
    return f"{round(ftp * lo)}–{round(ftp * hi)} W"


def _p(thr: float, lo: float, hi: float) -> str:
    """Pace-Bereich für Anteil lo..hi der Schwellengeschwindigkeit (schneller zuerst)."""
    return f"{_pace(thr / hi)}–{_pace(thr / lo)} /km"


def _tss(segs: list[tuple[float, float]]) -> float:
    return sum(m / 60 * f * f * 100 for m, f in segs)


def _range(tss: float, spread=.12) -> tuple[int, int]:
    return round(tss * (1 - spread)), round(tss * (1 + spread))


def fuel_line(minutes: float, hard: bool = False) -> str | None:
    """Verpflegungshinweis nach Dauer/Intensität (Faustwerte aus Übersichtsarbeiten; individuell verträglich testen)."""
    if minutes < 60:
        return None
    if minutes > 150 or (hard and minutes > 90):
        return ("Verpflegung: ca. 60–90 g Kohlenhydrate/h (Glukose:Fruktose ≈ 2:1), in Trainingseinheiten Magen schrittweise daran gewöhnen; "
                "über 90 g/h nur mit Erfahrung – Magen-Darm-Beschwerden sind häufig. " + refs("Q18", "Q16"))
    return "Verpflegung: ca. 30–60 g Kohlenhydrate/h ab der ersten Stunde (je nach Intensität) – bei harten Einheiten eher 60 g/h. " + refs("Q18")


def build_session(kind: str, sport: str, ftp: float, run_pace: float | None, c: dict) -> tuple[list[str], tuple, tuple]:
    """(Beschreibung, Dauer-Bereich min, TSS-Bereich). c: end_min, long_min (typische Dauern der letzten Wochen)."""
    run = sport == "Running"
    if run and not run_pace:                      # ohne Schwellenpace keine Tempovorgaben
        run_pace = None
    def zone(lo, hi):
        if run: return _p(run_pace, lo, hi) if run_pace else "nach Gefühl (Gespräch möglich)"
        return _w(ftp, lo, hi)
    L: list[str] = []
    if kind == "Regeneration":
        m = 30 if run else 45
        segs = [(m, .62 if run else .50)]
        L = [f"{m} min sehr locker ({zone(.60, .72) if run else zone(.40, .55)}), Tempo bewusst bremsen – Ziel ist Durchblutung, kein Reiz."]
    elif kind == "Grundlage":
        m = int(np.clip(round(c["end_min"] / 5) * 5, 40 if run else 60, 75 if run else 150))
        segs = [(m, .82 if run else .68)]
        L = [f"{m} min gleichmäßig im Grundlagenbereich ({zone(.78, .88) if run else zone(.56, .75)}).",
             "Herzfrequenz stabil halten; wenn sie bei gleicher Leistung/Pace steigt, Tempo zurücknehmen."]
        if run and c.get("strides"):
            L.append("Optional am Ende: 4–6×20–30 s Steigerungen (bergauf oder flach, zügig aber nicht Sprint, volle Pause) – 2–3×/Woche; kleine Studien zeigen bessere Laufökonomie/Kurzzeitleistung. " + refs("Q2", "Q3"))
    elif kind == "Lange Grundlage":
        m = int(np.clip(round(c["long_min"] * 1.1 / 10) * 10, 70 if run else 120, 130 if run else 240))
        segs = [(m, .80 if run else .65)]
        L = [f"{m} min locker ({zone(.75, .86) if run else zone(.56, .72)})."]
        if c.get("finisher"):
            L.append("Optional (Ermüdungsresistenz): in den letzten 20–30 min gut verpflegt " +
                     ("4×30 s bergauf zügig (volle Pause)" if run else f"3×3 min bei {zone(1.0, 1.05)} (je 3 min locker)") +
                     ". Hypothese-Niveau: Übersichtsarbeit sieht lange Einheiten mit späten intensiven Abschnitten als plausibel, aber kaum Interventionsdaten. " + refs("Q7"))
    elif kind == "Sweetspot":
        segs = [(15, .6), (15, .90), (5, .5), (15, .90), (5, .5), (15, .90), (10, .5)] if not run else \
               [(15, .75), (15, .94), (3, .6), (15, .94), (10, .7)]
        L = ["15 min Einfahren/Einlaufen locker.",
             (f"2×15 min Tempodauerlauf bei {zone(.92, .96)}, 3 min Trabpause." if run else
              f"3×15 min bei {zone(.88, .94)}, 5 min locker dazwischen."), "10 min locker ausfahren/auslaufen."]
    elif kind == "Schwelle":
        segs = [(15, .6), (20, .97), (5, .5), (20, .97), (10, .5)] if not run else [(15, .75), (10, 1.0), (3, .6), (10, 1.0), (3, .6), (10, 1.0), (10, .7)]
        L = ["15 min Einfahren/Einlaufen, am Ende 2–3 kurze Steigerungen.",
             (f"3×10 min bei {zone(.97, 1.02)}, 3 min Trabpause." if run else f"2×20 min bei {zone(.95, 1.0)}, 5 min locker dazwischen."),
             "10 min locker ausfahren/auslaufen.", "Ziel: alle Intervalle gleichmäßig – Leistung/Pace im letzten Intervall ≥ erstem."]
    elif kind == "VO2max":
        segs = [(15, .6)] + [(4, 1.15), (4, .45)] * 5 + [(10, .5)] if not run else [(15, .75)] + [(3, 1.07), (2, .6)] * 5 + [(10, .7)]
        L = ["15 min Einfahren/Einlaufen.",
             (f"5×3 min bei {zone(1.05, 1.10)}, 2 min Trabpause." if run else f"5×4 min bei {zone(1.10, 1.20)}, 4 min locker dazwischen."),
             "10 min locker ausfahren/auslaufen.", "Nur starten, wenn Du frisch bist; bricht die Leistung ab, Einheit beenden statt durchquälen."]
    elif kind == "Aktivierung":
        m = 30 if run else 45
        segs = [(m, .72 if run else .65), (2, 1.1)]
        L = [f"{m} min locker ({zone(.78, .88) if run else zone(.56, .75)}) mit " + ("4×20 s Steigerungen." if run else f"3×30 s kurzen Antritten bei {zone(1.15, 1.30)} (je 2–3 min locker dazwischen)."),
             "Kurz und spritzig – nicht müde machen."]
    elif kind == "Taper":
        segs = [(15, .6), (5, .5)] + [(5, 1.0), (4, .5)] * 3 + [(10, .5)] if not run else [(15, .75), (5, 1.0), (3, .6), (5, 1.0), (3, .6), (5, 1.0), (10, .7)]
        L = ["Reduziertes Volumen, Intensität beibehalten:", (f"3×5 min bei {zone(.98, 1.03)}, 3 min Trabpause." if run else f"3×5 min bei {zone(.98, 1.05)}, 4 min locker dazwischen."), "Locker ausfahren/auslaufen."]
    else:
        return [], (0, 0), (0, 0)
    dur = sum(m for m, _ in segs)
    fl = fuel_line(dur, hard=kind in ("Schwelle", "VO2max", "Sweetspot", "Taper"))
    if fl and kind not in ("Regeneration", "Aktivierung"):
        L.append(fl)
    return L, (round(dur * .9), round(dur * 1.1)), _range(_tss(segs))


# ------------------------------------------------------------------ Zustand aus der Historie
def _hard(r) -> bool:
    long_run = r.sport == "Running" and r.duration_s >= 5400        # Trainerpraxis: langer Lauf = harte Einheit (Verletzungs-/Ermüdungsrisiko)
    return bool((r.if_ or 0) >= (.9 if r.sport == "Running" else .85) and r.duration_s >= 1200) or (r.tss or 0) >= 120 or long_run


def _key_type(r, ftp: float) -> str:
    if r.sport == "Running":
        return "VO2max" if (r.if_ or 0) >= 1.03 else "Schwelle"
    p5 = (r.mmp or {}).get("300") or (r.mmp or {}).get(300)
    return "VO2max" if p5 and ftp and p5 / ftp >= 1.08 else "Schwelle"


def recommend(today: date, daily_tss: pd.Series, recent: pd.DataFrame, races: pd.DataFrame, planned: pd.DataFrame,
              ftp: float, run_pace: float | None, feeling: str = "Normal", ctl_tau=42, atl_tau=7,
              readiness: dict | None = None) -> Rec:
    """Empfehlung für today+1. recent: Workouts der letzten ~28 Tage (alle Sportarten)."""
    D = today + timedelta(days=1)
    reasons: list[str] = []
    if daily_tss.empty:
        return Rec(D, "–", "–", "info", "Noch keine Trainingsdaten – nach dem ersten Import gibt es eine Empfehlung.")
    s = daily_tss.copy(); s.index = pd.to_datetime(s.index)
    s = s.groupby(level=0).sum()
    s = s.reindex(pd.date_range(s.index.min(), max(s.index.max(), pd.Timestamp(today))), fill_value=0.0)
    d = pmc_mod.pmc(s, ctl_tau, atl_tau)
    ctl, atl = float(d.ctl.iloc[-1]), float(d.atl.iloc[-1])
    tsb = ctl - atl
    # Erholungsdaten (Schlaf/HRV/Ruhepuls) senken die wirksame Form: gleiche Last bei schlechter Erholung ist "härter"
    adj = form_adjustment(readiness["points"]) if readiness and readiness.get("state") != "unknown" else 0.0
    tsb_load, tsb = tsb, tsb - adj
    ramp = float(d.ramp.iloc[-1]) if pd.notna(d.ramp.iloc[-1]) else 0.0
    last7 = s.iloc[-7:]
    streak = 0
    for v in s.iloc[::-1]:
        if v > 0: streak += 1
        else: break
    rest7 = int((last7 == 0).sum())

    rec = recent.copy()
    rec["d"] = [pd.Timestamp(x).date() for x in rec.date]
    hard_days = sorted({r.d for r in rec.itertuples() if _hard(r)})
    hard7 = sum(1 for x in hard_days if (today - x).days < 7)
    hard3 = sum(1 for x in hard_days if (today - x).days < 3)
    since_hard = (today - hard_days[-1]).days if hard_days else None
    hard_rows = [r for r in rec.itertuples() if _hard(r)]
    last_key = _key_type(max(hard_rows, key=lambda r: r.start_time), ftp) if hard_rows else None

    ride = rec[(rec.sport == "Cycling") & (rec.tss_method == "power")]
    endur = ride[ride.if_ < .8]
    c = dict(end_min=float(endur.duration_s.median() / 60) if len(endur) else 75,
             long_min=float(ride.duration_s.max() / 60) if len(ride) else 150)
    runs = rec[rec.sport == "Running"]
    # Lange Einheiten (Rad ≥ 120 min, Lauf ≥ 90 min) in den letzten 14 Tagen; Wochenumfang; Krafteinheiten
    recent14 = rec[[(today - x).days < 14 for x in rec.d]] if len(rec) else rec
    long_done = bool(len(recent14) and (((recent14.sport == "Cycling") & (recent14.duration_s >= 7200)) | ((recent14.sport == "Running") & (recent14.duration_s >= 5400))).any())
    h7 = float(rec[[(today - x).days < 7 for x in rec.d]].duration_s.sum() / 3600) if len(rec) else 0.0
    h_avg = float(rec.duration_s.sum() / 3600 / 4) if len(rec) else 0.0
    is_strength = rec.sport.map(lambda s: str(s).lower().startswith("strength") or str(s).lower() in ("training", "gym")) if len(rec) else pd.Series(dtype=bool)
    strength7 = int(sum(1 for x, f in zip(rec.d, is_strength) if f and (today - x).days < 7)) if len(rec) else 0
    if len(runs):
        c["end_min"] = c["end_min"]   # Lauf-Dauern werden in build_session gedeckelt

    if len(s) < 42:
        reasons.append(f"Achtung: erst {len(s)} Tage Historie – CTL/TSB sind noch nicht belastbar (Start bei 0), die Form wirkt zu negativ.")
    reasons.append(f"Form (TSB) morgen früh: {tsb_load:+.0f} (CTL {ctl:.0f}, ATL {atl:.0f}); Rampe {ramp:+.1f} CTL/Woche."
                   + (f" Mit Erholungsdaten angepasst: {tsb:+.0f} (−{adj:.0f})." if adj else ""))
    reasons.append(f"Letzte 7 Tage: {7 - rest7} Trainingstage, {hard7} harte Einheit(en)"
                   + (f"; letzte harte Einheit vor {since_hard} Tag(en)." if since_hard is not None else "; keine harte Einheit in 28 Tagen."))

    # ---- Erholungsdaten (Schlaf/HRV/Ruhepuls) ergänzen Dein Befinden
    eff = feeling
    if readiness and readiness.get("state") in ("low", "reduced") and feeling in ("Gut", "Normal"):
        eff = "Müde" if (readiness["state"] == "low" and feeling == "Normal") else "Reduziert"
        reasons.append("Schlaf/HRV/Ruhepuls: " + " ".join(i.text for i in readiness["items"][1:] if i.level in ("warn", "bad")))
    elif readiness and readiness.get("state") == "ok":
        reasons.append("Schlaf/HRV/Ruhepuls unauffällig.")

    # ---- Wettkämpfe
    next_race = None
    race_today_or_yday = None
    if len(races):
        rr = races.copy(); rr["d"] = pd.to_datetime(rr.date).dt.date
        up = rr[rr.d >= D].sort_values("d")
        if len(up): next_race = up.iloc[0]
        back = rr[(rr.d >= today - timedelta(days=1)) & (rr.d <= today)]
        if len(back): race_today_or_yday = back.iloc[-1]
    days_to = (next_race.d - D).days if next_race is not None else None
    race_sport = next_race.sport if next_race is not None else "Cycling"

    kind = None
    if feeling == "Krank":
        kind = "Ruhetag"; reasons.insert(0, "Du bist krank: nicht trainieren. Erst nach Symptomfreiheit (bei Fieber mindestens 2 Tage danach) locker einsteigen.")
    elif next_race is not None and days_to == 0:
        kind = "Wettkampf"
        reasons.append(f"Wettkampf „{next_race['name']}“ ({next_race.priority}) steht morgen an.")
    elif race_today_or_yday is not None:
        kind = "Ruhetag" if (race_today_or_yday.tss or 0) >= 100 else "Regeneration"
        reasons.append(f"Wettkampf „{race_today_or_yday['name']}“ war vor ≤ 1 Tag – Erholung hat Vorrang.")
    elif next_race is not None and days_to == 1:
        kind = "Aktivierung"; reasons.append(f"Wettkampf „{next_race['name']}“ übermorgen: kurze Aktivierungseinheit statt Belastung.")
    elif next_race is not None and next_race.priority in ("A", "B") and 2 <= days_to <= (9 if next_race.priority == "A" else 4):
        kind = "Taper" if (days_to >= 3 and tsb >= -12 and feeling != "Müde") else "Grundlage"
        reasons.append(f"{next_race.priority}-Wettkampf „{next_race['name']}“ in {days_to + 1} Tagen: Tapering (Volumen runter, Intensität kurz beibehalten).")
        if kind == "Grundlage":
            c["end_min"] = min(c["end_min"], 60)
    # ---- Ermüdung
    if kind is None:
        fatigued_hard = tsb < -30 or (ctl > 15 and atl / ctl > 1.5)
        if fatigued_hard or streak >= 7:
            kind = "Ruhetag"
            reasons.append("Sehr hohe Ermüdung (TSB < −30 bzw. ATL ≫ CTL)." if fatigued_hard else f"{streak} Trainingstage in Folge: Ruhetag einplanen.")
        elif streak >= 5 and tsb < -15 or (hard3 >= 2 and tsb < -10):
            kind = "Regeneration"
            reasons.append("Mehrere harte Tage/lange Serie bei negativer Form: lockere Entlastung statt weiterer Belastung.")
        elif since_hard == 0:
            kind = "Regeneration" if tsb < -10 else "Grundlage"
            reasons.append("Heute war eine harte Einheit: morgen locker, damit sie wirkt.")
            if kind == "Grundlage": c["end_min"] = min(c["end_min"], 75)
    # ---- Normalfall
    normal_path = kind is None
    if kind is None:
        limit = -25 if feeling == "Gut" else -20
        if ramp > 8:
            kind = "Grundlage"; reasons.append(f"Rampe {ramp:.1f} CTL/Woche ist aggressiv: keine zusätzliche Intensität.")
        elif hard7 >= 2 and not (tsb > 15 and hard7 < 3):
            kind = "Lange Grundlage" if D.weekday() >= 5 and tsb >= -20 else "Grundlage"
            reasons.append(f"{hard7} harte Einheiten in 7 Tagen – das Intensitätskontingent (≈ 2/Woche, langer Lauf zählt mit) ist ausgeschöpft. "
                           "Beobachtungsstudien: Erfolgreiche Ausdauersportler trainieren vor allem viel locker; mehr Intensität allein bringt nicht mehr. " + refs("Q4", "Q6"))
        elif since_hard == 1:
            kind = "Grundlage"; reasons.append("Gestern war eine harte Einheit: heute erst einmal locker.")
        elif tsb >= limit:
            kind = "Sweetspot" if tsb < -10 else ("VO2max" if last_key == "Schwelle" else "Schwelle")
            reasons.append("Ausreichend erholt für eine Schlüsseleinheit" + (f" (letzte: {last_key} → Abwechslung)." if last_key else ".") + " Pro Woche reichen ca. 2 harte Einheiten, der Rest bleibt locker. " + refs("Q6"))
            if kind == "Sweetspot": reasons.append("Form leicht negativ: Sweetspot setzt Reiz bei geringerer Ermüdung als Schwelle/VO2max.")
        else:
            kind = "Grundlage"; reasons.append(f"Form {tsb:+.0f} ist für harte Intervalle zu niedrig (Grenze {limit}).")
        if kind == "Grundlage" and D.weekday() >= 5 and tsb >= -20 and hard7 >= 1:
            kind = "Lange Grundlage"; reasons.append("Wochenende: Zeit für einen längeren, lockeren Umfang.")
    if normal_path and kind == "Grundlage" and not long_done and since_hard not in (0, 1) and ramp <= 8 and tsb >= -15 and eff not in ("Müde", "Reduziert"):
        kind = "Lange Grundlage"
        reasons.append("Seit 14 Tagen keine lange Einheit (Rad ≥ 2 h, Lauf ≥ 1,5 h). Regelmäßige lange Einheiten hingen bei Läufern mit geringerem Leistungsabfall bei Ermüdung zusammen (Querschnitt, nur Männer; "
                       "Übersichtsarbeit: plausibel, kaum Interventionsdaten). " + refs("Q11", "Q7"))
    if kind in ("Grundlage", "Lange Grundlage") and normal_path and h_avg > 3 and h7 < .7 * h_avg and tsb >= -10 and eff not in ("Müde", "Reduziert"):
        reasons.append(f"Umfang der letzten 7 Tage {h7:.1f} h liegt unter Deinem 4-Wochen-Schnitt ({h_avg:.1f} h/Woche): Kontinuität zählt – Einheit nicht kürzen. " + refs("Q7", "Q4"))
        c["end_min"] = c["end_min"] * 1.15
    # ---- Befinden: müde -> eine Stufe herunter
    if eff == "Reduziert":
        if kind in ("Schwelle", "VO2max"):
            reasons.append(f"Erholungsdaten eingeschränkt: {kind} → Sweetspot (weniger Stress).")
            kind = "Sweetspot"
    if eff == "Müde":
        down = {"Schwelle": "Grundlage", "VO2max": "Grundlage", "Sweetspot": "Grundlage", "Taper": "Grundlage",
                "Lange Grundlage": "Grundlage", "Grundlage": "Regeneration", "Aktivierung": "Aktivierung", "Wettkampf": "Wettkampf"}
        if kind in down and down[kind] != kind:
            reasons.append(("Du fühlst Dich müde" if feeling == "Müde" else "Erholungsdaten deutlich eingeschränkt") + f": {kind} → {down[kind]}.")
            kind = down[kind]
            c["end_min"] = min(c["end_min"], 60)

    c["strides"] = eff not in ("Müde", "Reduziert") and hard7 <= 2
    c["finisher"] = kind == "Lange Grundlage" and eff not in ("Müde", "Reduziert") and tsb >= -10 and hard7 <= 1
    # ---- Sportart
    sport = "–"
    if kind != "Ruhetag":
        cnt = rec.groupby("sport").size()
        cands = [x for x in ("Cycling", "Running") if cnt.get(x, 0) >= 2] or [x for x in ("Cycling", "Running") if cnt.get(x, 0) >= 1] or ["Cycling"]
        def days_since(x, hard=False):
            sub = rec[(rec.sport == x)] if not hard else rec[(rec.sport == x) & rec.apply(_hard, axis=1)] if len(rec) else rec
            return (today - max(sub.d)).days if len(sub) else 99
        if kind in ("Wettkampf", "Aktivierung", "Taper") and next_race is not None:
            sport = race_sport if race_sport in ("Cycling", "Running") else cands[0]
        elif len(cands) == 1:
            sport = cands[0]
        else:
            ran_today = len(runs[runs.d == today]) > 0 and runs[runs.d == today].tss.sum() >= 50
            if kind in ("Regeneration", "Lange Grundlage") or ran_today or eff == "Müde":
                sport = "Cycling"
            elif kind in ("Schwelle", "VO2max", "Sweetspot"):
                sport = max(cands, key=lambda x: (days_since(x, hard=True), x == "Cycling"))
            else:
                sport = max(cands, key=lambda x: (days_since(x), x == "Cycling"))
            if sport == "Running" and kind == "Lange Grundlage" and "Cycling" not in cands:
                sport = "Running"
        reasons.append(f"Sportart {sport}: " + ("schonender für Gelenke/Muskulatur – aerober Reiz ohne Laufstoßbelastung (Trainerpraxis, keine Studie)." if sport == "Cycling" and kind in ("Regeneration", "Lange Grundlage", "Grundlage") and len(runs) else
                                          "schonender für Gelenke/Muskulatur" if sport == "Cycling" and kind in ("Regeneration", "Lange Grundlage") else "ergibt sich aus Abstand zur letzten (harten) Einheit."))

    if kind == "Ruhetag":
        details, dur, tss = ["Kein Training. Optional: 20–30 min Spaziergang, Mobilisation, ausreichend Schlaf und Essen."], None, (0, 0)
    elif kind == "Wettkampf":
        details = [f"Wettkampf: „{next_race['name']}“.", "Aufwärmen 15–20 min locker mit 2–3 kurzen Steigerungen kurz vor dem Start.",
                   "Vorher Kohlenhydrate (2–3 h vor dem Start eine ca. 1–2 g/kg Mahlzeit), bei > 1 h unterwegs 60–90 g Kohlenhydrate pro Stunde."]
        dur = None; tss = (round(next_race.tss), round(next_race.tss)) if pd.notna(next_race.tss) and next_race.tss else None
    else:
        details, dur, tss = build_session(kind, sport, ftp, run_pace, c)
        if sport == "Running" and not run_pace and kind not in ("Regeneration", "Grundlage", "Lange Grundlage", "Aktivierung"):
            details.insert(0, "Hinweis: keine Schwellenpace hinterlegt – Tempo nach Gefühl (Schwelle ≈ Tempo, das Du ca. 45–60 min halten könntest).")

    if kind in ("Grundlage", "Lange Grundlage") and strength7 < 2 and eff not in ("Müde", "Reduziert"):
        details.append(f"Zusatz Kraft: {strength7} Krafteinheit(en) in den letzten 7 Tagen erfasst. 2×/Woche Maximalkraft/Plyometrie (z. B. Kniebeugen, Step-ups, Nordic Curls, Pogo-Sprünge; 20–40 min) "
                       "verbesserte in einem kleinen RCT die Laufökonomie und Leistung nach 90 min Belastung. Ob direkt nach der Ausdauereinheit besser ist, wurde nicht geprüft. " + refs("Q12"))
    level = {"Ruhetag": "info", "Regeneration": "info", "Wettkampf": "good", "Aktivierung": "good"}.get(kind, "good")
    if feeling == "Krank": level = "warn"
    wd = WEEKDAYS[D.weekday()]
    headline = f"Morgen ({wd}, {D:%d.%m.}): " + (f"{kind}" if sport == "–" else f"{kind} – {'Rad' if sport == 'Cycling' else 'Lauf'}")

    # ---- Plan-Abgleich
    plan_note = None
    if len(planned):
        pt = planned[pd.to_datetime(planned.date).dt.date == D]
        if len(pt):
            pl = float(pt.tss.sum())
            if kind in ("Ruhetag", "Regeneration") and pl >= 80:
                plan_note = ("warn", f"Dein Plan sieht {pl:.0f} TSS vor – der aktuelle Belastungsstand spricht eher für Erholung. Plan prüfen/verschieben.")
            elif kind in ("Schwelle", "VO2max", "Sweetspot") and pl <= 40:
                plan_note = ("info", f"Dein Plan sieht nur {pl:.0f} TSS vor – Du wärst für eine Schlüsseleinheit frisch genug.")
            else:
                plan_note = ("good", f"Dein Plan ({pl:.0f} TSS) passt grundsätzlich zur Empfehlung.")
    return Rec(D, kind, sport, level, headline, details, dur, tss, reasons, plan_note)
