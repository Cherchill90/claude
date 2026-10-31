"""Krafttraining für Läufer: ob, wann und wie – als Ergänzung zur Laufeinheit des Tages.

Grundlage (siehe evidence.py):
- Wirkung: schweres Krafttraining und Plyometrie verbessern die Laufökonomie, schwere Lasten etwas stärker;
  submaximal/isometrisch zeigte keinen Effekt; Wirkung ab ca. 8–10 Wochen; 2–3 Einheiten/Woche [Q24, Q25, Q26, Q27, Q12].
- Zeitpunkt: Interferenz vor allem in derselben Einheit, kaum bei > 2 h Abstand [Q28]; schwere Beinkraft kann die
  Laufökonomie < 24 h (geübt) bis 48 h (ungeübt) verschlechtern [Q30] → nicht vor Schlüsseleinheiten/Wettkämpfen.
  Am selben Tag: zuerst laufen, Kraft mit Abstand danach [Q31]. "Harte Tage hart, lockere Tage locker" ist Trainerpraxis.
- Erhalt: im Wettkampfblock ca. 1×/Woche mit reduziertem Umfang [Q32, Praxisableitung].
Alles Faustregeln – Technik und Belastbarkeit gehen vor Last; bei Schmerzen abbrechen.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, timedelta

import pandas as pd

from .evidence import refs

KEY_RUNS = ("Schwelle", "VO2max", "Sweetspot")


@dataclass
class StrengthRec:
    available: bool
    title: str
    timing: str = ""
    level: str = "info"
    duration_min: tuple[int, int] | None = None
    blocks: list[dict] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)
    reasons: list[str] = field(default_factory=list)


def strength_dates(workouts: pd.DataFrame, log: pd.DataFrame) -> list[date]:
    """Tage mit Krafttraining: manuell erfasst + importierte Garmin-Krafteinheiten (Sport 'Training'/'Strength')."""
    days = set()
    if len(log):
        days |= {date.fromisoformat(d) for d in log.date}
    if len(workouts):
        m = workouts.sport.map(lambda s: str(s).lower().startswith("strength") or str(s).lower() in ("training", "gym"))
        days |= {date.fromisoformat(d) for d in workouts[m].date}
    return sorted(days)


# ------------------------------------------------------------------ Programme
def _heavy() -> list[dict]:
    return [
        dict(Block="Aufwärmen", Übung="Mobilisation Hüfte/Sprunggelenk, Seilspringen oder lockere Hops", Umfang="8–10 min", Intensität="locker", Pause="–"),
        dict(Block="Plyometrie", Übung="Pogo-Sprünge (steife Sprunggelenke, kurzer Bodenkontakt)", Umfang="3 × 20 Kontakte", Intensität="explosiv", Pause="60–90 s"),
        dict(Block="Plyometrie", Übung="Box- oder Counter-Movement-Jumps", Umfang="3 × 5", Intensität="maximal, weich landen", Pause="90 s"),
        dict(Block="Kraft", Übung="Kniebeuge (alternativ Trap-Bar-Kreuzheben)", Umfang="3–4 × 3–5", Intensität="ca. 85–90 % 1RM (1–2 Wdh. Reserve)", Pause="2–3 min"),
        dict(Block="Kraft", Übung="Rumänisches Kreuzheben", Umfang="3 × 5", Intensität="schwer, saubere Technik", Pause="2 min"),
        dict(Block="Kraft", Übung="Bulgarische Split-Kniebeuge oder Step-up", Umfang="3 × 5 je Bein", Intensität="schwer", Pause="90 s"),
        dict(Block="Kraft", Übung="Wadenheben gestreckt + gebeugt (Soleus)", Umfang="3 × 8", Intensität="schwer, langsam ablassen", Pause="60 s"),
        dict(Block="Rumpf (optional)", Übung="Copenhagen-Seitstütz, Seitstütz", Umfang="2 × 20–30 s je Seite", Intensität="kontrolliert", Pause="30 s"),
    ]


def _beginner() -> list[dict]:
    return [
        dict(Block="Aufwärmen", Übung="Mobilisation Hüfte/Sprunggelenk, lockeres Seilspringen", Umfang="8 min", Intensität="locker", Pause="–"),
        dict(Block="Plyometrie", Übung="Pogo-Sprünge niedrig", Umfang="2 × 15 Kontakte", Intensität="leicht, Technik", Pause="60 s"),
        dict(Block="Kraft", Übung="Kniebeuge (Goblet oder Langhantel)", Umfang="3 × 8", Intensität="mittel (3 Wdh. Reserve)", Pause="90 s"),
        dict(Block="Kraft", Übung="Rumänisches Kreuzheben (Kurzhantel)", Umfang="3 × 8", Intensität="mittel", Pause="90 s"),
        dict(Block="Kraft", Übung="Step-up oder Ausfallschritt", Umfang="2 × 8 je Bein", Intensität="mittel", Pause="60 s"),
        dict(Block="Kraft", Übung="Wadenheben gestreckt + gebeugt", Umfang="3 × 12", Intensität="mittel", Pause="45 s"),
        dict(Block="Rumpf", Übung="Seitstütz, Glute-Bridge", Umfang="2 × 30 s", Intensität="kontrolliert", Pause="30 s"),
    ]


def _maintenance() -> list[dict]:
    return [
        dict(Block="Aufwärmen", Übung="Mobilisation, lockere Hops", Umfang="6–8 min", Intensität="locker", Pause="–"),
        dict(Block="Plyometrie", Übung="Pogo-Sprünge", Umfang="2 × 10 Kontakte", Intensität="explosiv", Pause="60 s"),
        dict(Block="Kraft", Übung="Kniebeuge oder Trap-Bar-Kreuzheben", Umfang="2 × 3", Intensität="schwer wie gewohnt (Last halten, Umfang halbiert)", Pause="2–3 min"),
        dict(Block="Kraft", Übung="Wadenheben", Umfang="2 × 8", Intensität="schwer", Pause="60 s"),
    ]


def _mobility() -> list[dict]:
    return [dict(Block="Mobilität", Übung="Hüftbeuger, Waden, Sprunggelenk, Fußkraft (Zehengreifen), Seitstütz", Umfang="10–15 min", Intensität="locker, kein Muskelkater", Pause="–")]


# ------------------------------------------------------------------ Entscheidung
def recommend_strength(day: date, run_kind: str, strength_days: list[date], next_day_key: bool,
                       days_to_race: int | None, race_priority: str | None, experience: str = "Einsteiger",
                       feeling: str = "Normal") -> StrengthRec:
    """Kraftempfehlung für den Tag `day`, an dem die Laufeinheit `run_kind` geplant ist."""
    last = max([d for d in strength_days if d < day], default=None)
    since = (day - last).days if last else None
    week = sum(1 for d in strength_days if 0 < (day - d).days <= 7)
    maintenance = days_to_race is not None and race_priority in ("A", "B") and days_to_race <= 21
    target = 1 if maintenance else 2
    r: list[str] = []

    def off(title, *why, mobility=True):
        return StrengthRec(False, title, "", "info", (10, 15) if mobility else None, _mobility() if mobility else [], [], list(why))

    if feeling in ("Krank",):
        return off("Kein Krafttraining", "Krank: kein Training, auch keine Kraft.", mobility=False)
    if run_kind == "Ruhetag":
        return off("Kein Krafttraining", "Ruhetag bleibt Ruhetag – Kraft besser an einen harten Lauftag legen (Trainerpraxis).", mobility=False)
    if days_to_race is not None and days_to_race <= 4:
        return off("Krafttraining pausieren", f"Wettkampf in {days_to_race + 1} Tagen: keine schwere Beinkraft mehr – sie kann die Laufökonomie noch 24–48 h verschlechtern. " + refs("Q30"))
    if run_kind in ("Wettkampf", "Aktivierung"):
        return off("Kein Krafttraining", "Wettkampf/Aktivierung: frisch bleiben.")
    if since is not None and since < 2:
        return off("Kein Krafttraining", f"Letzte Krafteinheit vor {since} Tag(en): mindestens 48 h Abstand zwischen Krafteinheiten.")
    if week >= target:
        return off("Wochenziel erreicht", f"{week} Krafteinheit(en) in 7 Tagen – Ziel {target}/Woche" + (" (Erhalt vor dem Wettkampf)" if maintenance else "") + " erreicht. " + refs("Q24"))
    if next_day_key:
        return off("Heute keine schwere Beinkraft", "Morgen steht eine Schlüsseleinheit oder ein Wettkampf an: schwere Beinkraft kann die Laufökonomie bis 24 h (geübt) bzw. 48 h (ungeübt) verschlechtern. " + refs("Q30"))
    if run_kind == "Regeneration" or feeling == "Müde":
        return off("Heute keine schwere Kraft", "Erholungstag, Du fühlst Dich müde oder Schlaf/HRV/Ruhepuls sind deutlich eingeschränkt: nur leichte Mobilität.")
    if run_kind == "Lange Grundlage":
        return off("Heute keine schwere Kraft", "Langer Lauf: schon eine große Belastung – Kraft besser an einen kürzeren harten Tag (Trainerpraxis).")

    # ---- Krafteinheit sinnvoll
    if maintenance:
        title, blocks, dur = "Kraft-Erhalt (reduzierter Umfang)", _maintenance(), (20, 30)
        r.append(f"{race_priority}-Wettkampf in {days_to_race + 1} Tagen: Last halten, Umfang halbieren, ca. 1×/Woche bis ca. 5 Tage vorher. " + refs("Q32"))
    elif experience == "Geübt":
        title, blocks, dur = "Schwere Kraft + Plyometrie", _heavy(), (40, 50)
        r.append("Schwere Lasten (nahe Maximum) verbesserten die Laufökonomie in Meta-Analysen stärker als Plyometrie; beides kombiniert ist üblich. "
                 "Submaximales/isometrisches Krafttraining zeigte keinen Effekt. " + refs("Q26", "Q25"))
    else:
        title, blocks, dur = "Kraft-Einstieg (Technik & Gewöhnung)", _beginner(), (30, 40)
        r.append("Einstieg: 3–4 Wochen mit mittleren Lasten Technik lernen, dann schrittweise auf schwere Lasten (3–5 Wdh.) steigern – erst diese zeigen den klaren Laufökonomie-Effekt. " + refs("Q25", "Q26"))
    if run_kind in KEY_RUNS:
        timing = "Am selben Tag NACH dem Lauf – idealerweise mit ≥ 6 h Abstand (z. B. Lauf morgens, Kraft abends), sonst direkt danach."
        r.append("Harte Tage bündeln: Kraft an den Tag der harten Laufeinheit, damit lockere Tage locker bleiben und die nächste Schlüsseleinheit ausgeruht ist (Trainerpraxis). "
                 "Mit > 2 h Abstand zeigte sich kaum Interferenz; zuerst laufen, Kraft danach. " + refs("Q28", "Q31"))
        level = "good"
    else:
        timing = "Nach dem lockeren Lauf, möglichst mit einigen Stunden Abstand."
        r.append("Lockerer Lauftag: möglich, solange morgen keine Schlüsseleinheit folgt. Besser wäre ein harter Lauftag (harte Tage bündeln).")
        level = "info"
    r.append(f"Bisher {week} Krafteinheit(en) in 7 Tagen, Ziel {target}/Woche; Wirkung zeigt sich nach ca. 8–10 Wochen regelmäßigen Trainings. " + refs("Q24", "Q26"))
    notes = ["Saubere Technik vor Last; bei Schmerzen (nicht Anstrengung) abbrechen.",
             "Bei Neuaufnahme oder Wiedereinstieg: Muskelkater einplanen – die ersten 1–2 Einheiten nicht vor harten Läufen."]
    return StrengthRec(True, title, timing, level, dur, blocks, notes, r)
