"""Automatische Einordnung der Daten (Texte für die Oberfläche).

Alles hier sind Faustregeln/Richtwerte, keine individuelle Diagnose. Jede Funktion liefert eine Liste von
Insight-Objekten; das ERSTE Element ist die Kernaussage (wird farbig hervorgehoben).
level: good | info | warn | bad
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta

import numpy as np
import pandas as pd

from . import metrics


@dataclass
class Insight:
    level: str
    text: str


I = Insight
ICON = {"good": "✅", "info": "ℹ️", "warn": "⚠️", "bad": "🛑"}


def _g(m: dict, d: int):
    """MMP/SMM-Wert zu Dauer d (JSON-Schlüssel sind Strings)."""
    return m.get(str(d)) if str(d) in m else m.get(d)


def _tss_category(tss: float) -> str:
    if tss < 150: return "niedrig (meist bis zum nächsten Tag erholt)"
    if tss < 300: return "mittel (am Folgetag oft noch Restermüdung)"
    if tss < 450: return "hoch (Restermüdung auch nach 2 Tagen möglich)"
    return "sehr hoch (mehrere Tage Erholung nötig)"


def _pace(sec_km: float) -> str:
    m, s = divmod(int(round(sec_km)), 60)
    return f"{m}:{s:02d}"


def _verdict(checks: list[Insight], goal: str) -> Insight:
    warns = sum(c.level in ("warn", "bad") for c in checks)
    goods = sum(c.level == "good" for c in checks)
    if warns == 0 and goods:
        return I("good", f"Gute Einheit für das Ziel „{goal}“: alle geprüften Kriterien erfüllt.")
    if warns >= 1 and goods == 0:
        return I("warn", f"Einheit wich vom Ziel „{goal}“ ab (siehe ⚠️).")
    if warns == 1:
        return I("info", f"Weitgehend passend für „{goal}“ – ein Punkt prüfen (siehe ⚠️).")
    if warns >= 2:
        return I("warn", f"Einheit wich vom Ziel „{goal}“ ab: {warns} Kriterien nicht erfüllt.")
    return I("info", f"Einheit als „{goal}“ eingeordnet; zu wenig Daten für eine Bewertung.")


# ===================================================================== Rad-Workout
RIDE_TYPES = ["Erholung", "Grundlage", "Tempo", "Schwelle", "VO2max", "Rennen"]


def classify_ride(p: np.ndarray, ftp: float, if_: float, vi: float | None) -> tuple[str, pd.DataFrame]:
    iv = metrics.detect_intervals(p, .9 * ftp, min_s=120)
    hard = iv[iv["Ø_W"] >= 1.05 * ftp] if len(iv) else iv
    thr = iv[(iv["Ø_W"] >= .9 * ftp) & (iv["Ø_W"] < 1.05 * ftp)] if len(iv) else iv
    if if_ >= .85 and vi and vi >= 1.15: return "Rennen", iv
    if len(hard) >= 2 and hard["Dauer_s"].sum() >= 360: return "VO2max", iv
    if len(thr) >= 1 and thr["Dauer_s"].sum() >= 900: return "Schwelle", iv
    if if_ >= .85 and vi and vi >= 1.12: return "Rennen", iv
    if if_ < .55: return "Erholung", iv
    if if_ < .75: return "Grundlage", iv
    return "Tempo", iv


def _fade(sel: pd.DataFrame) -> float:
    pw = sel["Ø_W"].to_numpy(); k = max(len(pw) // 3, 1)
    return (pw[-k:].mean() - pw[:k].mean()) / pw[:k].mean() * 100


def assess_ride(w, df: pd.DataFrame, ftp: float, intent: str = "Automatisch") -> list[Insight]:
    p = metrics.clean_power(df["power"])
    if_, vi, tss, n = w.if_, w.vi, w.tss, len(p)
    auto, iv = classify_ride(p, ftp, if_ or 0, vi)
    typ = auto if intent == "Automatisch" else intent
    zs = metrics.time_in_zones(p, ftp)["Anteil %"].to_numpy()
    low, ch = zs[:2].sum(), []
    if typ == "Erholung":
        ch.append(I("good", f"IF {if_:.2f} – locker genug für Regeneration.") if if_ <= .60 else
                  I("warn", f"IF {if_:.2f} ist für eine Erholungseinheit zu hoch (Richtwert ≤ 0,60)."))
    elif typ == "Grundlage":
        ch.append(I("good", f"IF {if_:.2f} liegt im Grundlagenbereich (0,55–0,78).") if .55 <= if_ <= .78 else
                  I("warn", f"IF {if_:.2f} außerhalb des Grundlagenbereichs (0,55–0,78) – "
                            + ("zu hart, wird eher Tempo." if if_ > .78 else "sehr locker, kaum Trainingsreiz.")))
        ch.append(I("good", f"{low:.0f} % der Zeit in Z1–2.") if low >= 70 else
                  I("warn", f"Nur {low:.0f} % in Z1–2 (Richtwert ≥ 70 %) – zu viel Tempo für eine Grundlageneinheit."))
        if n < 3600: ch.append(I("info", "Unter 60 min: für Grundlagenausdauer eher kurz."))
    elif typ == "Tempo":
        t = float(((p >= .76 * ftp) & (p < .91 * ftp)).sum()) / 60
        ch.append(I("good", f"IF {if_:.2f}, {t:.0f} min im Tempobereich (76–90 % FTP).") if t >= 20 else
                  I("warn", f"Nur {t:.0f} min im Tempobereich (76–90 % FTP); Richtwert ≥ 20 min."))
    elif typ in ("Schwelle", "VO2max"):
        lo, hi, mn = (.9, 1.05, 900) if typ == "Schwelle" else (1.05, 9, 360)
        sel = iv[(iv["Ø_W"] >= lo * ftp) & (iv["Ø_W"] < hi * ftp)] if len(iv) else iv
        tot = sel["Dauer_s"].sum() if len(sel) else 0
        ch.append(I("good", f"{tot / 60:.0f} min effektive {typ}-Arbeit in {len(sel)} Intervall(en).") if tot >= mn else
                  I("warn", f"Nur {tot / 60:.0f} min {typ}-Arbeit (Richtwert ≥ {mn // 60} min) – Reiz eher gering."))
        if len(sel) >= 3:
            f = _fade(sel)
            ch.append(I("good", f"Gleichmäßig durchgezogen ({f:+.1f} % erstes→letztes Drittel).") if abs(f) <= 3 else
                      I("good", f"Negativ gesplittet ({f:+.1f} %) – gut dosiert.") if f > 3 else
                      I("warn", f"Leistungsabfall {f:.1f} % über die Intervalle – zu hoch angesetzt oder Pausen zu kurz.")
                      if f < -5 else I("info", f"Leichter Abfall {f:.1f} % – im normalen Bereich."))
            cv = sel["Ø_W"].std() / sel["Ø_W"].mean() * 100
            if cv > 6: ch.append(I("info", f"Intervall-Leistungen streuen ({cv:.0f} % CV) – Zielwatt konsequenter halten."))
        if len(sel):
            m = sel["Ø_W"].mean() / ftp * 100
            if typ == "Schwelle" and m > 105: ch.append(I("info", f"Ø {m:.0f} % FTP – eher VO2max als Schwelle."))
            if typ == "Schwelle" and m < 92: ch.append(I("info", f"Ø {m:.0f} % FTP – eher Sweetspot/Tempo; FTP evtl. zu hoch gesetzt?"))
    else:  # Rennen
        ch.append(I("info", f"IF {if_:.2f}, VI {vi:.2f}: Wettkampf-/Gruppenfahrt-typisch variabel."))
    if typ in ("Grundlage", "Tempo") and n >= 3600 and vi and vi <= 1.10 and pd.notna(w.decoupling):
        d = w.decoupling
        ch.append(I("good", f"Pw:HR-Entkopplung {d:.1f} % (< 5 %) – stabile aerobe Basis.") if d < 5 else
                  I("info", f"Entkopplung {d:.1f} % (5–8 %) – grenzwertig, Hitze/Flüssigkeit/Ermüdung prüfen.") if d < 8 else
                  I("warn", f"Entkopplung {d:.1f} % (> 8 %) – deutliche Herzfrequenz-Drift: Ermüdung, Hitze oder zu hohe Intensität."))
    if typ in ("Erholung", "Grundlage") and vi and vi > 1.15:
        ch.append(I("info", f"VI {vi:.2f}: unruhige Fahrweise – für eine Ausdauereinheit gleichmäßiger fahren."))
    head = _verdict(ch, typ) if typ != "Rennen" else I("info", "Als Rennen/Gruppenfahrt eingeordnet – keine Zielprüfung.")
    note = I("info", f"Belastung {tss:.0f} TSS = {_tss_category(tss)}."
             + ("" if intent == "Automatisch" else f" Ziel manuell gewählt; automatisch erkannt: {auto}."))
    return [head, *ch, note]


def compare_to_history(w, prior: pd.DataFrame, label_unit="W") -> list[Insight]:
    """Vergleich mit den 90 Tagen davor: neue Bestwerte und Effizienz bei ähnlicher Intensität."""
    prior = prior[(prior.start_time < w.start_time) & (prior.uid != w.uid)]
    if len(prior) < 3:
        return [I("info", "Zu wenige frühere Einheiten (< 3 in 90 Tagen) für einen Vergleich.")]
    out = []
    is_run = w.sport == "Running"
    src = "smm" if is_run else "mmp"
    best: dict[int, float] = {}
    for m in prior[src]:
        for k, v in m.items(): best[int(k)] = max(best.get(int(k), 0), v)
    durs = ((60, "1 min"), (300, "5 min"), (600, "10 min"), (1200, "20 min"), (3600, "60 min")) if is_run else \
           ((5, "5 s"), (60, "1 min"), (300, "5 min"), (1200, "20 min"), (3600, "60 min"))
    for d, lbl in durs:
        cur, b = _g(w[src], d), best.get(d)
        if not cur or not b: continue
        pct = (cur / b - 1) * 100
        val = lambda x: (f"{_pace(1000 / x)}/km" if is_run else f"{x:.0f} W")
        if pct >= 1: out.append(I("good", f"Neue 90-Tage-Bestleistung {lbl}: {val(cur)} ({pct:+.1f} %)."))
        elif pct >= -2 and d >= 300: out.append(I("info", f"{lbl}: {val(cur)} – nahe an Deiner 90-Tage-Bestleistung ({pct:+.1f} %)."))
    sim = prior[(prior.if_.sub(w.if_ or 0).abs() <= .08) & prior.duration_s.between(.6 * w.duration_s, 1.6 * w.duration_s)
                & prior.ef.notna()].tail(10)
    if pd.notna(w.ef) and len(sim) >= 3:
        diff = (w.ef / sim.ef.median() - 1) * 100
        if diff >= 3: out.append(I("good", f"Effizienz (EF) {diff:+.1f} % gegenüber {len(sim)} ähnlichen Einheiten – bei gleicher Intensität weniger Herzschlag nötig."))
        elif diff <= -3: out.append(I("warn", f"Effizienz (EF) {diff:+.1f} % gegenüber ähnlichen Einheiten – mögliche Ursachen: Ermüdung, Hitze, Krankheit, Koffein/Schlaf."))
        else: out.append(I("info", f"Effizienz (EF) {diff:+.1f} % – unverändert gegenüber ähnlichen Einheiten."))
    if not out:
        out.append(I("info", "Keine neuen Bestwerte und kein Effizienzunterschied gegenüber den letzten 90 Tagen."))
    return out


# ===================================================================== Lauf-Workout
def assess_run(w, df: pd.DataFrame, run_pace: float | None) -> list[Insight]:
    sp = metrics.get_speed(df)
    ch: list[Insight] = []
    if w.tss_method != "pace" or not run_pace:
        return [I("warn", "Keine Schwellenpace hinterlegt – Intensität und TSS sind nur grobe HR-Näherungen, keine Bewertung möglich."),
                I("info", "Trag Deine Schwellenpace unter „Athlet & Daten“ ein (Startwert: Critical Speed auf der Lauf-Seite).")]
    rif = w.if_
    var = (w.ngp / w.avg_speed) if w.avg_speed else 1
    if rif < .80: typ = "lockerer Lauf / Regeneration"
    elif rif < .90: typ = "Dauerlauf / Grundlage"
    elif rif < 1.0: typ = "Tempo- / Schwellenlauf"
    else: typ = "Intervall- / Wettkampfintensität"
    head = I("info", f"Eingeordnet als {typ} (rIF {rif:.2f}); Belastung {w.tss:.0f} TSS = {_tss_category(w.tss)}.")
    moving = sp > .5
    if var <= 1.06 and sp.sum() >= 3000 and moving.sum() > 600:
        idx = np.flatnonzero(moving); a, b = idx[:len(idx) // 2], idx[len(idx) // 2:]
        v1, v2 = sp[a].mean(), sp[b].mean()
        d = (v2 / v1 - 1) * 100
        if d >= 1: ch.append(I("good", f"Negativer Split: 2. Hälfte {d:.1f} % schneller – gut eingeteilt."))
        elif d >= -3: ch.append(I("good", f"Gleichmäßiges Tempo (2. Hälfte {d:+.1f} %)."))
        elif d >= -6: ch.append(I("info", f"2. Hälfte {abs(d):.1f} % langsamer – leichtes Nachlassen."))
        else: ch.append(I("warn", f"Tempoeinbruch: 2. Hälfte {abs(d):.1f} % langsamer – zu schnell angegangen oder Ermüdung."))
    elif var > 1.06:
        ch.append(I("info", f"Wechselndes Tempo (NGP/Ø = {var:.2f}) – Intervall-/Fahrtspielcharakter, Hälftenvergleich nicht sinnvoll."))
    if pd.notna(w.decoupling) and var <= 1.06 and w.duration_s >= 2400:
        dc = w.decoupling
        ch.append(I("good", f"Pace:HR-Entkopplung {dc:.1f} % (< 5 %) – stabile aerobe Basis.") if dc < 5 else
                  I("info", f"Entkopplung {dc:.1f} % (5–8 %) – grenzwertig.") if dc < 8 else
                  I("warn", f"Entkopplung {dc:.1f} % (> 8 %) – HF driftet: Ermüdung, Hitze oder zu schnell für die Dauer."))
    if rif < .80 and w.duration_s < 1800:
        ch.append(I("info", "Locker und kurz: eher Auslaufen/Erholung als Trainingsreiz."))
    return [head, *ch]


# ===================================================================== PMC / Dashboard
def assess_pmc(d: pd.DataFrame) -> list[Insight]:
    if len(d) < 14:
        return [I("info", "Weniger als 14 Tage Verlauf – CTL/ATL sind noch nicht aussagekräftig.")]
    last, out = d.iloc[-1], []
    tsb = last.tsb
    if tsb > 25: head = I("info", f"Form {tsb:+.0f}: sehr frisch – Fitness baut ab, wenn das nicht ein Tapering/Pause ist.")
    elif tsb > 5: head = I("good", f"Form {tsb:+.0f}: frisch – guter Bereich für Wettkampf oder harte Schlüsseleinheit.")
    elif tsb > -10: head = I("info", f"Form {tsb:+.0f}: neutral – Training und Erholung im Gleichgewicht.")
    elif tsb > -30: head = I("good", f"Form {tsb:+.0f}: produktiver Belastungsbereich – normal in einem Trainingsblock.")
    else: head = I("bad", f"Form {tsb:+.0f}: stark ermüdet – erhöhtes Risiko für Überlastung/Krankheit; Entlastung erwägen.")
    out.append(head)
    ramp = last.ramp
    if pd.notna(ramp):
        out.append(I("warn", f"Fitness-Rampe {ramp:+.1f} CTL/Woche ist aggressiv (> 8) – Überlastungsrisiko.") if ramp > 8 else
                   I("info", f"Rampe {ramp:+.1f} CTL/Woche: zügiger Aufbau, nur mit ausreichender Erholung halten.") if ramp > 5 else
                   I("good", f"Rampe {ramp:+.1f} CTL/Woche: nachhaltiger Aufbau.") if ramp >= 0 else
                   I("info", f"Rampe {ramp:+.1f} CTL/Woche: Fitness sinkt (Erholungsphase oder Trainingslücke)."))
    if len(d) >= 29:
        c0, c1 = d.ctl.iloc[-29], d.ctl.iloc[-1]
        pct = (c1 / c0 - 1) * 100 if c0 > 5 else np.nan
        out.append(I("good" if c1 - c0 >= 3 else "warn" if c1 - c0 <= -5 else "info",
                     f"CTL in 4 Wochen: {c0:.0f} → {c1:.0f} ({c1 - c0:+.0f}" + (f", {pct:+.0f} %)." if np.isfinite(pct) else ").")))
    trained = d[d.tss > 0]
    if len(trained):
        gap = (d.index[-1] - trained.index[-1]).days
        if gap >= 7: out.append(I("warn", f"Seit {gap} Tagen kein Training erfasst – Fitness baut ab (oder Daten fehlen: Sync prüfen)."))
    if last.ctl > 10 and last.atl / last.ctl > 1.5:
        out.append(I("warn", f"ATL/CTL = {last.atl / last.ctl:.1f}: kurzfristige Last weit über Deiner Basis – Verletzungs-/Überlastungsrisiko."))
    return out


def assess_dashboard(recent: pd.DataFrame, previous: pd.DataFrame, d: pd.DataFrame) -> list[Insight]:
    out = assess_pmc(d)[:3] if len(d) >= 14 else []
    if len(recent):
        h1, h0 = recent.duration_s.sum() / 3600, previous.duration_s.sum() / 3600
        t1, t0 = recent.tss.sum(), previous.tss.sum()
        if h0 > 0:
            ch = (t1 / t0 - 1) * 100 if t0 else 0
            out.append(I("warn" if ch > 40 else "info" if abs(ch) < 20 else "good" if ch > 0 else "info",
                         f"Letzte 4 Wochen: {h1:.1f} h / {t1:.0f} TSS vs. davor {h0:.1f} h / {t0:.0f} TSS ({ch:+.0f} % TSS)."
                         + (" Sprung > 40 % – Überlastungsrisiko beachten." if ch > 40 else "")))
        days = recent.date.nunique()
        out.append(I("good" if days >= 12 else "info", f"Trainingstage in 4 Wochen: {days} (≈ {days / 4:.1f}/Woche)."
                     + (" Regelmäßigkeit ist der größte Fortschrittstreiber." if days < 12 else "")))
    return out or [I("info", "Noch zu wenig Daten für eine Einordnung.")]


# ===================================================================== Modell / Fortschritt
def assess_model(mdl, mmp: dict, ftp_set: float, weight: float) -> list[Insight]:
    out, ratio = [], mdl.mftp / ftp_set if ftp_set else 1
    if ratio > 1.05: head = I("info", f"Modell-mFTP {mdl.mftp:.0f} W liegt {100 * (ratio - 1):.0f} % über Deiner hinterlegten FTP ({ftp_set:.0f} W): Zonen evtl. zu niedrig – nur anheben, wenn der Zeitraum echte Maximalbelastungen enthält.")
    elif ratio < .93: head = I("warn", f"Modell-mFTP {mdl.mftp:.0f} W liegt {100 * (1 - ratio):.0f} % unter Deiner FTP ({ftp_set:.0f} W): FTP evtl. zu hoch – oder es fehlen lange Maximalefforts im Zeitraum.")
    else: head = I("good", f"Modell-mFTP {mdl.mftp:.0f} W passt zu Deiner FTP ({ftp_set:.0f} W, Abweichung {100 * (ratio - 1):+.0f} %).")
    out.append(head)
    b20 = mmp.get(1200)
    if b20 and mdl.mftp > b20 * 1.0:
        out.append(I("warn", f"mFTP liegt über Deinem besten 20-min-Wert ({b20:.0f} W): Modell extrapoliert – unplausibel hoch."))
    if mdl.rmse / mdl.mftp > .10:
        out.append(I("warn", f"Modellfehler {mdl.rmse:.0f} W ({mdl.rmse / mdl.mftp * 100:.0f} % von mFTP): Kurve passt schlecht – Parameter mit Vorsicht lesen."))
    if max(mmp) < 1500:
        out.append(I("info", "Kein Effort > 25 min im Zeitraum: mFTP/Stamina sind schlecht bestimmt. Für ein belastbares Modell: 1× pro Block 5-, 20- und ggf. 60-min-Maximaltest/-Rennen."))
    out.append(I("info", f"FRC {mdl.frc / 1000:.1f} kJ ({mdl.frc / weight / 1000:.2f} kJ/kg), Pmax {mdl.pmax:.0f} W ({mdl.pmax / weight:.1f} W/kg). "
                         "Trainierte Fahrer liegen typischerweise bei ca. 10–25 kJ FRC."))
    return out


def _trend(df: pd.DataFrame, col: str, gap_days=42):
    s = df.dropna(subset=[col])
    if len(s) < 2: return None
    cur = s.iloc[-1]
    ref = s[s.Datum <= cur.Datum - timedelta(days=gap_days)]
    ref = ref.iloc[-1] if len(ref) else s.iloc[0]
    if ref.Datum == cur.Datum or not ref[col]: return None
    return cur[col], ref[col], (cur[col] / ref[col] - 1) * 100, (cur.Datum - ref.Datum).days


def assess_progress(df: pd.DataFrame) -> list[Insight]:
    out = []
    for col, lbl, unit in (("mFTP", "mFTP", "W"), ("FRC", "FRC", "kJ"), ("Pmax", "Pmax", "W"),
                           ("1200s", "20-min-Bestwert", "W"), ("300s", "5-min-Bestwert", "W"), ("60s", "1-min-Bestwert", "W")):
        if col not in df: continue
        t = _trend(df, col)
        if not t: continue
        cur, ref, pct, days = t
        lvl = "good" if pct >= 3 else "warn" if pct <= -3 else "info"
        txt = (f"{lbl}: {ref:.0f} → {cur:.0f} {unit} ({pct:+.1f} % in {days} Tagen) – "
               + ("echte Verbesserung." if pct >= 3 else "Rückgang." if pct <= -3 else "innerhalb der Schwankung (< 3 %), keine belastbare Änderung."))
        out.append(I(lvl, txt))
    if not out: return [I("info", "Zu wenige Modellpunkte für einen Trend (mind. 2 Fenster nötig).")]
    # Kernaussage zuerst
    out.sort(key=lambda i: {"good": 0, "warn": 1, "info": 2}[i.level])
    out.append(I("info", "Ein Rückgang kann auch bedeuten, dass im Fenster keine Maximalbelastung gefahren wurde – nicht zwingend, dass Du schlechter bist."))
    return out


def assess_zones(tot_s: np.ndarray) -> list[Insight]:
    tot = tot_s.sum()
    if tot < 3600 * 3: return [I("info", "Zu wenig Zeit in Zonen (< 3 h) für eine Verteilungsanalyse.")]
    p = tot_s / tot * 100
    low, mid, high = p[:2].sum(), p[2:4].sum(), p[4:].sum()
    if low >= 75 and mid <= 15 and high >= 5: head = I("good", f"Polarisierte Verteilung (Z1–2 {low:.0f} %, Z3–4 {mid:.0f} %, Z5+ {high:.0f} %): bewährt für Ausdauerentwicklung.")
    elif low >= 70: head = I("good", f"Pyramidale/Grundlagen-betonte Verteilung (Z1–2 {low:.0f} %, Z3–4 {mid:.0f} %, Z5+ {high:.0f} %) – solide Basis.")
    elif mid >= 35: head = I("warn", f"Viel „Grauzone“: {mid:.0f} % in Z3–4, nur {low:.0f} % locker – oft zu hart für leichte und zu leicht für harte Tage.")
    elif low < 55: head = I("warn", f"Nur {low:.0f} % locker (Z1–2): intensitätslastig – Erholung und Grundlage prüfen.")
    else: head = I("info", f"Z1–2 {low:.0f} %, Z3–4 {mid:.0f} %, Z5+ {high:.0f} %.")
    out = [head]
    if high < 3 and tot > 3600 * 10: out.append(I("info", "Kaum Z5+: Spitzenleistung (VO2max/Anaerob) wird kaum trainiert."))
    out.append(I("info", "Richtwert für viele Ausdauersportler: ca. 75–80 % locker, wenig Z3–4, Rest hart. Zeit-in-Zone ignoriert die Intervallstruktur."))
    return out


def assess_profile(rows: list[dict]) -> list[Insight]:
    if len(rows) < 3: return [I("info", "Zu wenige Bestwerte für eine Profilanalyse.")]
    best, worst = max(rows, key=lambda r: r["Score"]), min(rows, key=lambda r: r["Score"])
    hint = {5: "Sprint/Maximalkraft (kurze Starts, Kraftarbeit)", 60: "anaerobe Kapazität (30–90-s-Intervalle)",
            300: "VO2max (3–5-min-Intervalle)", 1200: "Schwellenleistung (Sweetspot, 2×20 min)"}
    out = [I("info", f"Stärke: {best['Dauer']} (Score {best['Score']}, {best['Level']}). Limiter: {worst['Dauer']} (Score {worst['Score']}, {worst['Level']}).")]
    if best["Score"] - worst["Score"] >= 20:
        out.append(I("info", f"Größter Hebel: {hint.get(worst['d'], worst['Dauer'])}. Das Profil ist deutlich unausgewogen (Spanne {best['Score'] - worst['Score']} Punkte)."))
    else:
        out.append(I("good", "Ausgeglichenes Profil – keine deutliche Schwäche."))
    out.append(I("warn", "Scores beruhen auf Näherungswerten und auf Deinen Bestwerten im Zeitraum. Fehlende Maximalbelastungen führen zu scheinbaren Schwächen."))
    return out


def assess_fatigue(table: dict) -> list[Insight]:
    best = None
    for d in (1200, 300, 60):
        if d in table and len(table[d]) >= 2:
            kjs = sorted(table[d]); kj = kjs[-1]
            if kj > 0: best = (d, kj, table[d][kj][1])
            break
    if not best:
        return [I("info", "Keine Daten nach Vorbelastung – dafür braucht es Workouts mit > 1000 kJ und anschließenden harten Efforts.")]
    d, kj, pct = best
    lbl = f"{d // 60} min" if d >= 60 else f"{d} s"
    if pct >= 95: head = I("good", f"Sehr hohe Ermüdungsresistenz: {lbl}-Bestleistung nach {kj} kJ noch bei {pct:.0f} % des frischen Werts.")
    elif pct >= 90: head = I("good", f"Gute Ermüdungsresistenz: {pct:.0f} % nach {kj} kJ ({lbl}).")
    elif pct >= 85: head = I("info", f"Durchschnittlich: {pct:.0f} % nach {kj} kJ ({lbl}).")
    else: head = I("warn", f"Schwäche unter Ermüdung: nur {pct:.0f} % nach {kj} kJ ({lbl}) – lange Einheiten mit Intensität am Ende, Fueling prüfen.")
    return [head, I("info", "Richtwerte (eigene Heuristik). Fehlende Zellen = nie so hart nach so viel Arbeit gefahren, nicht schlechte Werte.")]


def assess_races(fc: pd.DataFrame, races: pd.DataFrame, today) -> list[Insight]:
    """Prognose der Form am Wettkampftag (fc: Prognose-PMC; tsb = Form am Morgen des Tages)."""
    today = pd.Timestamp(today).normalize()
    out = []
    up = races[pd.to_datetime(races.date) >= today].sort_values("date") if len(races) else races
    for r in up.head(3).itertuples():
        d = pd.Timestamp(r.date)
        if d not in fc.index: continue
        row, days = fc.loc[d], (d - today).days
        txt = f"{r.priority}-Wettkampf „{r.name}“ in {days} Tag(en): CTL {row.ctl:.0f}, Form am Renntag {row.tsb:+.0f}"
        if r.priority == "A":
            if 5 <= row.tsb <= 25: out.append(I("good", txt + " – im Zielbereich (+5…+25)."))
            elif row.tsb < 5: out.append(I("warn" if row.tsb < -5 else "info", txt + " – zu müde für ein A-Ziel: Tapering früher beginnen/Umfang in den Tagen davor reduzieren (Plan anpassen)."))
            else: out.append(I("info", txt + " – sehr frisch; bei längerer Pause verlierst Du Fitness, die Entlastung kann kürzer sein."))
        else:
            out.append(I("good" if row.tsb >= -10 else "info", txt + (" – okay für ein B/C-Rennen." if row.tsb >= -10 else " – Ermüdung ist bei einem B/C-Rennen im Block akzeptabel.")))
    if not out:
        return []
    out.append(I("info", "Prognose basiert auf Plan und eingetragenen Wettkampf-TSS; ohne Planeinträge wird ab morgen Nicht-Training (0 TSS) angenommen."))
    return out


# ===================================================================== Lauf-Seite, Planung, Daten
def assess_run_page(cs, run_pace: float | None, rw: pd.DataFrame) -> list[Insight]:
    out = []
    if cs:
        if run_pace:
            diff = (run_pace / cs.cs_pace_s_km - 1) * 100       # >0: hinterlegte Pace langsamer als CS
            if diff < -2: out.append(I("warn", f"Hinterlegte Schwellenpace ({_pace(run_pace)}) ist schneller als Deine Critical Speed ({_pace(cs.cs_pace_s_km)}) – vermutlich zu ambitioniert, rTSS wird überschätzt."))
            elif diff > 8: out.append(I("info", f"Hinterlegte Schwellenpace ({_pace(run_pace)}) ist {diff:.0f} % langsamer als CS ({_pace(cs.cs_pace_s_km)}) – konservativ, rTSS wird eher überschätzt; ggf. anpassen."))
            else: out.append(I("good", f"Schwellenpace ({_pace(run_pace)}) passt zu Deiner Critical Speed ({_pace(cs.cs_pace_s_km)})."))
        else:
            out.append(I("info", f"Keine Schwellenpace hinterlegt. Startwert: ca. {_pace(cs.cs_pace_s_km)}/km (Critical Speed)."))
        if cs.r2 < .98: out.append(I("warn", f"Schwacher Modellfit (R² {cs.r2:.3f}) – Bestwerte 3–30 min stammen vermutlich nicht aus Maximalefforts."))
    else:
        out.append(I("warn", "Kein Critical-Speed-Modell möglich: zu wenige harte Läufe zwischen 3 und 30 min im Zeitraum."))
    r = rw.copy(); r["d"] = pd.to_datetime(r.date)
    now = r.d.max()
    ef1, ef0 = r[r.d > now - timedelta(days=28)].ef.dropna(), r[(r.d <= now - timedelta(days=28)) & (r.d > now - timedelta(days=56))].ef.dropna()
    if len(ef1) >= 3 and len(ef0) >= 3:
        ch = (ef1.median() / ef0.median() - 1) * 100
        out.append(I("good" if ch >= 3 else "warn" if ch <= -3 else "info",
                     f"Effizienz (m/min je Herzschlag) letzte 4 vs. vorherige 4 Wochen: {ch:+.1f} % – "
                     + ("aerobe Verbesserung." if ch >= 3 else "Rückgang (Ermüdung, Hitze, Krankheit?)." if ch <= -3 else "unverändert.")))
    km = (r.avg_speed.fillna(0) * r.duration_s / 1000).groupby(r.d.dt.to_period("W")).sum()
    if len(km) >= 5:
        last, base = km.iloc[-2], km.iloc[-6:-2].mean()      # letzte volle Woche vs. 4 Wochen davor
        if base > 5 and last / base > 1.3:
            out.append(I("warn", f"Wochenumfang {last:.0f} km = {100 * (last / base - 1):.0f} % über dem 4-Wochen-Schnitt ({base:.0f} km) – Verletzungsrisiko steigt bei schnellen Sprüngen."))
    return out or [I("info", "Noch zu wenige Läufe für eine Einordnung.")]


def assess_plan(fc: pd.DataFrame) -> list[Insight]:
    pl = fc[fc.geplant]
    if pl.empty: return [I("info", "Kein geplanter Zeitraum in der Prognose.")]
    start, end = fc[~fc.geplant].iloc[-1] if (~fc.geplant).any() else fc.iloc[0], fc.iloc[-1]
    out = [I("info", f"Prognose: CTL {start.ctl:.0f} → {end.ctl:.0f}, Form am Ende {end.tsb:+.0f}.")]
    mx = fc.ctl.diff(7)[fc.geplant].max()
    out.append(I("warn", f"Geplante Rampe bis {mx:.1f} CTL/Woche (> 8) – aggressiv.") if mx > 8 else
               I("good", f"Maximale geplante Rampe {mx:.1f} CTL/Woche – tragbar.") if mx > 0 else
               I("info", "Plan lässt die Fitness sinken/halten."))
    wk = pl.tss.resample("W").sum()
    if len(wk) >= 4:
        run = best = 1
        for a, b in zip(wk.values[:-1], wk.values[1:]):
            run = run + 1 if b >= a * .95 else 1
            best = max(best, run)
        if best >= 4: out.append(I("info", f"{best} Wochen in Folge ohne Entlastung – üblich ist eine leichtere Woche (≈ 60 % TSS) alle 3–4 Wochen."))
    if end.tsb > 5: out.append(I("good", "Am Planende frisch (TSB > +5) – passt zu Wettkampf/Test."))
    elif end.tsb < -20: out.append(I("info", "Am Planende noch stark ermüdet – ok im Block, für einen Wettkampf zu wenig Tapering."))
    return out


def assess_data(wk: pd.DataFrame, thr: pd.DataFrame, today) -> list[Insight]:
    out = []
    today = pd.Timestamp(today)
    if thr.dropna(subset=["ftp"]).empty: out.append(I("bad", "Keine FTP hinterlegt – alle Rad-TSS-Werte und Zonen sind unzuverlässig."))
    else:
        age = (today - pd.to_datetime(thr.dropna(subset=["ftp"]).date).max()).days
        if age > 90: out.append(I("warn", f"FTP zuletzt vor {age} Tagen gesetzt – ggf. aktualisieren (siehe Power-Duration-Kurve)."))
    if "weight" not in thr or thr.weight.dropna().empty: out.append(I("warn", "Kein Gewicht hinterlegt – W/kg und Profil-Level sind falsch."))
    if len(wk):
        runs = wk[wk.sport == "Running"]
        if len(runs) and (runs.tss_method == "hr").any():
            out.append(I("warn", f"{(runs.tss_method == 'hr').sum()} Läufe nur mit HR-Näherung (keine Schwellenpace) – Pace eintragen und neu berechnen."))
        rides = wk[(wk.sport == "Cycling")]
        if len(rides) and (rides.tss_method != "power").any():
            out.append(I("info", f"{(rides.tss_method != 'power').sum()} Rad-Einheiten ohne Leistungsdaten (TSS aus HR oder 0)."))
        spikes = [r.uid for r in wk.itertuples() if (_g(r.mmp, 1) or 0) > 2200]
        if spikes: out.append(I("warn", f"{len(spikes)} Einheit(en) mit > 2200 W (1 s) – mögliche Messspitzen, verfälschen Pmax/Profil."))
        gap = (today - pd.to_datetime(wk.date).max()).days
        if gap > 7: out.append(I("info", f"Letzte importierte Einheit vor {gap} Tagen – Sync ausführen?"))
    return [*out] or [I("good", "Keine Auffälligkeiten bei Schwellenwerten und Datenqualität.")]


# ===================================================================== Erklärungen je Ansicht
EXPLAIN = {
"Dashboard": """
**CTL** (Fitness) ist der gleitende 42-Tage-Schnitt Deiner Tageslast, **ATL** (Ermüdung) der 7-Tage-Schnitt, **TSB** = CTL − ATL (Form).
Steigende CTL bei tragbarer Rampe = Fortschritt im Training. mFTP/FRC/Pmax kommen aus dem Leistungsmodell des gewählten Zeitraums.
**Gute Entwicklung:** CTL steigt 2–5/Woche, TSB bewegt sich zwischen −30 und +10, 4+ Trainingstage pro Woche. **Alarmzeichen:** Rampe > 8, TSB < −30, plötzliche Umfangssprünge.""",
"Workout-Analyse": """
**NP** = „physiologischer“ Durchschnitt (gewichtet Spitzen stärker), **IF** = NP/FTP, **TSS** = Dauer × IF² × 100 (1 h bei FTP = 100), **VI** = NP/Ø-Watt (1,00 = gleichmäßig).
**Pw:HR-Entkopplung** vergleicht Watt-pro-Herzschlag der 1. und 2. Hälfte: < 5 % = stabile Ausdauer, > 8 % = Drift. Nur bei gleichmäßigen Fahrten ≥ 60 min aussagekräftig.
**Gute Einheit** heißt: sie hat ihr **Ziel** getroffen (Erholung locker, Grundlage ruhig, Intervalle sauber und ohne starken Abfall). Ob eine Einheit „gut“ war, hängt vom Ziel ab – stell es oben ein, wenn die automatische Erkennung falsch liegt.
**Verbesserung** erkennst Du an neuen Bestwerten oder höherer Effizienz (EF) bei gleicher Intensität.
**W'-Bilanz:** zeigt, wie viel der anaeroben Reserve (FRC) übrig ist; Richtung 0 = Du warst am Limit.
**Quadranten:** Q1 viel Kraft+schnell (Sprint/Anstieg hart), Q2 viel Kraft+langsam (Kraftausdauer), Q3 locker, Q4 leicht+schnell (hohe Frequenz).""",
"Lauf": """
**NGP** ist die steigungskorrigierte, variabilitätsgewichtete Pace (Äquivalent zu NP). **rIF** = NGP/Schwellentempo, **rTSS** = Stunden × rIF² × 100.
Easy-Läufe liegen bei rIF ≈ 0,75–0,85, Schwelle ≈ 0,95–1,0. **Efficiency Factor** (m/min je Herzschlag): steigt er bei gleicher Intensität, verbessert sich Deine aerobe Basis.
**Critical Speed** ist ungefähr das Tempo, das Du sehr lange (~30–60 min) halten kannst; **D′** die Strecke, die Du darüber laufen kannst.""",
"Power-Duration-Kurve": """
Die Kurve zeigt Deine **beste Durchschnittsleistung für jede Dauer** im Zeitraum. Das Modell (gestrichelt) beschreibt sie mit **mFTP** (aerobe Dauerleistung), **FRC** (anaerobe Arbeitskapazität in kJ) und **Pmax** (Maximalleistung).
Liegt die Kurve höher als im Vergleichszeitraum, hast Du Dich verbessert – aber nur dort, wo Du wirklich maximal gefahren bist. Fehlt ein Bereich, ist die Kurve dort kein Maß für Deine Leistungsfähigkeit.""",
"Performance Management (PMC)": """
**Blau = CTL (Fitness)**, **rot = ATL (Ermüdung)**, **gelb = TSB (Form)**. Aufbau: CTL steigt, TSB meist negativ. Wettkampf: ATL durch Tapering senken → TSB +5…+25.
TSB-Zonen (Richtwerte): > +25 Detraining, +5…+25 frisch, −10…+5 neutral, −30…−10 produktiv, < −30 Überlastungsrisiko. Rampe > 8 CTL/Woche gilt als aggressiv.""",
"Zeit in Zonen": """
Zeigt, wie sich Deine Trainingszeit auf Intensitätszonen (% FTP) verteilt. Viele Ausdauersportler fahren am besten mit ca. 75–80 % locker (Z1–2) und dem Rest hart (Z5+), wenig im Mittelbereich (Z3–4, „Grauzone“).
Zeit in Zone sagt nichts über die Qualität der Intervalle – dafür die Workout-Analyse.""",
"Profil & Phänotyp": """
Vergleicht Deine Bestwerte (5 s, 1, 5, 20 min) in W/kg mit Referenzstufen von „Untrainiert“ bis „Weltklasse“. Das **Limiter**-Profil zeigt, wo der größte Hebel liegt.
Referenzen und Phänotyp-Regeln sind Näherungen. Aussagekräftig nur, wenn im Zeitraum auch maximal gefahren wurde.""",
"Fatigue Resistance": """
Wie viel Deiner frischen Bestleistung bleibt nach 1000/2000/3000 kJ Vorarbeit? Hohe Werte (≥ 90 %) bedeuten, dass Du auch spät im Rennen noch Leistung bringst. Training: lange Einheiten mit harten Efforts am Ende.""",
"Fortschritt": """
Jeder Punkt ist ein Modell über das davorliegende Fenster (z. B. 90 Tage). Änderungen unter ±3 % liegen im Schwankungsbereich. Ein Rückgang kann nur heißen, dass im Fenster keine Maximaltests/Rennen waren.""",
"Wettkämpfe": """
Trag Wettkämpfe mit Priorität ein: **A** = Hauptziel (Tapering, Form +5…+25), **B** = wichtig (kurze Entlastung), **C** = Training/Test.
Die PMC-Prognose zeigt Fitness (CTL) und Form (TSB) am Renntag – abhängig von Deinem Plan und der geschätzten Wettkampf-TSS (Dauer × IF² × 100). Die Dashboard-Empfehlung berücksichtigt Tapering, Aktivierung und Erholung nach dem Rennen.""",
"Planung": """
Der Plan wird in die PMC projiziert. Prüfe: Rampe ≤ 5–8 CTL/Woche, alle 3–4 Wochen eine Entlastungswoche, Form (TSB) am Zieltag +5…+25 bei Wettkämpfen.""",
"Athlet & Daten": """
Gute Analyse braucht gute Eingangsdaten: aktuelle FTP (alle 6–12 Wochen prüfen), Gewicht, bei Läufen Schwellenpace und Lauf-LTHR. Nach Änderungen „Neu berechnen“ klicken, damit alte Einheiten mit den Werten ihrer Zeit bewertet werden.""",
}
