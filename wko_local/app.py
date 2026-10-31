"""WKO-ähnliche Analyse-Oberfläche. Start: streamlit run app.py (oder Mac-App / start.command)."""
from __future__ import annotations

import os
import subprocess
import sys
from datetime import date, datetime, timedelta
from pathlib import Path

import numpy as np
import pandas as pd
import plotly.graph_objects as go
import streamlit as st

import json

from wkolocal import config, db, evidence, ingest, insights, metrics, model, pmc, profile, recommend, runplan, strength, ui, wellness

st.set_page_config(page_title="WKO Lokal", page_icon=":material/monitoring:", layout="wide", initial_sidebar_state="expanded")
ui.apply_theme()
ROOT = Path(__file__).parent
DISCLAIMER = "Automatische Einordnung nach Faustregeln und Studienlage – ersetzt keine Trainingsberatung; individuell kann es abweichen."


# =============================================================== Daten-Cache
# Alles Teure wird zwischengespeichert. Schlüssel ist der Änderungsstand der Datenbank: jede Änderung
# (Import, Schwellenwert, Plan …) erzeugt automatisch neue Ergebnisse, ohne manuelles Leeren.
def ver() -> int:
    try:
        return os.stat(config.DB_PATH).st_mtime_ns
    except FileNotFoundError:
        return 0


TODAY = date.today()


@st.cache_data(show_spinner=False, max_entries=96)
def _workouts(start, end, sport, v):
    return db.workouts_df(start, end, sport)


def W(start=None, end=None, sport=None) -> pd.DataFrame:
    return _workouts(None if start is None else str(start), None if end is None else str(end), sport, ver())


@st.cache_data(show_spinner=False, max_entries=24)
def stream(uid: str) -> pd.DataFrame:
    return db.load_stream(uid)


@st.cache_data(show_spinner=False, max_entries=8)
def _small(kind: str, v):
    return {"thr": db.thresholds_df, "races": db.races_df, "planned": db.planned_df, "settings": db.get_settings,
            "strength": db.strength_log_df}[kind]()


def thresholds(): return _small("thr", ver())
def races(): return _small("races", ver())
def planned(): return _small("planned", ver())
def settings(): return _small("settings", ver())
def strength_log(): return _small("strength", ver())


def thr_on(day, field, default=None):
    df = thresholds().dropna(subset=[field])
    if df.empty:
        return default
    past = df[df["date"] <= str(day)]
    return float((past.iloc[-1] if len(past) else df.iloc[0])[field])


def cur_ftp(): return thr_on(TODAY, "ftp", 200.0)
def cur_weight(): return thr_on(TODAY, "weight", 70.0)
def run_threshold_pace(): return thr_on(TODAY, "run_pace", None)


@st.cache_data(show_spinner=False, max_entries=8)
def _wellness(start, end, v):
    return db.wellness_df(start, end)


def wellness_df(start, end): return _wellness(str(start), str(end), ver())


@st.cache_data(show_spinner=False, max_entries=8)
def _daily_tss(sport, v):
    w = db.workouts_df(sport=sport)
    return w.groupby("date")["tss"].sum() if len(w) else pd.Series(dtype=float)


def daily_tss(sport="Alle"): return _daily_tss(sport, ver())


@st.cache_data(show_spinner=False, max_entries=8)
def _pmc_adj(today, v):
    s = settings()
    a = daily_tss()
    if a.empty:
        d = pmc.pmc(a)
        return d.assign(readiness_pts=0, tsb_adj=d.get("tsb"))
    a = a.copy(); a.index = pd.to_datetime(a.index)
    t = pd.Timestamp(today)
    if a.index.max() < t:
        a.loc[t] = 0.0
    d = pmc.pmc(a, float(s["ctl_tau"]), float(s["atl_tau"]))
    return wellness.adjusted_form(d, db.wellness_df(str(TODAY - timedelta(days=200)), str(TODAY)))


def full_pmc() -> pd.DataFrame: return _pmc_adj(str(TODAY), ver())


def planned_load() -> pd.Series:
    pl = planned()
    ser = pl.groupby("date").tss.sum() if len(pl) else pd.Series(dtype=float)
    for r in races().itertuples():
        if r.tss and pd.notna(r.tss) and r.date not in ser.index:
            ser.loc[r.date] = float(r.tss)
    return ser


@st.cache_data(show_spinner=False, max_entries=8)
def _forecast(today, v):
    ser, rc = planned_load(), races()
    future = [d for d in list(ser.index) + list(rc.date) if d > today]
    if not future:
        return None
    s = settings()
    return pmc.forecast(daily_tss(), ser, max(future), ctl_tau=float(s["ctl_tau"]), atl_tau=float(s["atl_tau"]))


def forecast_all(): return _forecast(str(TODAY), ver())


def agg_mmp(df: pd.DataFrame, key="mmp") -> dict[int, float]:
    out: dict[int, float] = {}
    for m in df[key]:
        for k, v in m.items():
            out[int(k)] = max(out.get(int(k), 0), v)
    return out


@st.cache_data(show_spinner=False, max_entries=48)
def _mmp_model(start, end, sport, v):
    mm = agg_mmp(db.workouts_df(start, end, sport))
    return mm, model.fit_pd(mm)


def mmp_model(start, end, sport): return _mmp_model(str(start), str(end), sport, ver())


@st.cache_data(show_spinner=False, max_entries=16)
def _zones(start, end, sport, ftp, v):
    tot = np.zeros(7); rows = []
    for w in db.workouts_df(start, end, sport).itertuples():
        if w.tss_method != "power":
            continue
        z = metrics.time_in_zones(db.load_stream(w.uid).power.to_numpy(), w.ftp_used or ftp)["Sekunden"].to_numpy()
        tot += z
        rows.append(dict(Woche=pd.Timestamp(w.date).to_period("W").start_time, **{f"Z{i + 1}": z[i] / 3600 for i in range(7)}))
    return tot, pd.DataFrame(rows)


@st.cache_data(show_spinner=False, max_entries=8)
def _progress(sport, win, v):
    all_w = db.workouts_df(sport=sport)
    if all_w.empty:
        return pd.DataFrame()
    dates = pd.to_datetime(all_w.date)
    pts, d = [], dates.min() + timedelta(days=win)
    while d <= pd.Timestamp(TODAY):
        sub = all_w[(dates > d - timedelta(days=win)) & (dates <= d)]
        mm = agg_mmp(sub)
        m = model.fit_pd(mm)
        row = dict(Datum=d, **{f"{k}s": mm.get(k) for k in (5, 60, 300, 1200, 3600)})
        ok = m is not None and 2100 < m.frc < 79000 and m.rmse / max(m.mftp, 1) <= .15 and mm.get(1200, 0) > 0
        if ok:                      # FRC an der Modellgrenze oder großer Fehler = Anpassung gescheitert -> nicht anzeigen
            row.update(mFTP=m.mftp, FRC=m.frc / 1000, Pmax=m.pmax)
        row["model_ok"] = ok
        pts.append(row); d += timedelta(days=7)
    return pd.DataFrame(pts)


@st.cache_data(show_spinner=False, max_entries=8)
def _readiness(today, v):
    w = db.wellness_df(str(TODAY - timedelta(days=40)), today)
    return wellness.readiness(w, TODAY) if len(w) else None


def readiness(): return _readiness(str(TODAY), ver())


@st.cache_data(show_spinner=False, max_entries=32)
def _recommendation(today, feeling, sport, v):
    s = settings()
    recent = db.workouts_df(str(TODAY - timedelta(days=28)), today)
    runs = db.workouts_df(str(TODAY - timedelta(days=45)), today, "Running")
    cap = runplan.next_long_run_cap(runs, TODAY + timedelta(days=1))
    return recommend.recommend(TODAY, daily_tss(), recent, races(), planned(), cur_ftp(), run_threshold_pace(),
                               feeling, float(s["ctl_tau"]), float(s["atl_tau"]), readiness(), sport, cap)


def strength_for(r) -> strength.StrengthRec:
    days = strength.strength_dates(W(TODAY - timedelta(days=21), TODAY), strength_log())
    feeling = st.session_state.get("feeling", "Normal")
    ready = readiness()
    if ready and ready.get("state") == "low" and feeling in ("Gut", "Normal"):
        feeling = "Müde"            # Schlaf/HRV/Ruhepuls deutlich eingeschränkt: keine schwere Kraft
    return strength.recommend_strength(r.day, r.kind, days, r.next_day_key, r.days_to_race, r.race_priority,
                                       settings().get("strength_experience", "Einsteiger"), feeling)


def strength_card(sr: strength.StrengthRec) -> None:
    if not sr.available:
        show([insights.Insight("info", f"Kraft: {sr.title}"), *[insights.Insight("info", x) for x in sr.reasons]])
        if sr.blocks:
            with st.expander("Stattdessen: kurze Mobilität (10–15 min)", icon=":material/self_improvement:"):
                st.dataframe(pd.DataFrame(sr.blocks), hide_index=True, width="stretch")
        return
    chips = ["🏋️ Kraft"] + ([f"⏱ {sr.duration_min[0]}–{sr.duration_min[1]} min"] if sr.duration_min else [])
    ui.hero("Ergänzung zur Laufeinheit", sr.title, chips, [f"Wann: {sr.timing}"], "good", accent=ui.c(3))
    lines = []
    for blk in dict.fromkeys(b["Block"] for b in sr.blocks):
        lines.append(f"**{blk}**")
        lines += [f"- {b['Übung']}: **{b['Umfang']}** · {b['Intensität']}" + (f" · Pause {b['Pause']}" if b["Pause"] != "–" else "")
                  for b in sr.blocks if b["Block"] == blk]
    st.markdown("\n".join(lines))
    st.caption(" · ".join(sr.notes))
    a, b, c3 = st.columns(3)
    with a.popover("Warum so?", icon=":material/psychology:", width="stretch"):
        st.markdown("\n".join(f"- {x}" for x in sr.reasons))
        st.markdown(insights.EXPLAIN["Kraft"])
    ids = sorted(set(__import__("re").findall(r"Q\d+", " ".join(sr.reasons))), key=lambda s: int(s[1:]))
    with b.popover(f"Quellen ({len(ids)})", icon=":material/menu_book:", width="stretch", disabled=not ids):
        for qid in ids:
            e = evidence.by_id(qid)
            st.markdown(f"**{qid} · {e['level']}** – {e['title']}" + (f"  \n{e['url']}" if e["url"] else "") + f"  \n_Grenzen:_ {e['caveat']}")
    if c3.button("Heute Kraft gemacht", icon=":material/check_circle:", width="stretch",
                 help="Erfasst eine Krafteinheit für heute (Garmin-Krafteinheiten werden automatisch erkannt)."):
        db.add_strength(str(TODAY), sr.title, sr.duration_min[1] if sr.duration_min else 40)
        st.toast("Krafteinheit eingetragen"); st.rerun()


# =============================================================== Helfer
def fmt_pace(sec_per_km) -> str:
    if not sec_per_km or not np.isfinite(sec_per_km):
        return "–"
    m, sec = divmod(int(round(sec_per_km)), 60)
    return f"{m}:{sec:02d}"


def pace_of(speed_ms) -> float:
    return 1000 / speed_ms if speed_ms and speed_ms > 0 else float("nan")


def parse_pace(txt: str):
    try:
        m, sec = txt.strip().split(":")
        return int(m) * 60 + int(sec)
    except ValueError:
        return None


def fmt_dur(sec) -> str:
    sec = int(sec or 0)
    return f"{sec // 3600}:{sec % 3600 // 60:02d} h"


def pace_axis(fig, sec_values, row=None, title="min/km (oben = schneller)") -> None:
    """Pace-Achse in Sekunden/km mit Beschriftung m:ss (schneller oben)."""
    v = np.asarray([x for x in sec_values if x is not None and np.isfinite(x)], float)
    if not len(v):
        return
    lo, hi = float(v.min()), float(v.max())
    span = max(hi - lo, 10)
    step = next(s for s in (5, 10, 15, 20, 30, 60, 120) if span / s <= 6)
    ticks = np.arange(np.floor(lo / step) * step, np.ceil(hi / step) * step + step, step)
    kw = dict(row=row, col=1) if row else {}
    fig.update_yaxes(tickvals=ticks, ticktext=[fmt_pace(t) for t in ticks], autorange="reversed", title_text=title, **kw)


def show(items, foot: bool = False) -> None:
    ui.insight_block(items, DISCLAIMER if foot else None)


def explain(key: str) -> None:
    with st.expander("Wie lese ich diese Ansicht?", icon=":material/help:"):
        st.markdown(insights.EXPLAIN[key])


def mmp_fig(curves: dict[str, dict], mdl=None, weight=None, height=420) -> go.Figure:
    fig = go.Figure()
    for i, (name, cv) in enumerate(curves.items()):
        t = sorted(cv)
        fig.add_scatter(x=t, y=[cv[x] / (weight or 1) for x in t], name=name, mode="lines", line=dict(color=ui.c(i + 1), width=2),
                        hovertemplate="%{y:.0f}" + (" W/kg" if weight else " W") + "<extra>" + name + "</extra>")
    if mdl:
        t = np.logspace(0.5, np.log10(7200), 200)
        fig.add_scatter(x=t, y=mdl.power(t) / (weight or 1), name="Modell", line=dict(dash="dash", color=ui.text2(), width=1.5),
                        hovertemplate="%{y:.0f}<extra>Modell</extra>")
    ticks = [1, 5, 15, 60, 300, 1200, 3600, 7200]
    fig.update_xaxes(type="log", tickvals=ticks, ticktext=["1s", "5s", "15s", "1m", "5m", "20m", "1h", "2h"])
    fig.update_yaxes(title="W/kg" if weight else "Watt")
    return ui.style(fig, height)


def kpi(col, label, value, delta=None, spark=None, help=None, delta_color="normal", chart_type="area", height=None):
    """Kennzahl-Kachel; mit Mini-Verlauf, wenn spark gegeben. height (px) vereinheitlicht Kachelreihen."""
    with col:
        st.metric(label, value, delta, help=help, border=True, chart_data=list(spark) if spark is not None and len(spark) > 1 else None,
                  chart_type=chart_type, delta_color=delta_color, height=height or "content")


# =============================================================== Seiten
def page_dashboard():
    wk, rng = WK, RNG
    hour = datetime.now().hour
    greet = "Guten Morgen" if hour < 11 else "Guten Tag" if hour < 18 else "Guten Abend"
    ui.page_header(greet, f"{['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'][TODAY.weekday()]}, {TODAY:%d.%m.%Y}")
    d = full_pmc()
    last = d.iloc[-1]

    left, right = st.columns([1.75, 1], gap="large")
    with left:
        feeling = st.segmented_control("Wie fühlst Du Dich heute?", recommend.FEELINGS, default="Normal", required=True, key="feeling",
                                       help="Schlaf, HRV und Ruhepuls fließen automatisch ein, wenn Garmin-Daten vorliegen; Krankheit oder Stress kennt das Programm nicht.")
        auto = _recommendation(str(TODAY), feeling, None, ver())
        r = auto
        if auto.kind not in ("Ruhetag", "Wettkampf"):
            star = {"Cycling": "Rad", "Running": "Lauf"}
            pick = st.segmented_control("Einheit wählen", ["Cycling", "Running"], default=auto.auto_sport if auto.auto_sport in star else "Cycling",
                                        required=True, key=f"pick_{auto.auto_sport}",
                                        format_func=lambda s: ("🚴 " if s == "Cycling" else "🏃 ") + star[s] + (" · empfohlen" if s == auto.auto_sport else ""),
                                        help="Die Empfehlung passt Einheit und Intensität an die gewählte Sportart an.")
            if pick != auto.auto_sport:
                r = _recommendation(str(TODAY), feeling, pick, ver())
        chips = []
        if r.sport != "–": chips.append(("🚴 " if r.sport == "Cycling" else "🏃 ") + ui.sport_label(r.sport))
        if r.duration_min: chips.append(f"⏱ {r.duration_min[0]}–{r.duration_min[1]} min")
        if r.tss and r.tss[1]: chips.append(f"TSS {r.tss[0]}–{r.tss[1]}")
        ui.hero(f"Empfehlung für {r.headline.split('(')[1].split(')')[0] if '(' in r.headline else 'morgen'}", r.kind, chips, r.details,
                "warn" if r.level == "warn" else "good")
        if r.plan_note:
            show([insights.Insight(r.plan_note[0], r.plan_note[1])])
        a, b = st.columns(2)
        with a.popover("Warum diese Empfehlung?", icon=":material/psychology:", width="stretch"):
            st.markdown("\n".join(f"- {x}" for x in r.reasons))
            st.caption("Regelbasiert aus Form, harten Einheiten, Wettkämpfen, Plan, Befinden und – falls vorhanden – Schlaf/HRV. Keine medizinische Beratung.")
        cited = recommend.cited_ids(r)
        with b.popover(f"Quellen ({len(cited)})", icon=":material/menu_book:", width="stretch", disabled=not cited):
            for qid in cited:
                e = evidence.by_id(qid)
                st.markdown(f"**{qid} · {e['level']}** – {e['title']}" + (f"  \n{e['url']}" if e["url"] else "") + f"  \n_Grenzen:_ {e['caveat']}")
        if r.sport == "Running" and r.kind not in ("Wettkampf",):
            if st.toggle("Krafteinheit dazu planen", value=True, key="with_strength"):
                strength_card(strength_for(r))
    with right:
        tsb30 = d.tsb.iloc[-30:]
        has_adj = bool(d.readiness_pts.iloc[-3:].any())
        kpi(st.container(), "Form heute (TSB)", f"{last.tsb:+.0f}", None, tsb30,
            help="CTL − ATL am Morgen: > +5 frisch, −10…−30 produktiver Block, < −30 Überlastungsrisiko.")
        if has_adj:
            kpi(st.container(), "Form inkl. Erholung", f"{last.tsb_adj:+.0f}", f"{last.tsb_adj - last.tsb:+.0f} durch Schlaf/HRV/Ruhepuls",
                d.tsb_adj.iloc[-30:], delta_color="off")
        ready = readiness()
        if ready and ready["state"] != "unknown":
            show(ready["items"][:1])
        elif ready is None:
            st.caption("Keine Schlaf-/HRV-Daten – Garmin-Sync mit „HRV & Schlaf“ ausführen.")
        rc = races()
        up = rc[rc.date >= str(TODAY)].head(1) if len(rc) else rc
        if len(up):
            nr = up.iloc[0]
            days = (date.fromisoformat(nr.date) - TODAY).days
            fc = forecast_all()
            tsb_r = f" · Form am Renntag {fc.loc[pd.Timestamp(nr.date)].tsb:+.0f}" if fc is not None and pd.Timestamp(nr.date) in fc.index else ""
            st.markdown(f"**🏁 Nächster Wettkampf:** {ui.esc(nr['name'])} ({nr.priority}) in **{days} Tagen**{tsb_r}")

    st.markdown("#### Überblick")
    c = st.columns(3) + st.columns(3)
    week = d.iloc[-7:]
    wh = W(TODAY - timedelta(days=84), TODAY, rng[2])
    weekly = wh.assign(W=pd.to_datetime(wh.date).dt.to_period("W").dt.start_time).groupby("W").agg(h=("duration_s", "sum"), t=("tss", "sum"))
    kpi(c[0], "Fitness (CTL)", f"{last.ctl:.0f}", f"{last.ramp:+.1f}/Woche" if pd.notna(last.ramp) else None, d.ctl.iloc[-60:], height=178)
    kpi(c[1], "Ermüdung (ATL)", f"{last.atl:.0f}", None, d.atl.iloc[-60:], height=178)
    kpi(c[2], "TSS 7 Tage", f"{week.tss.sum():.0f}", None, weekly.t, chart_type="bar", height=178)
    kpi(c[3], "Stunden 7 Tage", f"{wh[wh.date > str(TODAY - timedelta(days=7))].duration_s.sum() / 3600:.1f}", None, weekly.h / 3600, chart_type="bar", height=178)
    mm, m = mmp_model(rng[0], rng[1], rng[2])
    kpi(c[4], "mFTP (Modell)", f"{m.mftp:.0f} W" if m else "–", f"{m.mftp / cur_weight():.2f} W/kg" if m else None, delta_color="off", height=178)
    kpi(c[5], "Einheiten im Zeitraum", f"{len(wk)}", f"{wk.duration_s.sum() / 3600:.0f} h", delta_color="off", height=178)

    a, b = st.columns(2, gap="large")
    with a:
        recent = W(TODAY - timedelta(days=28), TODAY, rng[2])
        prev = W(TODAY - timedelta(days=56), TODAY - timedelta(days=29), rng[2])
        show(insights.assess_dashboard(recent, prev, d), foot=True)
    with b:
        fc = forecast_all()
        if fc is not None and len(races()):
            show(insights.assess_races(fc, races(), TODAY))
        else:
            explain("Dashboard")

    a, b = st.columns([1.4, 1], gap="large")
    with a:
        dd = d.loc[str(TODAY - timedelta(days=120)):]
        f = go.Figure()
        f.add_scatter(x=dd.index, y=dd.tsb, name="Form (TSB)", fill="tozeroy", line=dict(color=ui.c(3), width=1.5), fillcolor=ui.NEUTRAL_FILL[ui.mode()])
        f.add_scatter(x=dd.index, y=dd.ctl, name="Fitness (CTL)", line=dict(color=ui.c(1), width=2.5))
        f.add_scatter(x=dd.index, y=dd.atl, name="Ermüdung (ATL)", line=dict(color=ui.c(2), width=1.5))
        ui.chart(ui.style(f, 340, title="Fitness, Ermüdung & Form – 4 Monate"))
    with b:
        g = go.Figure()
        wk2 = W(TODAY - timedelta(days=84), TODAY)
        if len(wk2):
            wk2 = wk2.assign(Woche=pd.to_datetime(wk2.date).dt.to_period("W").dt.start_time)
            for s in sorted(wk2.sport.unique(), key=lambda x: ui.SPORT_SLOT.get(x, 9)):
                ws = wk2[wk2.sport == s].groupby("Woche").tss.sum()
                g.add_bar(x=ws.index, y=ws.values, name=ui.sport_label(s), marker_color=ui.sport_color(s),
                          hovertemplate="%{y:.0f} TSS<extra>" + ui.sport_label(s) + "</extra>")
        g.update_layout(barmode="stack")
        ui.chart(ui.style(g, 340, title="Wochenlast nach Sportart (12 Wochen)"))

    st.markdown("#### Letzte Einheiten")
    st.caption("Auf einen Balken klicken öffnet die Workout-Analyse.")
    lw = W(TODAY - timedelta(days=42), TODAY, rng[2])
    if len(lw):
        h = go.Figure()
        for s in sorted(lw.sport.unique(), key=lambda x: ui.SPORT_SLOT.get(x, 9)):
            x = lw[lw.sport == s]
            h.add_bar(x=pd.to_datetime(x.start_time), y=x.tss, name=ui.sport_label(s), marker_color=ui.sport_color(s), customdata=x.uid,
                      text=x["name"], textposition="none", hovertemplate="<b>%{text}</b><br>%{x|%a %d.%m.} · %{y:.0f} TSS<extra></extra>", width=86400000 * .7)
        h.update_layout(barmode="overlay", clickmode="event+select")
        ev = ui.chart(ui.style(h, 260, hover="closest"), key="recent_click", on_select="rerun")
        try:
            pts = ev.selection.points if ev else []
        except AttributeError:
            pts = []
        if pts:
            st.session_state["wk_uid"] = pts[0]["customdata"]
            st.switch_page(PAGE["workout"])
    st.markdown("#### Leistungskurve im Zeitraum")
    ui.chart(mmp_fig({"Bestwerte": mm}, m, None, 360))


def ride_series_fig(df: pd.DataFrame, ftp: float, smooth: int) -> go.Figure:
    t = df.index / 60
    rows = [("Leistung (W)", "power")] if (df.power > 0).any() else []
    if df.hr.notna().any(): rows.append(("Herzfrequenz (bpm)", "hr"))
    if df.altitude.notna().any(): rows.append(("Höhe (m)", "altitude"))
    heights = {1: [1], 2: [.62, .38], 3: [.5, .3, .2]}[max(len(rows), 1)]
    f = ui.stacked(max(len(rows), 1), heights)
    for i, (lbl, col) in enumerate(rows, start=1):
        y = df[col].rolling(smooth, min_periods=1).mean() if col != "altitude" else df[col]
        color = {"power": ui.c(1), "hr": ui.c(2), "altitude": ui.text2()}[col]
        f.add_scatter(x=t, y=y, name=lbl, line=dict(color=color, width=1.3), fill="tozeroy" if col == "altitude" else None,
                      fillcolor=ui.NEUTRAL_FILL[ui.mode()] if col == "altitude" else None, row=i, col=1,
                      hovertemplate="%{y:.0f}<extra>" + lbl + "</extra>")
        f.update_yaxes(title_text=lbl, row=i, col=1, title_font=dict(size=11))
        if col == "power":
            f.add_hline(y=ftp, line_dash="dot", line_color=ui.text2(), annotation_text=f"FTP {ftp:.0f}", annotation_font_size=11, row=i, col=1)
    f.update_xaxes(title_text="min", row=max(len(rows), 1), col=1)
    return ui.style(f, 470, legend=False)


def zones_bar(z: pd.DataFrame, title: str) -> go.Figure:
    f = go.Figure(go.Bar(x=z["Sekunden"] / 60, y=z["Zone"], orientation="h", marker_color=ui.BLUE_RAMP[:len(z)],
                         text=[f"{p:.0f} %" for p in z["Anteil %"]], textposition="outside",
                         hovertemplate="%{y}: %{x:.0f} min<extra></extra>"))
    f.update_yaxes(autorange="reversed"); f.update_xaxes(title="Minuten", range=[0, max(max(f.data[0].x), 1e-9) * 1.22])
    return ui.style(f, 300, legend=False, hover="closest", title=title)


def page_workout():
    wk = WK.sort_values("start_time", ascending=False)
    ui.page_header("Workout-Analyse")
    labels = {r.uid: f"{r.start_time[:16]} · {r.name} · {r.duration_s / 60:.0f} min · {r.tss:.0f} TSS" for r in wk.itertuples()}
    sel = st.session_state.pop("wk_uid", None)
    opts = list(labels)
    if sel and sel not in labels:
        one = W().query("uid == @sel")
        if len(one):
            wk = pd.concat([one, wk]); labels = {sel: f"{one.start_time.iloc[0][:16]} · {one.name.iloc[0]}", **labels}; opts = list(labels)
    uid = st.selectbox("Einheit", opts, index=opts.index(sel) if sel in opts else 0, format_func=labels.get)
    w = wk[wk.uid == uid].iloc[0]
    df = stream(uid)
    if w.sport == "Running":
        return run_view(w, df)
    ftp = w.ftp_used or cur_ftp()
    ui.stats([("Dauer", fmt_dur(w.duration_s)), ("Ø Leistung", f"{w.avg_power:.0f} W" if w.avg_power else "–"),
              ("NP", f"{w.np:.0f} W" if w.np else "–"), ("IF", f"{w.if_:.2f}" if w.if_ else "–"),
              ("TSS", f"{w.tss:.0f}"), ("VI", f"{w.vi:.2f}" if w.vi else "–"),
              ("Arbeit", f"{w.work_kj:.0f} kJ" if w.work_kj else "–"), ("Ø HF", f"{w.avg_hr:.0f}" if pd.notna(w.avg_hr) else "–"),
              ("Pw:HR", f"{w.decoupling:.1f} %" if pd.notna(w.decoupling) else "–")])
    if w.tss_method == "power":
        intent = st.pills("Ziel der Einheit", ["Automatisch", *insights.RIDE_TYPES], default="Automatisch", required=True,
                          help="Bewertet wird gegen das Ziel. 'Automatisch' erkennt den Typ aus Intensität und Intervallen.")
        a, b = st.columns([1.2, 1], gap="large")
        with a:
            show(insights.assess_ride(w, df, ftp, intent))
        with b:
            st.markdown("**Vergleich mit den 90 Tagen davor**")
            show(insights.compare_to_history(w, W(date.fromisoformat(w.date) - timedelta(days=90), w.date, w.sport)))
    smooth = st.select_slider("Glättung", [1, 3, 5, 10, 20, 30, 60], value=10, format_func=lambda s: f"{s} s")
    ui.chart(ride_series_fig(df, ftp, smooth))
    if not (df.power > 0).any():
        st.info("Keine Leistungsdaten – nur HR-basierte Werte verfügbar."); return
    tabs = st.tabs([":material/view_timeline: Intervalle", ":material/stacked_bar_chart: Zonen", ":material/scatter_plot: Quadranten",
                    ":material/battery_5_bar: W'-Bilanz", ":material/show_chart: Mean-Max"])
    with tabs[0]:
        a, b = st.columns(2)
        thr = a.slider("Schwelle (% FTP)", 60, 150, 90) / 100 * ftp
        mn = b.slider("Mindestdauer (s)", 15, 600, 60)
        iv = metrics.detect_intervals(df.power.to_numpy(), thr, min_s=mn)
        if len(iv):
            iv["Ø % FTP"] = (iv["Ø_W"] / ftp * 100).round()
            iv["Start"] = iv["Start"].map(lambda s: f"{s // 60}:{s % 60:02d}")
            iv["Dauer_s"] = iv["Dauer_s"].map(lambda s: f"{s // 60}:{s % 60:02d}")
            iv = iv.rename(columns={"Dauer_s": "Dauer", "Ø_W": "Ø W", "Max_W": "Max W"})
            st.dataframe(iv.round(0), width="stretch", hide_index=True,
                         column_config={"Ø % FTP": st.column_config.ProgressColumn("Ø % FTP", min_value=0, max_value=150, format="%d %%")})
        else:
            st.info("Keine Intervalle über der Schwelle.")
    with tabs[1]:
        a, b = st.columns(2, gap="large")
        a.plotly_chart(zones_bar(metrics.time_in_zones(df.power.to_numpy(), ftp), f"Leistungszonen · FTP {ftp:.0f} W"), width="stretch", config=ui.PLOT_CONFIG)
        lthr = thr_on(w.date, "lthr", None)
        if lthr and df.hr.notna().any():
            b.plotly_chart(zones_bar(metrics.time_in_zones(df.hr.to_numpy(), lthr, metrics.HR_ZONES), f"Herzfrequenzzonen · LTHR {lthr:.0f}"), width="stretch", config=ui.PLOT_CONFIG)
        else:
            b.info("Für HR-Zonen eine LTHR unter „Athlet & Daten“ eintragen.")
    with tabs[2]:
        q = metrics.quadrant_analysis(df.power.to_numpy(), df.cadence.to_numpy(), ftp, float(settings()["crank_mm"]))
        if len(q["aepf"]):
            idx = np.random.default_rng(0).choice(len(q["aepf"]), min(4000, len(q["aepf"])), replace=False)
            f = go.Figure(go.Scattergl(x=q["cpv"][idx], y=q["aepf"][idx], mode="markers", marker=dict(size=4, color=ui.c(1), opacity=.35),
                                       hovertemplate="CPV %{x:.2f} m/s · AEPF %{y:.0f} N<extra></extra>"))
            f.add_vline(x=q["cpv_ref"], line_color=ui.text2(), line_dash="dot"); f.add_hline(y=q["aepf_ref"], line_color=ui.text2(), line_dash="dot")
            f.update_xaxes(title="Pedalgeschwindigkeit CPV (m/s)"); f.update_yaxes(title="Pedalkraft AEPF (N)")
            a, b = st.columns([2, 1], gap="large")
            a.plotly_chart(ui.style(f, 380, legend=False, hover="closest"), width="stretch", config=ui.PLOT_CONFIG)
            for k, lbl in (("QI", "QI · viel Kraft, schnell"), ("QII", "QII · viel Kraft, langsam"), ("QIII", "QIII · wenig Kraft, langsam"), ("QIV", "QIV · wenig Kraft, schnell")):
                b.progress(min(q["share"][k] / 100, 1.0), text=f"{lbl}: {q['share'][k]:.0f} %")
            b.caption("Referenz: FTP bei 90 U/min.")
        else:
            st.info("Keine Kadenzdaten.")
    with tabs[3]:
        _, mdl = mmp_model(date.fromisoformat(w.date) - timedelta(days=90), w.date, None)
        a, b = st.columns(2)
        cp = a.number_input("CP / mFTP (W)", 50.0, 600.0, float(round(mdl.mftp)) if mdl else float(ftp), 5.0)
        wp = b.number_input("W' / FRC (J)", 2000.0, 60000.0, float(round(mdl.frc, -2)) if mdl else 20000.0, 500.0)
        wb = metrics.wbal(df.power.to_numpy(), cp, wp)
        f = go.Figure(go.Scatter(x=df.index / 60, y=wb / 1000, fill="tozeroy", line=dict(color=ui.c(1), width=1.5), fillcolor=ui.NEUTRAL_FILL[ui.mode()],
                                 hovertemplate="%{y:.1f} kJ<extra></extra>"))
        f.update_yaxes(title="kJ verbleibend", rangemode="tozero"); f.update_xaxes(title="min")
        ui.chart(ui.style(f, 300, legend=False))
        st.caption(f"Minimum {wb.min() / 1000:.1f} kJ – {(1 - wb.min() / wp) * 100:.0f} % von W' verbraucht (Integralmodell).")
    with tabs[4]:
        ui.chart(mmp_fig({"Diese Einheit": w.mmp, "Bestwerte 90 Tage": mmp_model(date.fromisoformat(w.date) - timedelta(days=90), w.date, w.sport)[0]}))
    explain("Workout-Analyse")


def run_view(w, df):
    sp = metrics.get_speed(df)
    rp = thr_on(w.date, "run_pace", None)
    ui.stats([("Dauer", fmt_dur(w.duration_s)), ("Distanz", f"{sp.sum() / 1000:.2f} km"),
                                  ("Ø Pace", f"{fmt_pace(pace_of(w.avg_speed))} /km" if w.avg_speed else "–"),
                                  ("NGP", f"{fmt_pace(pace_of(w.ngp))} /km" if w.ngp else "–"), ("rIF", f"{w.if_:.2f}" if pd.notna(w.if_) else "–"),
                                  (f"TSS ({w.tss_method})", f"{w.tss:.0f}"), ("Ø HR", f"{w.avg_hr:.0f}" if pd.notna(w.avg_hr) else "–"),
                                  ("Pace:HR", f"{w.decoupling:.1f} %" if pd.notna(w.decoupling) else "–")])
    a, b = st.columns([1.2, 1], gap="large")
    with a:
        show(insights.assess_run(w, df, rp))
    with b:
        if w.tss_method == "pace":
            st.markdown("**Vergleich mit den 90 Tagen davor**")
            show(insights.compare_to_history(w, W(date.fromisoformat(w.date) - timedelta(days=90), w.date, "Running")))
    smooth = st.select_slider("Glättung", [1, 5, 10, 15, 30, 60], value=15, format_func=lambda s: f"{s} s")
    t = df.index / 60
    sm = pd.Series(sp).rolling(smooth, min_periods=1).mean().to_numpy()
    pace = np.where(sm > 0.5, 1000 / np.maximum(sm, 0.5) / 60, np.nan)
    rows = [("Pace (min/km)", "pace")] + ([("Herzfrequenz", "hr")] if df.hr.notna().any() else []) + ([("Höhe (m)", "alt")] if df.altitude.notna().any() else [])
    f = ui.stacked(len(rows), {1: [1], 2: [.62, .38], 3: [.5, .3, .2]}[len(rows)])
    for i, (lbl, k) in enumerate(rows, start=1):
        if k == "pace":
            ps = np.clip(pace * 60, 150, 600)
            f.add_scatter(x=t, y=ps, name=lbl, line=dict(color=ui.c(2), width=1.3), row=i, col=1,
                          text=[fmt_pace(x) if np.isfinite(x) else "" for x in ps], hovertemplate="%{text} /km<extra></extra>")
            pace_axis(f, ps, row=i, title="min/km")
            f.update_yaxes(title_font=dict(size=11), row=i, col=1)
            if rp: f.add_hline(y=rp, line_dash="dot", line_color=ui.text2(), annotation_text=f"Schwelle {fmt_pace(rp)}", annotation_font_size=11, row=i, col=1)
        elif k == "hr":
            f.add_scatter(x=t, y=df.hr.rolling(smooth, min_periods=1).mean(), name=lbl, line=dict(color=ui.c(1), width=1.3), row=i, col=1,
                          hovertemplate="%{y:.0f} bpm<extra></extra>")
            f.update_yaxes(title_text="bpm", row=i, col=1, title_font=dict(size=11))
        else:
            f.add_scatter(x=t, y=df.altitude, name=lbl, fill="tozeroy", line=dict(color=ui.text2(), width=1), fillcolor=ui.NEUTRAL_FILL[ui.mode()], row=i, col=1,
                          hovertemplate="%{y:.0f} m<extra></extra>")
            f.update_yaxes(title_text="m", row=i, col=1, title_font=dict(size=11))
    f.update_xaxes(title_text="min", row=len(rows), col=1)
    ui.chart(ui.style(f, 470, legend=False))
    tabs = st.tabs([":material/flag: Splits", ":material/speed: Pace-Zonen", ":material/favorite: HR-Zonen", ":material/emoji_events: Bestzeiten"])
    with tabs[0]:
        spl = metrics.km_splits(sp, df.hr.to_numpy(float), df.altitude.to_numpy(float))
        if spl.empty:
            st.info("Weniger als 1 km.")
        else:
            spl["Pace"] = spl["Pace_s_km"].map(fmt_pace)
            avg = spl["Pace_s_km"].mean()
            g = go.Figure(go.Bar(x=spl.km, y=spl.Pace_s_km - avg, marker_color=[ui.c(1) if v <= 0 else ui.c(2) for v in spl.Pace_s_km - avg],
                                 text=spl.Pace, hovertemplate="km %{x}: %{text} /km<extra></extra>"))
            g.update_yaxes(title="s/km vs. Ø (negativ = schneller)"); g.update_xaxes(title="km", dtick=1)
            ui.chart(ui.style(g, 300, legend=False, hover="closest"))
            st.dataframe(spl.drop(columns=["Pace_s_km"]).round(0), hide_index=True, width="stretch")
    with tabs[1]:
        if rp:
            z = metrics.time_in_zones(sp, 1000 / rp, metrics.PACE_ZONES)
            st.plotly_chart(zones_bar(z, f"Pace-Zonen · Schwelle {fmt_pace(rp)} /km"), width="stretch", config=ui.PLOT_CONFIG)
            st.caption("Zonengrenzen als % der Schwellengeschwindigkeit (Näherung). Pausen zählen in Z1.")
        else:
            st.info("Schwellenpace fehlt (Athlet & Daten).")
    with tabs[2]:
        lthr = thr_on(w.date, "lthr_run", thr_on(w.date, "lthr", None))
        if lthr and df.hr.notna().any():
            st.plotly_chart(zones_bar(metrics.time_in_zones(df.hr.to_numpy(), lthr, metrics.HR_ZONES), f"HR-Zonen · LTHR {lthr:.0f}"), width="stretch", config=ui.PLOT_CONFIG)
        else:
            st.info("Lauf-LTHR oder HR-Daten fehlen.")
    with tabs[3]:
        rows = [(f"{d // 60} min" if d >= 60 else f"{d} s", fmt_pace(pace_of(w.smm.get(str(d)))), round(w.smm[str(d)] * d))
                for d in (60, 300, 600, 1200, 1800, 3600) if str(d) in w.smm]
        st.dataframe(pd.DataFrame(rows, columns=["Dauer", "Pace /km", "Distanz m"]), hide_index=True)
    explain("Lauf")


def page_run():
    rng = RNG
    ui.page_header("Laufen", "Pace-Duration-Kurve, Critical Speed und Entwicklung")
    rw = W(rng[0], rng[1], "Running")
    if rw.empty:
        st.info("Keine Läufe im gewählten Zeitraum."); return
    best = agg_mmp(rw, "smm")
    cs = model.fit_cs(best)
    show(insights.assess_run_page(cs, run_threshold_pace(), rw))
    c = st.columns(4)
    rp = run_threshold_pace()
    kpi(c[0], "Critical Speed", f"{fmt_pace(cs.cs_pace_s_km)} /km" if cs else "–", height=178)
    kpi(c[1], "D′", f"{cs.dprime:.0f} m" if cs else "–", height=178)
    kpi(c[2], "Schwellenpace (hinterlegt)", f"{fmt_pace(rp)} /km" if rp else "–", height=178)
    km_w = (rw.avg_speed.fillna(0) * rw.duration_s / 1000).groupby(pd.to_datetime(rw.date).dt.to_period("W").dt.start_time).sum()
    kpi(c[3], "km / Woche (Ø)", f"{km_w.mean():.0f}", None, km_w, chart_type="bar", height=178)
    fig = go.Figure()
    t = sorted(best)
    fig.add_scatter(x=t, y=[pace_of(best[x]) for x in t], name="Bestwerte", line=dict(color=ui.c(2), width=2),
                    text=[fmt_pace(pace_of(best[x])) for x in t], hovertemplate="%{text} /km<extra>Bestwert</extra>")
    if cs:
        tt = np.logspace(np.log10(60), np.log10(7200), 100)
        fig.add_scatter(x=tt, y=1000 / cs.speed(tt), name="CS-Modell", line=dict(dash="dash", color=ui.text2(), width=1.5),
                        text=[fmt_pace(1000 / cs.speed(x)) for x in tt], hovertemplate="%{text} /km<extra>Modell</extra>")
    fig.update_xaxes(type="log", tickvals=[60, 300, 600, 1200, 1800, 3600, 7200], ticktext=["1m", "5m", "10m", "20m", "30m", "1h", "2h"])
    pace_axis(fig, [pace_of(best[x]) for x in t])
    ui.chart(ui.style(fig, 400, title="Pace-Duration-Kurve"))
    if cs:
        a, b = st.columns([1, 1], gap="large")
        rows = [(lbl, fmt_pace(1000 / float(cs.speed(sec))), fmt_pace(pace_of(best[sec])) if sec in best else "–")
                for lbl, sec in (("3 min", 180), ("5 min", 300), ("10 min", 600), ("20 min", 1200), ("30 min", 1800), ("60 min", 3600))]
        a.dataframe(pd.DataFrame(rows, columns=["Dauer", "Modell /km", "Bestwert /km"]), hide_index=True, width="stretch")
        b.caption(f"2-Parameter-Modell aus Bestwerten 3–30 min (R² {cs.r2:.3f}). Ohne maximale Efforts wird CS unterschätzt.")
        if b.button(f"CS-Pace {fmt_pace(cs.cs_pace_s_km)} als Schwellenpace übernehmen", icon=":material/check:"):
            db.add_threshold(str(TODAY), run_pace=round(cs.cs_pace_s_km)); st.toast("Gespeichert – unter „Athlet & Daten“ neu berechnen.")
    a, b = st.columns(2, gap="large")
    with a:
        g = go.Figure(go.Bar(x=km_w.index, y=km_w.values, marker_color=ui.c(2), hovertemplate="%{y:.0f} km<extra></extra>"))
        ui.chart(ui.style(g, 300, legend=False, title="Wochenkilometer (aus Ø-Tempo)"))
    with b:
        ef = rw.dropna(subset=["ef"])
        if len(ef):
            e = go.Figure(go.Scatter(x=pd.to_datetime(ef.date), y=ef.ef, mode="markers", marker=dict(size=8, color=ui.c(2), opacity=.6), name="Lauf",
                                     hovertemplate="%{y:.2f}<extra></extra>"))
            e.add_scatter(x=pd.to_datetime(ef.date), y=ef.ef.rolling(5, min_periods=2).mean(), name="Trend (5 Läufe)", line=dict(color=ui.c(1), width=2))
            ui.chart(ui.style(e, 300, title="Effizienz (m/min je Herzschlag)"))
    explain("Lauf")


def page_pd():
    rng = RNG
    ui.page_header("Power-Duration-Kurve", "Bestwerte, Modell und Trainingsbereiche")
    a, b = st.columns([1, 2])
    per_kg = a.toggle("W/kg", False)
    comp = b.segmented_control("Vergleich", ["Keiner", "Vorperiode", "365 Tage"], default="Keiner", required=True)
    mm, mdl = mmp_model(rng[0], rng[1], rng[2])
    curves = {"Auswahl": mm}
    if comp == "Vorperiode":
        span = (rng[1] - rng[0]).days or 1
        curves["Vorperiode"] = mmp_model(rng[0] - timedelta(days=span), rng[0] - timedelta(days=1), rng[2])[0]
    elif comp == "365 Tage":
        curves["365 Tage"] = mmp_model(TODAY - timedelta(days=365), TODAY, rng[2])[0]
    ui.chart(mmp_fig(curves, mdl, cur_weight() if per_kg else None, 440))
    if len(curves) > 1 and mdl:
        cmp_name = [k for k in curves if k != "Auswahl"][0]
        rows = [(d, curves["Auswahl"].get(d), curves[cmp_name].get(d)) for d in (5, 60, 300, 1200, 3600)]
        txt = [f"{'%d s' % d if d < 60 else '%d min' % (d // 60)}: {x:.0f} vs. {y:.0f} W ({(x / y - 1) * 100:+.1f} %)" for d, x, y in rows if x and y]
        if txt:
            show([insights.Insight("info", f"Vergleich mit „{cmp_name}“ – " + " · ".join(txt) + ". Unter ±2 % ist Schwankung; höher zählt nur bei Maximalbelastung in beiden Zeiträumen.")])
    if not mdl:
        st.warning("Zu wenige Daten für das Modell (benötigt Efforts > 10 min)."); return
    c = st.columns(5)
    kpi(c[0], "mFTP", f"{mdl.mftp:.0f} W", f"{mdl.mftp / cur_weight():.2f} W/kg", delta_color="off")
    kpi(c[1], "FRC", f"{mdl.frc / 1000:.1f} kJ")
    kpi(c[2], "Pmax", f"{mdl.pmax:.0f} W")
    kpi(c[3], "P(60 min)", f"{mdl.ftp_60:.0f} W")
    kpi(c[4], "Modellfehler", f"{mdl.rmse:.0f} W", help="RMSE zwischen Modell und Bestwerten")
    show(insights.assess_model(mdl, mm, cur_ftp(), cur_weight()))
    a, b = st.columns(2, gap="large")
    durs = [1, 5, 15, 30, 60, 120, 300, 600, 1200, 1800, 3600, 5400]
    tbl = pd.DataFrame([dict(Dauer=f"{d // 60}:{d % 60:02d}" if d >= 60 else f"{d}s", Bestwert=round(mm[d]) if d in mm else None,
                             Modell=round(float(mdl.power(d)))) for d in durs])
    tbl["W/kg"] = (tbl["Bestwert"] / cur_weight()).round(2)
    a.markdown("**Bestwerte vs. Modell**"); a.dataframe(tbl, hide_index=True, width="stretch")
    z = pd.DataFrame([(n, round(lo), round(hi) if hi else None) for n, lo, hi in mdl.zones()], columns=["Zone", "von W", "bis W"])
    b.markdown("**Trainingsbereiche aus mFTP**"); b.dataframe(z, hide_index=True, width="stretch")
    if round(mdl.mftp) != round(cur_ftp()) and b.button(f"mFTP {mdl.mftp:.0f} W als FTP übernehmen", icon=":material/check:"):
        db.add_threshold(str(TODAY), ftp=round(mdl.mftp)); st.toast("Gespeichert – unter „Athlet & Daten“ neu berechnen.")
    with st.container(border=True):
        st.markdown("**Intervall-Planer**")
        dmin = st.slider("Intervalldauer (min)", 1, 60, 5)
        p = float(mdl.power(dmin * 60))
        st.markdown(f"Modell-Maximum für {dmin} min: **{p:.0f} W** ({p / mdl.mftp * 100:.0f} % mFTP). Für Wiederholungen meist 90–100 % davon.")
    explain("Power-Duration-Kurve")


def page_recovery():
    rng = RNG
    ui.page_header("Erholung", "HRV, Schlaf und Ruhepuls aus Garmin")
    start = rng[0] if rng else TODAY - timedelta(days=90)
    w = wellness_df(min(start, TODAY - timedelta(days=60)), TODAY)
    if w.empty:
        st.info("Noch keine Schlaf-/HRV-Daten. In „Athlet & Daten“ Garmin Connect mit „HRV & Schlaf“ synchronisieren "
                "oder im Terminal `./sync.command wellness --days 90`.", icon=":material/bedtime:")
        return
    ready = readiness()
    w = w.copy(); w["d"] = pd.to_datetime(w.date)
    view = w[w.d >= pd.Timestamp(start)]
    c = st.columns(4)
    hrv7 = w.set_index("d").hrv_night.rolling(7, min_periods=3).mean()
    kpi(c[0], "HRV (7-Tage)", f"{hrv7.dropna().iloc[-1]:.0f} ms" if hrv7.notna().any() else "–", None, hrv7.dropna().iloc[-30:], height=178)
    sl = w.sleep_s.dropna() / 3600
    kpi(c[1], "Schlaf (Ø 7 Nächte)", f"{sl.iloc[-7:].mean():.1f} h" if len(sl) else "–", None, sl.iloc[-30:], chart_type="bar", height=178)
    rhr = w.resting_hr.dropna()
    kpi(c[2], "Ruhepuls", f"{rhr.iloc[-1]:.0f} bpm" if len(rhr) else "–", f"{rhr.iloc[-1] - rhr.iloc[-31:-3].median():+.0f} vs. Norm" if len(rhr) > 10 else None,
        rhr.iloc[-30:], delta_color="inverse", height=178)
    sc = w.sleep_score.dropna()
    kpi(c[3], "Schlafscore", f"{sc.iloc[-1]:.0f}" if len(sc) else "–", None, sc.iloc[-30:], height=178)
    if ready:
        show(ready["items"])
    tss = daily_tss(); tss.index = pd.to_datetime(tss.index)
    tv = tss[tss.index >= pd.Timestamp(start)]
    f = ui.stacked(2, [.7, .3])
    if view.hrv_low.notna().any() and view.hrv_high.notna().any():
        f.add_scatter(x=view.d, y=view.hrv_high, line=dict(width=0), showlegend=False, hoverinfo="skip", row=1, col=1)
        f.add_scatter(x=view.d, y=view.hrv_low, fill="tonexty", fillcolor=ui.NEUTRAL_FILL[ui.mode()], line=dict(width=0),
                      name="Garmin-Normbereich", hoverinfo="skip", row=1, col=1)
    f.add_scatter(x=view.d, y=view.hrv_night, mode="markers", name="HRV Nacht", marker=dict(size=6, color=ui.c(1), opacity=.55),
                  hovertemplate="%{y:.0f} ms<extra>Nacht</extra>", row=1, col=1)
    f.add_scatter(x=view.d, y=hrv7.reindex(view.d).values, name="7-Tage-Mittel", line=dict(color=ui.c(1), width=2.5),
                  hovertemplate="%{y:.0f} ms<extra>7 Tage</extra>", row=1, col=1)
    f.add_bar(x=tv.index, y=tv.values, name="Trainingslast (TSS)", marker_color=ui.text2(), opacity=.45, hovertemplate="%{y:.0f} TSS<extra></extra>", row=2, col=1)
    f.update_yaxes(title_text="ms", row=1, col=1); f.update_yaxes(title_text="TSS", row=2, col=1)
    ui.chart(ui.style(f, 440, title="HRV und Trainingslast"))
    sv = view.dropna(subset=["sleep_s"])
    g = ui.stacked(2, [.7, .3])
    for i, (col, name) in enumerate((("deep_s", "Tiefschlaf"), ("rem_s", "REM"), ("light_s", "Leichtschlaf"))):
        if sv[col].notna().any():
            g.add_bar(x=sv.d, y=sv[col] / 3600, name=name, marker_color=ui.c(i + 1), hovertemplate="%{y:.1f} h<extra>" + name + "</extra>", row=1, col=1)
    if sv.awake_s.notna().any():
        g.add_bar(x=sv.d, y=sv.awake_s / 3600, name="Wach", marker_color=ui.text2(), opacity=.4, hovertemplate="%{y:.1f} h<extra>Wach</extra>", row=1, col=1)
    g.add_hline(y=7, line_dash="dot", line_color=ui.text2(), annotation_text="7 h", annotation_font_size=11, row=1, col=1)
    if sv.sleep_score.notna().any():
        g.add_scatter(x=sv.d, y=sv.sleep_score, name="Schlafscore", line=dict(color=ui.c(1), width=2), hovertemplate="%{y:.0f}<extra>Score</extra>", row=2, col=1)
    g.update_layout(barmode="stack"); g.update_yaxes(title_text="h", row=1, col=1); g.update_yaxes(title_text="Score", range=[0, 100], row=2, col=1)
    ui.chart(ui.style(g, 420, title="Schlaf"))
    with st.expander("Tabelle der letzten 14 Tage", icon=":material/table:"):
        t = view[["date", "sleep_s", "sleep_score", "hrv_night", "hrv_week", "hrv_status", "resting_hr"]].copy()
        t["Schlaf h"] = (t.pop("sleep_s") / 3600).round(1)
        st.dataframe(t.tail(14)[::-1], hide_index=True, width="stretch")
    explain("Erholung (HRV & Schlaf)")


@st.cache_data(show_spinner=False, max_entries=8)
def _run_weeks(start, end, zkey, v):
    z = runplan.Zones(*zkey)
    return runplan.weekly_stats(db.workouts_df(start, end), db.load_stream, z)


def current_zones() -> runplan.Zones:
    runs = W(TODAY - timedelta(days=180), TODAY, "Running")
    mx = float(runs.max_hr.max()) if len(runs) and runs.max_hr.notna().any() else None
    return runplan.run_zones(settings(), thr_on(TODAY, "lthr_run", None), mx, run_threshold_pace())


def page_runcheck():
    ui.page_header("Laufauswertung", "Wochenkennzahlen, Intensitätsverteilung, Steigerung und Taper – nur studienbelegte Regeln")
    s = settings()
    with st.expander("Zonen festlegen (Herzfrequenz)", icon=":material/favorite:"):
        st.caption("Am genauesten mit gemessenen Schwellen (Laktat- oder Feldtest). Ohne Messung: HFmax-Prozente (Näherung aus kleinen Elite-Studien) "
                   "oder Lauf-LTHR. Die Zonen beschreiben Dein Training – sie sind keine belegten Sollwerte.")
        with st.form("zones"):
            c = st.columns(3)
            hfmax = c[0].number_input("HFmax (gemessen)", 0, 230, int(float(s.get("hf_max") or 0)))
            lt1 = c[1].number_input("LT1-HF (aerobe Schwelle)", 0, 220, int(float(s.get("lt1_hr") or 0)))
            lt2 = c[2].number_input("LT2-HF (anaerobe Schwelle)", 0, 220, int(float(s.get("lt2_hr") or 0)))
            if st.form_submit_button("Speichern", icon=":material/save:"):
                for k, v in dict(hf_max=hfmax or "", lt1_hr=lt1 or "", lt2_hr=lt2 or "").items():
                    db.set_setting(k, v)
                st.toast("Zonen gespeichert"); st.rerun()
    z = current_zones()
    with st.spinner("Werte Läufe aus …"):
        stats = _run_weeks(str(TODAY - timedelta(days=7 * 16)), str(TODAY), (z.z1_hi, z.z2_hi, z.method, z.grade, z.pace_thr), ver())
    runs = W(TODAY - timedelta(days=120), TODAY, "Running")
    if stats.empty or stats.volumen_h.sum() == 0:
        st.info("Keine Läufe in den letzten 16 Wochen."); return
    cur = pd.Timestamp(TODAY).to_period("W-SUN").start_time.date()
    done = stats[stats.woche < cur]
    l4 = done.tail(4)
    wz = l4.volumen_h
    z1 = float(np.nansum(l4.anteil_z1 * wz) / wz[l4.anteil_z1.notna()].sum()) if l4.anteil_z1.notna().any() and wz.sum() else np.nan
    cap = runplan.next_long_run_cap(runs, TODAY + timedelta(days=1))
    ui.stats([("Umfang Ø 4 Wochen", f"{l4.volumen_h.mean():.1f} h", f"{l4.volumen_km.mean():.0f} km/Woche"),
              ("Locker (Z1) 4 Wochen", f"{z1 * 100:.0f} %" if np.isfinite(z1) else "–", f"Zonen: {z.grade}"),
              ("Läufe/Woche", f"{l4.laeufe.mean():.1f}"),
              ("Längster Lauf 30 Tage", f"{runplan.longest_30d(runs, TODAY + timedelta(days=1)):.1f} km"),
              ("Nächster Lauf höchstens", f"{cap:.1f} km" if cap else "–", "+10 % (Kohorte)")])
    st.caption(f"Zonen-Methode: {z.method}. Zuordnung je Lauf: " + ", ".join(f"{k} {v}×" for k, v in stats.attrs.get("methods", {}).items()))
    checks = runplan.rule_check(stats, runs)
    lvl = {"ok": "good", "warnung": "warn", "info": "info"}
    order = sorted(checks, key=lambda c: {"warnung": 0, "ok": 1, "info": 2}[c.status])
    show([insights.Insight(lvl[c.status], f"{c.regel}: {c.begruendung} [{c.quelle}]") for c in order])
    f = go.Figure()
    for i, (col, name) in enumerate((("anteil_z1", "Z1 locker"), ("anteil_z2", "Z2 Schwellenbereich"), ("anteil_z3", "Z3 hart"))):
        f.add_bar(x=pd.to_datetime(stats.woche), y=stats.volumen_h * stats[col].fillna(0), name=name, marker_color=ui.BLUE_RAMP[[0, 3, 6][i]],
                  hovertemplate="%{y:.1f} h<extra>" + name + "</extra>")
    f.update_layout(barmode="stack"); f.update_yaxes(title="Stunden Laufen")
    ui.chart(ui.style(f, 340, title="Laufumfang je Woche nach Zone"))
    sp = runplan.spikes(runs)
    if len(sp):
        st.markdown("**Läufe mit > 10 % Steigerung gegenüber dem längsten Lauf der 30 Tage davor**")
        st.dataframe(sp, hide_index=True, width="stretch")
    rc = races()
    up = rc[(rc.date > str(TODAY)) & (rc.priority.isin(["A", "B"]))] if len(rc) else rc
    taper = []
    if len(up):
        nr = up.iloc[0]
        rd = date.fromisoformat(nr.date)
        peak = float(done.tail(4).volumen_h.max()) if len(done) else 0
        taper = runplan.taper_plan(peak, rd)
        st.markdown(f"**Taper für „{ui.esc(nr['name'])}“ ({nr.priority}, {rd:%d.%m.%Y})**")
        if (rd - TODAY).days > 14:
            st.caption(f"Beginnt am {rd - timedelta(days=14):%d.%m.} – bis dahin wie gewohnt trainieren.")
        st.dataframe(pd.DataFrame(taper), hide_index=True, width="stretch")
        st.caption("Meta-Analyse (27 Studien): 2 Wochen, Umfang exponentiell um 41–60 % senken, Intensität und Häufigkeit unverändert [Q36]. "
                   "Ausgangswert = umfangreichste Woche der letzten 4 Wochen.")
    with st.expander("Wochentabelle", icon=":material/table:"):
        t = stats.copy()
        for col in ("anteil_z1", "anteil_z2", "anteil_z3"):
            t[col] = (t[col] * 100).round(0)
        st.dataframe(t.round(1), hide_index=True, width="stretch")
    with st.expander("Was aus dem Regelwerk bewusst nicht übernommen wurde", icon=":material/block:"):
        st.markdown("- **10-%-Wochenregel:** Im RCT mit 532 Einsteigern kein Schutz vor Verletzungen [Q38]; stattdessen die Einzel-Lauf-Steigerung [Q37].\n"
                    "- **Phasenanteile, Entlastung nach 3 Wochen, Wochen-Wachstumsfaktor:** keine belastbare Studie.\n"
                    "- **32-km-Deckel für den langen Lauf:** Konvention aus Trainingsplänen, deren Wirksamkeit nicht belegt ist [Q35].\n"
                    "- **Feste Sollwerte (Z1 ≥ 75 %, 1–2 Qualitätseinheiten):** nur aus sehr kleinen Elite-Stichproben (6 bzw. 13 Läufer) [Q33, Q34]; "
                    "der Großdatensatz zeigt nur Zusammenhänge [Q6].")
    doc = runplan.to_json(stats, checks, z, taper, ["Nur studienbelegte Regeln; Zonen beschreibend."])
    st.download_button("Auswertung als JSON", json.dumps(doc, ensure_ascii=False, indent=2, default=str), "laufauswertung.json",
                       "application/json", icon=":material/download:")


PRIO_DASH = {"A": "solid", "B": "dash", "C": "dot"}


def races_manager() -> None:
    rc = races()
    with st.expander("Wettkämpfe anlegen & verwalten", expanded=rc.empty, icon=":material/flag:"):
        with st.form("race", border=False):
            c = st.columns(4)
            d = c[0].date_input("Datum", TODAY + timedelta(days=28))
            name = c[1].text_input("Name")
            sport = c[2].selectbox("Sportart", ["Cycling", "Running", "Other"], format_func={"Cycling": "Rad", "Running": "Lauf", "Other": "Sonstige"}.get)
            prio = c[3].segmented_control("Priorität", ["A", "B", "C"], default="B", required=True, help="A = Hauptziel, B = wichtig, C = Training/Test")
            c = st.columns(3)
            dur = c[0].number_input("Erwartete Dauer (h)", 0.0, 24.0, 2.0, 0.25)
            iff = c[1].number_input("Erwartete Intensität (IF)", 0.5, 1.2, 0.85, 0.01, help="Rennen: ca. 0,85–1,0; je kürzer, desto höher.")
            c[2].metric("Geschätzte TSS", f"{dur * iff * iff * 100:.0f}")
            if st.form_submit_button("Wettkampf speichern", icon=":material/add:", type="primary"):
                if not name.strip():
                    st.error("Bitte einen Namen eingeben.")
                else:
                    db.add_race(str(d), name.strip(), sport, prio, dur, round(dur * iff * iff * 100), ""); st.rerun()
        if len(rc):
            st.dataframe(rc[["date", "name", "sport", "priority", "duration_h", "tss"]].rename(columns={
                "date": "Datum", "name": "Name", "sport": "Sportart", "priority": "Prio", "duration_h": "Dauer h", "tss": "TSS (Schätzung)"}),
                hide_index=True, width="stretch")
            a, b = st.columns([3, 1])
            rid = a.selectbox("Wettkampf löschen", [0, *rc.id], format_func=lambda i: "–" if i == 0 else f"{rc[rc.id == i].date.iloc[0]} · {rc[rc.id == i].name.iloc[0]}")
            if b.button("Löschen", icon=":material/delete:", disabled=not rid):
                db.delete_race(int(rid)); st.rerun()


def page_pmc():
    rng = RNG
    ui.page_header("Performance Management", "Fitness (CTL), Ermüdung (ATL) und Form (TSB) – alle Sportarten")
    d = full_pmc()
    last = d.iloc[-1]
    c = st.columns(5)
    kpi(c[0], "Fitness (CTL)", f"{last.ctl:.0f}", f"{last.ramp:+.1f}/Woche" if pd.notna(last.ramp) else None, d.ctl.iloc[-60:], height=178)
    kpi(c[1], "Ermüdung (ATL)", f"{last.atl:.0f}", None, d.atl.iloc[-60:], height=178)
    kpi(c[2], "Form (TSB)", f"{last.tsb:+.0f}", None, d.tsb.iloc[-60:], height=178)
    has_adj = bool(d.readiness_pts.iloc[-3:].any())
    kpi(c[3], "Form inkl. Erholung", f"{last.tsb_adj:+.0f}" if has_adj else "–", f"{last.tsb_adj - last.tsb:+.0f}" if has_adj else None,
        d.tsb_adj.iloc[-60:] if has_adj else None, delta_color="off", help="TSB minus 5 je Warnsignal aus Schlaf/HRV/Ruhepuls (max. 25).", height=178)
    kpi(c[4], "TSS 7 Tage", f"{d.tss.iloc[-7:].sum():.0f}", None, d.tss.iloc[-28:], chart_type="bar", height=178)
    a, b = st.columns(2, gap="large")
    with a:
        show(insights.assess_pmc(d))
    rc = races()
    fc = forecast_all()
    with b:
        if fc is not None and len(rc):
            show(insights.assess_races(fc, rc, TODAY))
        else:
            races_manager()
    v = fc if fc is not None else d.assign(geplant=False)
    start = pd.Timestamp(rng[0])
    end = max(pd.Timestamp(rng[1]), v.index.max())
    v = v.loc[start:end]
    act, fut = v[~v.geplant], v[v.geplant]
    if len(fut) and len(act):
        fut = pd.concat([act.iloc[[-1]], fut])
    f = go.Figure()
    f.add_bar(x=act.index, y=act.tss, name="TSS", marker_color=ui.text2(), opacity=.28, hovertemplate="%{y:.0f}<extra>TSS</extra>")
    if len(fut) > 1:
        f.add_bar(x=fut.index[1:], y=fut.tss.iloc[1:], name="geplante TSS", marker_color=ui.text2(), opacity=.12, hovertemplate="%{y:.0f}<extra>geplant</extra>")
    for i, (col, name) in enumerate((("ctl", "Fitness (CTL)"), ("atl", "Ermüdung (ATL)"), ("tsb", "Form (TSB)")), start=1):
        f.add_scatter(x=act.index, y=act[col], name=name, line=dict(color=ui.c(i), width=2.5 if col == "ctl" else 1.6),
                      hovertemplate="%{y:.0f}<extra>" + name + "</extra>")
        if len(fut) > 1:
            f.add_scatter(x=fut.index, y=fut[col], name=name + " · Prognose", line=dict(color=ui.c(i), dash="dot", width=1.6), showlegend=False,
                          hovertemplate="%{y:.0f}<extra>Prognose</extra>")
    if has_adj or (d.readiness_pts.loc[start:] > 0).any():
        adj = d.loc[start:, "tsb_adj"]
        f.add_scatter(x=adj.index, y=adj, name="Form inkl. Erholung", line=dict(color=ui.c(4), width=1.6, dash="dash"),
                      hovertemplate="%{y:.0f}<extra>inkl. Erholung</extra>")
    for r in rc.itertuples():
        x = pd.Timestamp(r.date)
        if start <= x <= end:
            f.add_shape(type="line", x0=x, x1=x, y0=0, y1=1, yref="paper", line=dict(color=ui.text2(), width=1.5, dash=PRIO_DASH.get(r.priority, "dot")))
            f.add_annotation(x=x, y=1, yref="paper", text=f"🏁 {r.priority}: {ui.esc(r.name)}", showarrow=False, yanchor="bottom", font=dict(size=11, color=ui.text2()))
    ui.range_buttons(f)
    ui.chart(ui.style(f, 540))
    st.caption("Gepunktet = Prognose aus Plan und Wettkampf-TSS (ab morgen; ohne Planeinträge 0 TSS). Rennen: durchgezogen A · gestrichelt B · gepunktet C.")
    if fc is not None and len(rc):
        races_manager()
    with st.expander("Tabelle der letzten 14 Tage", icon=":material/table:"):
        st.dataframe(d.tail(14).round(1)[::-1], width="stretch")
    explain("Performance Management (PMC)")
    with st.expander("Wettkämpfe – Hinweise", icon=":material/flag:"):
        st.markdown(insights.EXPLAIN["Wettkämpfe"])


@st.cache_data(show_spinner=False, max_entries=8)
def _run_pace_zones(start, end, thr_pace, v):
    """Summe der Sekunden je Pace-Zone über alle Läufe im Zeitraum."""
    tot = np.zeros(len(metrics.PACE_ZONES))
    for w in db.workouts_df(start, end, "Running").itertuples():
        sp = metrics.get_speed(db.load_stream(w.uid))
        sp = sp[sp > .5]                                   # Stehzeiten nicht als „locker“ zählen
        tot += metrics.time_in_zones(sp, 1000 / thr_pace, metrics.PACE_ZONES)["Sekunden"].to_numpy()
    return tot


def zones_ride_view(rng) -> None:
    tot, rows = _zones(str(rng[0]), str(rng[1]), "Cycling" if rng[2] == "Alle" else rng[2], cur_ftp(), ver())
    if rows.empty:
        st.info("Keine Rad-Einheiten mit Leistung im Zeitraum.", icon=":material/directions_bike:"); return
    pol = tot / max(tot.sum(), 1) * 100
    c = st.columns(4)
    kpi(c[0], "Locker (Z1–2)", f"{pol[:2].sum():.0f} %")
    kpi(c[1], "Mittel (Z3–4)", f"{pol[2:4].sum():.0f} %")
    kpi(c[2], "Hart (Z5–7)", f"{pol[4:].sum():.0f} %")
    kpi(c[3], "Stunden mit Leistung", f"{tot.sum() / 3600:.0f} h")
    show(insights.assess_zones(tot))
    a, b = st.columns([1, 1.6], gap="large")
    zn = [z[0] for z in metrics.POWER_ZONES]
    with a:
        f = go.Figure(go.Bar(x=tot / 3600, y=zn, orientation="h", marker_color=ui.BLUE_RAMP, text=[f"{p:.0f} %" for p in pol], textposition="outside",
                             hovertemplate="%{y}: %{x:.1f} h<extra></extra>"))
        f.update_yaxes(autorange="reversed"); f.update_xaxes(title="Stunden", range=[0, max(max(f.data[0].x), 1e-9) * 1.22])
        ui.chart(ui.style(f, 360, legend=False, hover="closest", title="Gesamt (% FTP)"))
    with b:
        wk_df = rows.groupby("Woche").sum()
        g = go.Figure()
        for i, z in enumerate(wk_df.columns):
            g.add_bar(x=wk_df.index, y=wk_df[z], name=z, marker_color=ui.BLUE_RAMP[i], hovertemplate="%{y:.1f} h<extra>" + z + "</extra>")
        g.update_layout(barmode="stack"); g.update_yaxes(title="Stunden")
        ui.chart(ui.style(g, 360, title="Pro Woche"))


def zones_run_view(rng) -> None:
    z = current_zones()
    stats = _run_weeks(str(rng[0]), str(rng[1]), (z.z1_hi, z.z2_hi, z.method, z.grade, z.pace_thr), ver())
    if stats.empty or stats.volumen_h.sum() == 0:
        st.info("Keine Läufe im Zeitraum.", icon=":material/directions_run:"); return
    h = {k: float((stats.volumen_h * stats[f"anteil_{k}"].fillna(0)).sum()) for k in ("z1", "z2", "z3")}
    tot = sum(h.values()) or 1
    c = st.columns(4)
    kpi(c[0], "Z1 locker", f"{h['z1'] / tot * 100:.0f} %")
    kpi(c[1], "Z2 Schwellenbereich", f"{h['z2'] / tot * 100:.0f} %")
    kpi(c[2], "Z3 hart", f"{h['z3'] / tot * 100:.0f} %")
    kpi(c[3], "Stunden Laufen", f"{stats.volumen_h.sum():.0f} h")
    st.caption(f"3-Zonen-Modell nach Herzfrequenz · Methode: {z.method}. Zonen festlegen unter Analyse → Laufauswertung.")
    show([insights.Insight("info", f"Locker {h['z1'] / tot * 100:.0f} %, Schwellenbereich {h['z2'] / tot * 100:.0f} %, hart {h['z3'] / tot * 100:.0f} % der Laufzeit im Zeitraum."),
          insights.Insight("info", "Im Großdatensatz (151.813 Marathons) hing ein höherer Anteil lockeren Laufens mit schnelleren Zeiten zusammen – ein Zusammenhang, kein belegter Sollwert. [Q6]")])
    a, b = st.columns([1, 1.6], gap="large")
    names = ["Z1 locker", "Z2 Schwellenbereich", "Z3 hart"]
    ramp = [ui.BLUE_RAMP[0], ui.BLUE_RAMP[3], ui.BLUE_RAMP[6]]
    with a:
        vals = [h["z1"], h["z2"], h["z3"]]
        f = go.Figure(go.Bar(x=vals, y=names, orientation="h", marker_color=ramp, text=[f"{v / tot * 100:.0f} %" for v in vals], textposition="outside",
                             hovertemplate="%{y}: %{x:.1f} h<extra></extra>"))
        f.update_yaxes(autorange="reversed"); f.update_xaxes(title="Stunden", range=[0, max(max(f.data[0].x), 1e-9) * 1.22])
        ui.chart(ui.style(f, 300, legend=False, hover="closest", title="Gesamt (Herzfrequenz)"))
    with b:
        g = go.Figure()
        for i, k in enumerate(("anteil_z1", "anteil_z2", "anteil_z3")):
            g.add_bar(x=pd.to_datetime(stats.woche), y=stats.volumen_h * stats[k].fillna(0), name=names[i], marker_color=ramp[i],
                      hovertemplate="%{y:.1f} h<extra>" + names[i] + "</extra>")
        g.update_layout(barmode="stack"); g.update_yaxes(title="Stunden")
        ui.chart(ui.style(g, 300, title="Pro Woche"))
    rp = run_threshold_pace()
    if rp:
        pz = _run_pace_zones(str(rng[0]), str(rng[1]), rp, ver())
        if pz.sum():
            labels = [p[0] for p in metrics.PACE_ZONES]
            f = go.Figure(go.Bar(x=pz / 3600, y=labels, orientation="h", marker_color=ui.BLUE_RAMP[:len(labels)],
                                 text=[f"{v / pz.sum() * 100:.0f} %" for v in pz], textposition="outside", hovertemplate="%{y}: %{x:.1f} h<extra></extra>"))
            f.update_yaxes(autorange="reversed"); f.update_xaxes(title="Stunden", range=[0, max(max(f.data[0].x), 1e-9) * 1.22])
            ui.chart(ui.style(f, 320, legend=False, hover="closest", title=f"Pace-Zonen (Schwellenpace {fmt_pace(rp)} /km, ohne Stehzeiten)"))
    else:
        st.caption("Pace-Zonen erscheinen, sobald unter „Athlet & Daten“ eine Lauf-Schwellenpace hinterlegt ist.")


def page_zones():
    rng = RNG
    ui.page_header("Zeit in Zonen", "Intensitätsverteilung – Rad nach Leistung, Laufen nach Herzfrequenz und Pace")
    if rng[2] == "Running":
        zones_run_view(rng)
    elif rng[2] == "Cycling":
        zones_ride_view(rng)
    else:
        t1, t2 = st.tabs([":material/directions_bike: Rad", ":material/directions_run: Lauf"])
        with t1:
            zones_ride_view(rng)
        with t2:
            zones_run_view(rng)
    explain("Zeit in Zonen")


def page_profile():
    rng = RNG
    ui.page_header("Profil & Phänotyp", "Bestwerte im Vergleich zu Referenzstufen")
    mm, _ = mmp_model(rng[0], rng[1], rng[2])
    rows = profile.profile(mm, cur_weight(), settings()["sex"])
    if not rows:
        st.info("Zu wenige Daten."); return
    ph, desc = profile.phenotype(rows)
    st.badge(f"Phänotyp: {ph}", icon=":material/fingerprint:", color="blue")
    st.caption(desc)
    ui.stats([(r["Dauer"], f"{r['WperKg']:.2f} W/kg", f"{r['Level']} · Score {r['Score']}") for r in rows])
    show(insights.assess_profile(rows))
    df = pd.DataFrame(rows)
    f = go.Figure(go.Bar(x=df.Dauer, y=df.Score, marker_color=ui.c(1), text=df.Level, textposition="outside",
                         hovertemplate="%{x}: Score %{y}<extra></extra>"))
    f.update_yaxes(range=[0, 110], title="Score (0 = untrainiert, 100 = Weltklasse)")
    ui.chart(ui.style(f, 360, legend=False, hover="closest"))
    st.caption("Referenzwerte: Näherung an die übliche Power-Profile-Tabelle (profile.py); Phänotyp-Regeln heuristisch.")
    explain("Profil & Phänotyp")


def page_fatigue():
    wk = WK
    ui.page_header("Fatigue Resistance", "Wie viel Deiner frischen Leistung bleibt nach Vorbelastung?")
    tbl = profile.fatigue_resistance(list(wk.fatigue))
    if not tbl:
        st.info("Keine Daten."); return
    show(insights.assess_fatigue(tbl))
    wtk = cur_weight()
    f = go.Figure()
    for i, (d, v) in enumerate(tbl.items()):
        kjs = sorted(v)
        lbl = f"{d // 60} min" if d >= 60 else f"{d} s"
        f.add_scatter(x=kjs, y=[v[k][1] for k in kjs], name=lbl, mode="lines+markers", line=dict(color=ui.c(i + 1), width=2), marker=dict(size=9),
                      customdata=[v[k][0] for k in kjs], hovertemplate="%{y:.0f} % (%{customdata:.0f} W)<extra>" + lbl + "</extra>")
    f.update_xaxes(title="Vorab geleistete Arbeit (kJ)", tickvals=[0, 1000, 2000, 3000],
                   ticktext=[f"{k} kJ<br>{k / wtk:.0f} kJ/kg" for k in (0, 1000, 2000, 3000)])
    f.update_yaxes(title="% des frischen Bestwerts")
    ui.chart(ui.style(f, 420))
    rows = [dict(Dauer=d, **{f"{k} kJ ({k / wtk:.0f} kJ/kg)": f"{v[k][0]:.0f} W ({v[k][1]:.0f} %)" for k in sorted(v)}) for d, v in tbl.items()]
    st.dataframe(pd.DataFrame(rows), hide_index=True, width="stretch")
    explain("Fatigue Resistance")


@st.cache_data(show_spinner=False, max_entries=8)
def _run_hr_progress(ref_hr, v):
    rows = []
    for w in db.workouts_df(str(TODAY - timedelta(days=365)), str(TODAY), "Running").itertuples():
        try:
            r = runplan.hr_speed_relation(db.load_stream(w.uid), ref_hr)
        except Exception:
            r = None
        if r:
            rows.append(dict(date=pd.Timestamp(w.date), name=w.name, speed=r["speed"], eff=r["eff"], n=r["n"], method=r["method"], hr=r["hr_mean"]))
    return pd.DataFrame(rows)


def progress_run_view() -> None:
    lthr = thr_on(TODAY, "lthr_run", None)
    runs = W(TODAY - timedelta(days=120), TODAY, "Running")
    typ = _run_hr_progress(0, ver())                     # nur typische HF der gleichmäßigen Abschnitte je Lauf
    if len(typ):
        default = int(round(typ.hr.median()))
    else:
        default = int(round(.85 * lthr)) if lthr else 140
    default = min(max(default, 100), 190)
    ref = st.slider("Referenz-Herzfrequenz (bpm)", 100, 190, default, key=f"ref_hr_{default}",
                    help="Verglichen wird das Tempo bei genau dieser HF. Voreinstellung: Deine typische HF in gleichmäßigen Laufabschnitten (Median), damit möglichst viele Läufe einen Wert haben.")
    with st.spinner("Werte Läufe aus …"):
        df = _run_hr_progress(ref, ver())
    if df.empty:
        st.info("Keine auswertbaren Läufe mit Herzfrequenz (mind. ca. 20 min, gleichmäßige Abschnitte).", icon=":material/favorite:"); return
    sp = df.dropna(subset=["speed"]).sort_values("date")
    ef = df.sort_values("date")
    def window(x, a, b):
        return x[(x.date > pd.Timestamp(TODAY - timedelta(days=a))) & (x.date <= pd.Timestamp(TODAY - timedelta(days=b)))]
    now, before = window(sp, 28, 0), window(sp, 70, 42)
    e_now, e_before = window(ef, 28, 0), window(ef, 70, 42)
    c = st.columns(4)
    v_now = now.speed.median() if len(now) >= 3 else np.nan
    v_bef = before.speed.median() if len(before) >= 3 else np.nan
    ch = (v_now / v_bef - 1) * 100 if np.isfinite(v_now) and np.isfinite(v_bef) else np.nan
    kpi(c[0], f"Pace bei {ref} bpm", f"{fmt_pace(1000 / v_now)} /km" if np.isfinite(v_now) else "–",
        f"{ch:+.1f} % Tempo vs. vor 6–10 Wochen" if np.isfinite(ch) else None, sp.speed.iloc[-20:] if len(sp) > 1 else None)
    en, eb = (e_now.eff.median() if len(e_now) >= 3 else np.nan), (e_before.eff.median() if len(e_before) >= 3 else np.nan)
    kpi(c[1], "Effizienz (m/min je Schlag)", f"{en:.2f}" if np.isfinite(en) else "–",
        f"{(en / eb - 1) * 100:+.1f} %" if np.isfinite(en) and np.isfinite(eb) else None, ef.eff.iloc[-20:] if len(ef) > 1 else None)
    kpi(c[2], "Läufe mit Wert", f"{len(sp)} / {len(df)}", "Referenz-HF erreicht", delta_color="off")
    kpi(c[3], "Zeitraum", "12 Monate", f"{len(now)} Läufe in 4 Wochen", delta_color="off")
    items = []
    if np.isfinite(ch):
        lvl = "good" if ch >= 2 else "warn" if ch <= -2 else "info"
        items.append(insights.Insight(lvl, f"Bei {ref} bpm läufst Du aktuell {fmt_pace(1000 / v_now)} /km gegenüber {fmt_pace(1000 / v_bef)} /km vor 6–10 Wochen ({ch:+.1f} % Tempo) – "
                                      + ("schneller bei gleicher Herzfrequenz spricht für eine bessere aerobe Fitness." if ch >= 2 else
                                         "langsamer bei gleicher Herzfrequenz: mögliche Ursachen sind Ermüdung, Hitze, Krankheit oder Formverlust." if ch <= -2 else
                                         "praktisch unverändert (unter ±2 % – bei Alltagsläufen im Bereich der normalen Schwankung).")))
    else:
        items.append(insights.Insight("info", "Für einen Vergleich braucht es je mind. 3 Läufe mit Referenz-HF in den letzten 4 Wochen und vor 6–10 Wochen."))
    items.append(insights.Insight("info", "Die HF bei standardisierter submaximaler Belastung gilt in Übersichtsarbeiten als nützliches Maß für den Trainingszustand. "
                                  "Belegt ist das für standardisierte Tests – Alltagsläufe sind durch Gelände, Hitze, Ermüdung und HF-Drift verrauschter. "
                                  "Am aussagekräftigsten: regelmäßig dieselbe flache Strecke im gleichen Tempo laufen und die HF vergleichen. [Q39]"))
    items.append(insights.Insight("info", "Berechnung: steigungskorrigiertes Tempo, nur gleichmäßige 30-s-Abschnitte nach den ersten 10 Minuten; Regression Tempo ~ HF ohne Extrapolation."))
    show(items)
    if len(sp):
        f = go.Figure()
        f.add_scatter(x=sp.date, y=1000 / sp.speed, mode="markers", name="Lauf", marker=dict(size=8, color=ui.c(2), opacity=.55),
                      text=[f"{fmt_pace(1000 / v)} /km · {nm} · {m}" for v, nm, m in zip(sp.speed, sp.name, sp.method)], hovertemplate="%{text}<extra></extra>")
        roll = sp.set_index("date").speed.rolling("28D", min_periods=3).median()
        f.add_scatter(x=roll.index, y=1000 / roll.values, name="Median 4 Wochen", line=dict(color=ui.c(1), width=2.5),
                      text=[fmt_pace(1000 / v) if np.isfinite(v) else "" for v in roll.values], hovertemplate="%{text} /km<extra>Median</extra>")
        pace_axis(f, 1000 / sp.speed)
        ui.chart(ui.style(f, 380, title=f"Tempo bei {ref} bpm"))
    g = go.Figure()
    g.add_scatter(x=ef.date, y=ef.eff, mode="markers", name="Lauf", marker=dict(size=7, color=ui.c(2), opacity=.5), hovertemplate="%{y:.2f}<extra></extra>")
    re_ = ef.set_index("date").eff.rolling("28D", min_periods=3).median()
    g.add_scatter(x=re_.index, y=re_.values, name="Median 4 Wochen", line=dict(color=ui.c(1), width=2.5), hovertemplate="%{y:.2f}<extra>Median</extra>")
    g.update_yaxes(title="m/min je Herzschlag")
    ui.chart(ui.style(g, 320, title="Effizienz gleichmäßiger Abschnitte (steigend = mehr Tempo je Herzschlag)"))


def progress_ride_view(rng) -> None:
    win = st.select_slider("Fensterlänge", [42, 60, 90, 120, 180], value=90, format_func=lambda d: f"{d} Tage")
    with st.spinner("Berechne Verlauf …"):
        df = _progress("Cycling" if rng[2] == "Alle" else rng[2], win, ver())
    if df.empty or "mFTP" not in df:
        st.info("Zu wenige Rad-Einheiten mit Leistung und Maximalbelastungen für ein belastbares Modell.", icon=":material/directions_bike:"); return
    bad = int((~df.model_ok).sum())
    if bad:
        st.caption(f"{bad} von {len(df)} Wochenfenstern ohne belastbares Leistungsmodell ausgeblendet (zu wenige Maximalbelastungen oder Anpassung an der Modellgrenze).")
    show(insights.assess_progress(df))
    c = st.columns(3, gap="large")
    for col, (k, title, unit) in zip(c, (("mFTP", "mFTP", "W"), ("FRC", "FRC", "kJ"), ("Pmax", "Pmax", "W"))):
        with col:
            s = df.dropna(subset=[k])
            f = go.Figure(go.Scatter(x=s.Datum, y=s[k], line=dict(color=ui.c(1), width=2.5), fill="tozeroy", fillcolor=ui.NEUTRAL_FILL[ui.mode()],
                                     hovertemplate="%{y:.1f} " + unit + "<extra></extra>"))
            ui.chart(ui.style(f, 240, legend=False, title=f"{title} ({unit})"))
    best = go.Figure()
    for i, (k, lbl) in enumerate((("5s", "5 s"), ("60s", "1 min"), ("300s", "5 min"), ("1200s", "20 min"), ("3600s", "60 min"))):
        if k in df:
            best.add_scatter(x=df.Datum, y=df[k], name=lbl, line=dict(color=ui.c(i + 1), width=2), hovertemplate="%{y:.0f} W<extra>" + lbl + "</extra>")
    best.update_yaxes(title="Watt", type="log")
    ui.chart(ui.style(best, 380, title=f"Bestwerte (gleitendes {win}-Tage-Fenster, log. Skala)"))


def page_progress():
    rng = RNG
    ui.page_header("Fortschritt", "Rad: Leistungsmodell und Bestwerte · Lauf: Tempo bei gleicher Herzfrequenz")
    if rng[2] == "Running":
        progress_run_view()
    elif rng[2] == "Cycling":
        progress_ride_view(rng)
    else:
        t1, t2 = st.tabs([":material/directions_run: Lauf", ":material/directions_bike: Rad"])
        with t1:
            progress_run_view()
        with t2:
            progress_ride_view(rng)
    explain("Fortschritt")


def page_plan():
    ui.page_header("Planung", "Aufbaupläne, Einzeltermine und Prognose")
    act = daily_tss()
    base = full_pmc()
    ctl0 = base.ctl.iloc[-1] if len(base) else 0
    t1, t2 = st.tabs([":material/auto_graph: Aufbauplan", ":material/add_task: Einzeltermin"])
    with t1:
        c = st.columns(4)
        target = c[0].number_input("Ziel-CTL", 10, 250, int(ctl0 + 10))
        weeks = c[1].number_input("Wochen", 2, 52, 8)
        rec = c[2].number_input("Entlastung alle n Wochen", 0, 8, 4)
        start = c[3].date_input("Start (Montag)", TODAY + timedelta(days=(7 - TODAY.weekday()) % 7))
        days = st.pills("Trainingstage", ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"], selection_mode="multi", default=["Di", "Do", "Sa", "So"])
        loads = pmc.ramp_plan(ctl0, target, int(weeks), int(rec))
        g = go.Figure(go.Bar(x=[f"W{i + 1}" for i in range(len(loads))], y=loads, marker_color=ui.c(1), hovertemplate="%{y} TSS<extra></extra>"))
        ui.chart(ui.style(g, 220, legend=False, hover="closest", title=f"Wochen-TSS (aktuelle CTL {ctl0:.0f} → Ziel {target})"))
        if st.button("Plan speichern (ersetzt künftige Einträge)", icon=":material/save:", type="primary", disabled=not days):
            db.clear_planned_from(str(start))
            idx = [["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"].index(x) for x in days]
            share = np.array([1.0 if i in (5, 6) else 0.7 for i in idx]); share /= share.sum()
            for wi, L in enumerate(loads):
                for i, sh in zip(idx, share):
                    db.add_planned(str(start + timedelta(days=wi * 7 + i)), "Training", round(L * sh))
            st.toast("Plan gespeichert"); st.rerun()
    with t2:
        c = st.columns(4)
        d = c[0].date_input("Datum", TODAY + timedelta(days=1)); n = c[1].text_input("Name", "Intervalle")
        tval = c[2].number_input("Geplante TSS", 0, 600, 80)
        if c[3].button("Hinzufügen", icon=":material/add:"):
            db.add_planned(str(d), n, tval); st.toast("Hinzugefügt"); st.rerun()
    pl = planned()
    if len(pl):
        s = settings()
        planned_ser = planned_load()
        until = max(pd.to_datetime(pl.date).max().date(), pd.to_datetime(planned_ser.index).max().date())
        fc = pmc.forecast(act, planned_ser, str(until), ctl_tau=float(s["ctl_tau"]), atl_tau=float(s["atl_tau"]))
        fc = fc.loc[str(TODAY - timedelta(days=60)):]
        show(insights.assess_plan(fc))
        f = go.Figure()
        f.add_bar(x=fc.index, y=fc.tss.where(fc.geplant), name="geplante TSS", marker_color=ui.text2(), opacity=.25, hovertemplate="%{y:.0f}<extra>geplant</extra>")
        for i, (k, nme) in enumerate((("ctl", "Fitness (CTL)"), ("atl", "Ermüdung (ATL)"), ("tsb", "Form (TSB)")), start=1):
            f.add_scatter(x=fc.index, y=fc[k], name=nme, line=dict(color=ui.c(i), width=2.5 if k == "ctl" else 1.6), hovertemplate="%{y:.0f}<extra>" + nme + "</extra>")
        f.add_vline(x=pd.Timestamp(TODAY), line_dash="dot", line_color=ui.text2())
        ui.chart(ui.style(f, 420, title=f"Prognose bis {until:%d.%m.%Y}"))
        with st.expander("Geplante Einträge", icon=":material/list:"):
            st.dataframe(pl, hide_index=True, width="stretch")
            a, b = st.columns([3, 1])
            dl = a.selectbox("Eintrag löschen", [0, *pl.id], format_func=lambda i: "–" if i == 0 else f"{pl[pl.id == i].date.iloc[0]} · {pl[pl.id == i].name.iloc[0]} · {pl[pl.id == i].tss.iloc[0]:.0f} TSS")
            if b.button("Löschen", icon=":material/delete:", disabled=not dl):
                db.delete_planned(int(dl)); st.rerun()
    explain("Planung")


GARMIN_LOG = config.ROOT / "garmin_sync.log"
GARMIN_MFA = config.ROOT / "garmin_mfa.txt"


def start_garmin(days: int, env: dict, with_wellness: bool = True) -> None:
    config.ensure_dirs()
    GARMIN_MFA.unlink(missing_ok=True)
    log = open(GARMIN_LOG, "w")
    st.session_state["garmin_proc"] = subprocess.Popen(
        [sys.executable, "-u", str(ROOT / "sync.py"), "garmin", "--days", str(days), *([] if with_wellness else ["--no-wellness"])], stdout=log, stderr=subprocess.STDOUT,
        stdin=subprocess.DEVNULL, env={**env, "GARMIN_MFA_FILE": str(GARMIN_MFA)})
    st.session_state["mfa_sent"] = False


@st.fragment(run_every=2)
def garmin_status() -> None:
    p = st.session_state.get("garmin_proc")
    if p is None:
        return
    log = GARMIN_LOG.read_text() if GARMIN_LOG.exists() else ""
    shown = log.replace("MFA_REQUIRED\n", "").strip()
    if p.poll() is None:
        if "MFA_REQUIRED" in log and not st.session_state.get("mfa_sent"):
            st.warning("Garmin hat einen 2FA-Code geschickt (E-Mail/Authenticator). Bitte hier eingeben:", icon=":material/key:")
            with st.form("mfa"):
                code = st.text_input("2FA-Code")
                if st.form_submit_button("Code senden") and code.strip():
                    GARMIN_MFA.write_text(code.strip())
                    st.session_state["mfa_sent"] = True
        else:
            with st.status("Garmin-Sync läuft …", expanded=True):
                st.code(shown[-600:] or "Anmeldung …", language=None)
    else:
        (st.success if p.returncode == 0 else st.error)(shown or "Fertig.")


def page_sources():
    ui.page_header("Quellen & Evidenz", "Studien hinter Hinweisen und Empfehlungen – mit Aussagekraft und Grenzen")
    st.markdown("Für jede Quelle: **was das Video sagt**, **was die Studie (laut Abstract) zeigt** und **wo die Grenzen liegen**. "
                "Volltexte wurden nicht gelesen; Autorennamen sind weggelassen (Titel + Jahr + Link).")
    a, b = st.columns([2, 1])
    lv = a.pills("Evidenzstufe", evidence.LEVELS, selection_mode="multi", default=evidence.LEVELS)
    q = b.text_input("Suche", placeholder="z. B. Kohlenhydrate, Kraft, Zonen")
    color = {"Review": "blue", "RCT": "green", "Beobachtung": "orange", "Hypothese": "violet", "Nicht verifiziert": "gray"}
    for e in evidence.EVIDENCE:
        if e["level"] not in (lv or []) or (q and q.lower() not in (e["title"] + e["finding"] + e["used_in"] + e["video"]).lower()):
            continue
        with st.container(border=True):
            h1, h2 = st.columns([5, 1])
            h1.markdown(f"**{e['id']} · {ui.esc(e['title'])}**  \n<span style='opacity:.65'>{ui.esc(e['journal'])} · {e['year'] or '—'}</span>", unsafe_allow_html=True)
            with h2:
                st.badge(e["level"], color=color[e["level"]])
            st.markdown(f"**Video:** {e['video']}  \n**Befund:** {e['finding']}")
            st.caption(f"⚠️ Grenzen: {e['caveat']}  ·  Verwendet in: {e['used_in']}" + (f"  ·  [Link]({e['url']})" if e["url"] else ""))


def page_athlete():
    wk = WK
    ui.page_header("Athlet & Daten", "Schwellenwerte, Einstellungen und Import")
    show(insights.assess_data(W(), thresholds(), TODAY))
    tabs = st.tabs([":material/cloud_download: Daten laden", ":material/tune: Schwellenwerte", ":material/settings: Einstellungen", ":material/list: Workouts"])
    with tabs[0]:
        c = st.columns([1, 1, 1, 1])
        days = c[0].number_input("Tage zurück", 1, 3650, 30)
        env = dict(os.environ)
        if not any(config.TOKEN_DIR.glob("*")):
            st.info("Garmin ist noch nicht angemeldet: E-Mail und Passwort eingeben und „Garmin Connect“ klicken. Bei 2FA erscheint danach ein Feld für den Code. "
                    "Das Passwort wird nicht gespeichert, nur das Anmelde-Token.", icon=":material/lock:")
            ge, gp = st.columns(2)
            em, pw = ge.text_input("Garmin E-Mail"), gp.text_input("Garmin Passwort", type="password")
            if em and pw:
                env.update(GARMIN_EMAIL=em, GARMIN_PASSWORD=pw)
        wl = st.toggle("HRV & Schlaf mitladen", True, help="Zusätzliche Abrufe pro Tag (ca. 1 s je Tag).")
        if c[1].button("Garmin Connect", icon=":material/sync:", type="primary", width="stretch"):
            start_garmin(days, env, wl)
        for col, (lbl, args, icon) in zip(c[2:], (("TrainingPeaks", ["trainingpeaks", "--days", str(days)], ":material/cloud:"),
                                                  ("Inbox-Ordner", ["folder"], ":material/folder_open:"))):
            if col.button(lbl, icon=icon, width="stretch", help=str(config.INBOX) if lbl == "Inbox-Ordner" else None):
                with st.spinner(f"{lbl} …"):
                    r = subprocess.run([sys.executable, str(ROOT / "sync.py"), *args], capture_output=True, text=True, stdin=subprocess.DEVNULL, env=env)
                (st.success if r.returncode == 0 else st.error)(r.stdout + r.stderr)
        garmin_status()
        up = st.file_uploader("Dateien hochladen (FIT/TCX/GPX/CSV/ZIP)", accept_multiple_files=True)
        if up and st.button("Hochgeladene Dateien importieren", icon=":material/upload:"):
            config.ensure_dirs(); tot = [0, 0, []]
            with st.spinner("Importiere …"):
                for f in up:
                    p = config.INBOX / f.name; p.write_bytes(f.getvalue())
                    n, k, e = ingest.import_path(p, "upload"); tot[0] += n; tot[1] += k; tot[2] += e
            st.success(f"{tot[0]} neu, {tot[1]} Duplikate"); [st.error(e) for e in tot[2]]
    with tabs[1]:
        with st.form("thr"):
            c = st.columns(3)
            d = c[0].date_input("Gültig ab", TODAY)
            ftp = c[1].number_input("Rad-FTP (W)", 0, 600, int(cur_ftp()))
            kg = c[2].number_input("Gewicht (kg)", 30.0, 150.0, float(cur_weight()))
            c = st.columns(3)
            lthr = c[0].number_input("Rad-LTHR (bpm)", 0, 230, int(thr_on(TODAY, "lthr", 0) or 0))
            lthr_run = c[1].number_input("Lauf-LTHR (bpm)", 0, 230, int(thr_on(TODAY, "lthr_run", 0) or 0))
            rp0 = run_threshold_pace()
            rp_txt = c[2].text_input("Lauf-Schwellenpace (min:sek /km)", fmt_pace(rp0) if rp0 else "")
            if st.form_submit_button("Speichern", icon=":material/save:", type="primary"):
                rp = parse_pace(rp_txt) if rp_txt else None
                if rp_txt and rp is None:
                    st.error("Pace-Format: 4:45")
                else:
                    db.add_threshold(str(d), ftp or None, lthr or None, kg, rp, lthr_run or None); st.toast("Gespeichert"); st.rerun()
        st.dataframe(thresholds(), hide_index=True, width="stretch")
        if st.button("Alle Workouts mit Schwellenwert-Verlauf neu berechnen", icon=":material/refresh:"):
            with st.spinner("Berechne neu …"):
                n = ingest.recompute_all()
            st.toast(f"{n} Workouts neu berechnet"); st.rerun()
    with tabs[2]:
        s = settings()
        c = st.columns(3)
        sex = c[0].segmented_control("Profilreferenz", ["m", "f"], default=s["sex"], required=True, format_func={"m": "männlich", "f": "weiblich"}.get)
        rest = c[1].number_input("Ruhepuls", 30, 100, int(s["rest_hr"]))
        exp = st.segmented_control("Krafttraining-Erfahrung", ["Einsteiger", "Geübt"], default=s.get("strength_experience", "Einsteiger"), required=True,
                                   help="Geübt = sichere Technik bei schweren Kniebeugen/Kreuzheben (3–5 Wdh.). Einsteiger beginnen mit mittleren Lasten.")
        crank = c[2].number_input("Kurbellänge (mm)", 150.0, 185.0, float(s["crank_mm"]))
        if st.button("Einstellungen speichern", icon=":material/save:"):
            for k, v in dict(sex=sex, rest_hr=rest, crank_mm=crank, strength_experience=exp).items():
                db.set_setting(k, v)
            st.toast("Gespeichert")
        st.caption("Hell/Dunkel: Menü ⋮ oben rechts → Settings.")
    with tabs[3]:
        sl = strength_log()
        if len(sl):
            st.markdown("**Erfasste Krafteinheiten**")
            st.dataframe(sl[::-1], hide_index=True, width="stretch")
            a_, b_ = st.columns([3, 1])
            sid = a_.selectbox("Krafteinheit löschen", [0, *sl.id], format_func=lambda i: "–" if i == 0 else f"{sl[sl.id == i].date.iloc[0]} · {sl[sl.id == i].kind.iloc[0]}")
            if b_.button("Löschen", key="del_strength", icon=":material/delete:", disabled=not sid):
                db.delete_strength(int(sid)); st.rerun()
        if len(wk):
            view = wk[["start_time", "sport", "name", "source", "duration_s", "np", "tss", "tss_method", "uid"]].copy()
            view["duration_s"] = (view.duration_s / 60).round()
            st.dataframe(view[::-1], hide_index=True, width="stretch", column_config={
                "duration_s": st.column_config.NumberColumn("min"), "tss": st.column_config.ProgressColumn("TSS", min_value=0, max_value=300, format="%.0f"),
                "np": st.column_config.NumberColumn("NP", format="%.0f")})
            a, b = st.columns([3, 1])
            dsel = a.selectbox("Workout löschen", [""] + list(wk.uid[::-1]))
            if b.button("Löschen", icon=":material/delete:", disabled=not dsel):
                db.delete_workout(dsel); st.rerun()
    explain("Athlet & Daten")


# =============================================================== Navigation & Filter
POWER_PAGES = {"pd", "profile", "fatigue"}


def guarded(key: str, fn):
    def run():
        if RNG is None and key not in ("athlete", "sources"):
            ui.page_header("Willkommen bei WKO Lokal", "Noch keine Trainingsdaten vorhanden")
            st.info("Daten laden: unter „Athlet & Daten“ Garmin verbinden oder Dateien hochladen. Zum Ausprobieren im Terminal: `python sync.py demo`.",
                    icon=":material/rocket_launch:")
            if st.button("Zu „Athlet & Daten“", icon=":material/arrow_forward:", type="primary"):
                st.switch_page(PAGE["athlete"])
            return
        if RNG is not None and WK.empty and key not in ("athlete", "sources", "pmc", "recovery", "plan", "dashboard"):
            st.warning("Keine Workouts im gewählten Zeitraum/Sport.", icon=":material/filter_alt_off:"); return
        if key in POWER_PAGES and RNG is not None and not (WK.tss_method == "power").any():
            st.info("Diese Ansicht wertet Rad-Leistung (Watt) aus – im gewählten Zeitraum/Sport gibt es keine Rad-Einheiten mit Leistung.", icon=":material/directions_bike:")
            if st.button("Zur Lauf-Entsprechung: „Laufen“ (Pace-Kurve, Critical Speed)", icon=":material/directions_run:"):
                st.switch_page(PAGE["run"])
            return
        fn()
    run.__name__ = f"page_{key}"
    return run


SPEC = [("Übersicht", [("dashboard", "Dashboard", ":material/space_dashboard:", page_dashboard),
                       ("pmc", "Fitness & Form", ":material/monitoring:", page_pmc),
                       ("recovery", "Erholung", ":material/bedtime:", page_recovery)]),
        ("Analyse", [("workout", "Workout-Analyse", ":material/directions_bike:", page_workout),
                     ("pd", "Power-Duration", ":material/show_chart:", page_pd),
                     ("run", "Laufen", ":material/directions_run:", page_run),
                     ("runcheck", "Laufauswertung", ":material/fact_check:", page_runcheck),
                     ("zones", "Zeit in Zonen", ":material/stacked_bar_chart:", page_zones),
                     ("profile", "Profil & Phänotyp", ":material/fingerprint:", page_profile),
                     ("fatigue", "Fatigue Resistance", ":material/battery_charging_full:", page_fatigue),
                     ("progress", "Fortschritt", ":material/trending_up:", page_progress)]),
        ("Planung", [("plan", "Planung & Prognose", ":material/event:", page_plan)]),
        ("Daten", [("athlete", "Athlet & Daten", ":material/person:", page_athlete),
                   ("sources", "Quellen & Evidenz", ":material/menu_book:", page_sources)])]
PAGE = {key: st.Page(guarded(key, fn), title=title, icon=icon, url_path=key, default=key == "dashboard")
        for _, items in SPEC for key, title, icon, fn in items}
nav = st.navigation({sec: [PAGE[k] for k, *_ in items] for sec, items in SPEC}, expanded=True)

with st.sidebar:
    all_w = W()
    if all_w.empty:
        WK, RNG = all_w, None
    else:
        st.markdown("**Filter**")
        sport_map = {"Alle": "Alle", "Rad": "Cycling", "Lauf": "Running"}
        sp = st.segmented_control("Sportart", list(sport_map), default="Alle", required=True, key="f_sport", label_visibility="collapsed")
        presets = {"4 W": 28, "3 M": 90, "6 M": 180, "1 J": 365, "Alle": 99999, "…": None}
        pr = st.segmented_control("Zeitraum", list(presets), default="3 M", required=True, key="f_range", label_visibility="collapsed",
                                  help="… = eigener Zeitraum")
        if presets[pr] is None:
            sel = st.date_input("Von – Bis", (TODAY - timedelta(days=90), TODAY), key="f_dates")
            a_, b_ = (sel if isinstance(sel, (tuple, list)) and len(sel) == 2 else (TODAY - timedelta(days=90), TODAY))
        else:
            b_, a_ = TODAY, TODAY - timedelta(days=presets[pr])
        WK, RNG = W(a_, b_, sport_map[sp]), (a_, b_, sport_map[sp])
        st.caption(f"{len(WK)} Einheiten · {WK.duration_s.sum() / 3600:.0f} h · {WK.tss.sum():.0f} TSS")

nav.run()
