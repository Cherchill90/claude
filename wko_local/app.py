"""WKO-ähnliche Analyse-Oberfläche. Start: streamlit run app.py"""
from __future__ import annotations

import os
import subprocess
import sys
from datetime import date, timedelta
from pathlib import Path

import numpy as np
import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
import streamlit as st

from wkolocal import config, db, ingest, insights, metrics, model, pmc, profile, recommend, wellness

st.set_page_config(page_title="WKO Lokal", layout="wide")
ROOT = Path(__file__).parent
PAGES = ["Dashboard", "Workout-Analyse", "Power-Duration-Kurve", "Lauf: Pace & Critical Speed", "Performance Management (PMC)",
         "Erholung (HRV & Schlaf)", "Zeit in Zonen", "Profil & Phänotyp", "Fatigue Resistance", "Fortschritt", "Planung", "Athlet & Daten"]


# ---------------------------------------------------------------- Helfer
def agg_mmp(df: pd.DataFrame, key="mmp") -> dict[int, float]:
    out: dict[int, float] = {}
    for m in df[key]:
        for k, v in m.items():
            out[int(k)] = max(out.get(int(k), 0), v)
    return out


def mmp_fig(curves: dict[str, dict], mdl: model.PDModel | None = None, weight=None):
    fig = go.Figure()
    for name, c in curves.items():
        t = sorted(c)
        y = [c[x] / (weight or 1) for x in t]
        fig.add_scatter(x=t, y=y, name=name, mode="lines")
    if mdl:
        t = np.logspace(0.5, np.log10(7200), 200)
        fig.add_scatter(x=t, y=mdl.power(t) / (weight or 1), name="Modell", line=dict(dash="dash", color="black"))
    ticks = [1, 5, 15, 60, 300, 1200, 3600, 7200]
    fig.update_xaxes(type="log", tickvals=ticks, ticktext=["1s", "5s", "15s", "1m", "5m", "20m", "1h", "2h"], title="Dauer")
    fig.update_yaxes(title="W/kg" if weight else "Watt")
    fig.update_layout(height=450, hovermode="x unified", margin=dict(t=20))
    return fig


def fmt_pace(sec_per_km: float) -> str:
    if not sec_per_km or not np.isfinite(sec_per_km):
        return "–"
    m, sec = divmod(int(round(sec_per_km)), 60)
    return f"{m}:{sec:02d}"


def pace_of(speed_ms: float) -> float:
    return 1000 / speed_ms if speed_ms and speed_ms > 0 else float("nan")


def parse_pace(txt: str) -> float | None:
    """'4:45' -> 285 s/km"""
    try:
        m, sec = txt.strip().split(":")
        return int(m) * 60 + int(sec)
    except ValueError:
        return None


def run_threshold_pace() -> float | None:
    return db.threshold_on(str(date.today()), "run_pace", None)


def sidebar_filters():
    st.sidebar.title("WKO Lokal")
    page = st.sidebar.radio("Ansicht", PAGES)
    wk_all = db.workouts_df()
    if wk_all.empty:
        return page, wk_all, None
    sports = ["Alle"] + sorted(wk_all["sport"].unique())
    sport = st.sidebar.selectbox("Sportart", sports, index=0)
    presets = {"Letzte 28 Tage": 28, "Letzte 90 Tage": 90, "Letzte 180 Tage": 180, "Letzte 365 Tage": 365, "Alles": 99999}
    p = st.sidebar.selectbox("Zeitraum", list(presets) + ["Benutzerdefiniert"], index=1)
    if p == "Benutzerdefiniert":
        a, b = st.sidebar.date_input("Von – Bis", (date.today() - timedelta(days=90), date.today()))
    else:
        b, a = date.today(), date.today() - timedelta(days=presets[p])
    return page, db.workouts_df(str(a), str(b), sport), (a, b, sport)


def cur_ftp() -> float:
    return db.threshold_on(str(date.today()), "ftp", 200.0)


def cur_weight() -> float:
    return db.threshold_on(str(date.today()), "weight", 70.0)


def full_pmc() -> pd.DataFrame:
    """PMC bis einschließlich heute (Tage ohne Training zählen als 0 TSS)."""
    s = db.get_settings()
    a = daily_tss()
    if a.empty:
        return pmc.pmc(a)
    a = a.copy(); a.index = pd.to_datetime(a.index)
    t = pd.Timestamp(date.today())
    if a.index.max() < t:
        a.loc[t] = 0.0
    return pmc.pmc(a, float(s["ctl_tau"]), float(s["atl_tau"]))


def full_pmc_adj() -> pd.DataFrame:
    """PMC bis heute plus Spalten readiness_pts/tsb_adj (Form inkl. Schlaf/HRV/Ruhepuls)."""
    d = full_pmc()
    if d.empty:
        return d.assign(readiness_pts=0, tsb_adj=d.get("tsb"))
    return wellness.adjusted_form(d, db.wellness_df(str(date.today() - timedelta(days=200)), str(date.today())))


def planned_load() -> pd.Series:
    """Geplante TSS je Tag: Planeinträge + Wettkampf-TSS (nur wo kein Planeintrag am selben Tag liegt)."""
    pl = db.planned_df()
    ser = pl.groupby("date").tss.sum() if len(pl) else pd.Series(dtype=float)
    rc = db.races_df()
    for r in rc.itertuples():
        if r.tss and pd.notna(r.tss) and r.date not in ser.index:
            ser.loc[r.date] = float(r.tss)
    return ser


def forecast_all() -> pd.DataFrame | None:
    """Prognose-PMC über Plan und Wettkämpfe hinaus; None, wenn nichts Zukünftiges vorliegt."""
    ser, rc = planned_load(), db.races_df()
    future = [d for d in list(ser.index) + list(rc.date) if d > str(date.today())]
    if not future:
        return None
    s = db.get_settings()
    return pmc.forecast(daily_tss(), ser, max(future), ctl_tau=float(s["ctl_tau"]), atl_tau=float(s["atl_tau"]))


def recommendation_card() -> None:
    st.subheader("Trainingsempfehlung für morgen")
    feeling = st.radio("Wie fühlst Du Dich heute?", recommend.FEELINGS, index=1, horizontal=True, key="feeling",
                       help="Schlaf, HRV und Gesundheit kennt das Programm nicht – Dein Befinden fließt deshalb direkt ein.")
    today, s = date.today(), db.get_settings()
    recent = db.workouts_df(str(today - timedelta(days=28)), str(today))
    wdf = db.wellness_df(str(today - timedelta(days=40)), str(today))
    ready = wellness.readiness(wdf, today) if len(wdf) else None
    r = recommend.recommend(today, daily_tss(), recent, db.races_df(), db.planned_df(), cur_ftp(), run_threshold_pace(),
                            feeling, float(s["ctl_tau"]), float(s["atl_tau"]), ready)
    with st.container(border=True):
        {"good": st.success, "info": st.info, "warn": st.warning}[r.level](f"**{r.headline}**")
        c = st.columns(3)
        if r.duration_min: c[0].metric("Dauer", f"{r.duration_min[0]}–{r.duration_min[1]} min")
        if r.tss is not None: c[1].metric("Geschätzte TSS", f"{r.tss[0]}–{r.tss[1]}" if r.tss[1] else "0")
        if r.details: st.markdown("\n".join(f"- {x}" for x in r.details))
        if r.plan_note: {"good": st.success, "info": st.info, "warn": st.warning}[r.plan_note[0]](r.plan_note[1], icon=insights.ICON[r.plan_note[0]])
        if ready and ready["state"] != "unknown":
            {"ok": st.success, "reduced": st.warning, "low": st.error}[ready["state"]](
                ready["items"][0].text + " (Details: Ansicht „Erholung“)", icon=insights.ICON[ready["items"][0].level])
        elif ready is None:
            st.caption("Noch keine Schlaf-/HRV-Daten: Garmin-Sync ausführen, dann fließen sie in die Empfehlung ein.")
        with st.expander("Warum diese Empfehlung?"):
            st.markdown("\n".join(f"- {x}" for x in r.reasons))
            st.caption("Regelbasiert aus Belastungshistorie (Form, harte Einheiten, Wettkämpfe, Plan) und Deinem Befinden. "
                       "Keine Kenntnis von Schlaf, HRV, Stress oder Terminen – im Zweifel auf den Körper hören. Keine medizinische Beratung.")


def show(items: list) -> None:
    """Kernaussage farbig, Details als Liste (siehe wkolocal/insights.py)."""
    if not items:
        return
    head, rest = items[0], items[1:]
    {"good": st.success, "info": st.info, "warn": st.warning, "bad": st.error}[head.level](head.text, icon=insights.ICON[head.level])
    if rest:
        st.markdown("\n".join(f"- {insights.ICON[i.level]} {i.text}" for i in rest))
    st.caption("Automatische Einordnung nach Faustregeln – ersetzt keine Trainingsberatung; individuell kann es abweichen.")


def explain(key: str) -> None:
    with st.expander("Wie lese ich diese Ansicht?"):
        st.markdown(insights.EXPLAIN[key])


def daily_tss(sport="Alle") -> pd.Series:
    w = db.workouts_df(sport=sport)
    return w.groupby("date")["tss"].sum() if len(w) else pd.Series(dtype=float)


# ---------------------------------------------------------------- Seiten
def page_dashboard(wk, rng):
    st.header("Dashboard")
    s = db.get_settings()
    d = full_pmc_adj()
    recommendation_card()
    fc = forecast_all()
    rc = db.races_df()
    if fc is not None and len(rc):
        show(insights.assess_races(fc, rc, date.today()))
    explain("Dashboard")
    sport = rng[2]
    recent = db.workouts_df(str(date.today() - timedelta(days=28)), str(date.today()), sport)
    prev = db.workouts_df(str(date.today() - timedelta(days=56)), str(date.today() - timedelta(days=29)), sport)
    show(insights.assess_dashboard(recent, prev, d))
    last = d.iloc[-1]
    has_adj = bool(d.readiness_pts.iloc[-3:].any())
    c = st.columns(7 if has_adj else 6)
    c[0].metric("CTL (Fitness)", f"{last.ctl:.0f}", f"{last.ramp:+.1f}/Woche")
    c[1].metric("ATL (Ermüdung)", f"{last.atl:.0f}")
    c[2].metric("TSB (Form, Last)", f"{last.tsb:+.0f}")
    k = 3
    if has_adj:
        c[3].metric("Form inkl. Erholung", f"{last.tsb_adj:+.0f}", f"{last.tsb_adj - last.tsb:+.0f} (Schlaf/HRV/Ruhepuls)", delta_color="off" if last.tsb_adj == last.tsb else "inverse")
        k = 4
    c[k].metric("Workouts", len(wk))
    c[k + 1].metric("Stunden", f"{wk.duration_s.sum() / 3600:.1f}")
    c[k + 2].metric("TSS", f"{wk.tss.sum():.0f}")
    mm = agg_mmp(wk)
    m = model.fit_pd(mm)
    if m:
        c = st.columns(5)
        c[0].metric("mFTP", f"{m.mftp:.0f} W", f"{m.mftp / cur_weight():.2f} W/kg")
        c[1].metric("FRC", f"{m.frc / 1000:.1f} kJ")
        c[2].metric("Pmax", f"{m.pmax:.0f} W")
        c[3].metric("Stamina-Abfall", f"{m.stamina * 100:.1f} %")
        c[4].metric("FTP (hinterlegt)", f"{cur_ftp():.0f} W")
    left, right = st.columns(2)
    wkly = wk.assign(Woche=pd.to_datetime(wk.date).dt.to_period("W").dt.start_time).groupby(["Woche", "sport"]).agg(
        TSS=("tss", "sum")).reset_index()
    left.plotly_chart(px.bar(wkly, x="Woche", y="TSS", color="sport", title="Wochen-TSS nach Sportart"), width="stretch")
    dd = d.loc[str(rng[0]):]
    f = go.Figure([go.Scatter(x=dd.index, y=dd[k], name=n) for k, n in (("ctl", "CTL"), ("atl", "ATL"), ("tsb", "TSB"))])
    f.update_layout(title="PMC", margin=dict(t=40))
    right.plotly_chart(f, width="stretch")
    st.plotly_chart(mmp_fig({"Zeitraum": mm}, m, None), width="stretch")


def page_workout(wk, rng):
    st.header("Workout-Analyse")
    wk = wk.sort_values("start_time", ascending=False)
    labels = {r.uid: f"{r.start_time[:16]}  {r['name']}  ({r.duration_s / 60:.0f} min, {r.tss:.0f} TSS)" for _, r in wk.iterrows()}
    uid = st.selectbox("Workout", list(labels), format_func=labels.get)
    w = wk[wk.uid == uid].iloc[0]
    df = db.load_stream(uid)
    if w.sport == "Running":
        run_view(w, df)
        return
    ftp = w.ftp_used or cur_ftp()
    explain("Workout-Analyse")
    intent = st.selectbox("Ziel dieser Einheit", ["Automatisch", *insights.RIDE_TYPES],
                          help="Bewertet wird gegen das Ziel. Bei 'Automatisch' wird der Typ aus Intensität und Intervallen erkannt.")
    if w.tss_method == "power":
        show(insights.assess_ride(w, df, ftp, intent))
        prior = db.workouts_df(str(date.fromisoformat(w.date) - timedelta(days=90)), w.date, w.sport)
        st.markdown("**Vergleich mit den letzten 90 Tagen**")
        show(insights.compare_to_history(w, prior))
    c = st.columns(8)
    for col, (lbl, v) in zip(c, [("Dauer", f"{w.duration_s // 3600}:{w.duration_s % 3600 // 60:02d}h"),
                                  ("Ø Watt", f"{w.avg_power:.0f}" if w.avg_power else "–"),
                                  ("NP", f"{w.np:.0f}" if w.np else "–"), ("IF", f"{w.if_:.2f}" if w.if_ else "–"),
                                  ("TSS", f"{w.tss:.0f}"), ("VI", f"{w.vi:.2f}" if w.vi else "–"),
                                  ("kJ", f"{w.work_kj:.0f}" if w.work_kj else "–"),
                                  ("Pw:HR", f"{w.decoupling:.1f} %" if pd.notna(w.decoupling) else "–")]):
        col.metric(lbl, v)
    smooth = st.slider("Glättung (s)", 1, 60, 10)
    t = df.index / 60
    fig = go.Figure()
    if (df.power > 0).any():
        fig.add_scatter(x=t, y=df.power.rolling(smooth, min_periods=1).mean(), name="Watt", line=dict(color="#d62728", width=1))
        fig.add_hline(y=ftp, line_dash="dot", annotation_text=f"FTP {ftp:.0f}")
    if df.hr.notna().any():
        fig.add_scatter(x=t, y=df.hr.rolling(smooth, min_periods=1).mean(), name="HR", yaxis="y2", line=dict(color="#1f77b4", width=1))
    if df.altitude.notna().any():
        fig.add_scatter(x=t, y=df.altitude, name="Höhe", yaxis="y3", fill="tozeroy", opacity=.15, line=dict(color="gray"))
    fig.update_layout(height=420, xaxis_title="min", yaxis=dict(title="Watt"),
                      yaxis2=dict(overlaying="y", side="right", title="HR"),
                      yaxis3=dict(overlaying="y", visible=False), hovermode="x unified", margin=dict(t=20))
    st.plotly_chart(fig, width="stretch")
    if not (df.power > 0).any():
        st.info("Keine Leistungsdaten – es sind nur HR-basierte Werte verfügbar.")
        return
    tabs = st.tabs(["Intervalle", "Zonen", "Quadranten", "W'-Bilanz (FRC)", "Mean-Max"])
    with tabs[0]:
        thr = st.slider("Schwelle (% FTP)", 60, 150, 90) / 100 * ftp
        iv = metrics.detect_intervals(df.power.to_numpy(), thr, min_s=st.slider("Mindestdauer (s)", 15, 600, 60))
        iv["Ø % FTP"] = (iv["Ø_W"] / ftp * 100).round() if len(iv) else []
        st.dataframe(iv.round(0), width="stretch", hide_index=True)
    with tabs[1]:
        a, b = st.columns(2)
        z = metrics.time_in_zones(df.power.to_numpy(), ftp)
        a.plotly_chart(px.bar(z, x="Zone", y="Sekunden", title=f"Leistungszonen (FTP {ftp:.0f} W)"), width="stretch")
        a.dataframe(z, hide_index=True)
        lthr = db.threshold_on(w.date, "lthr", None)
        if lthr and df.hr.notna().any():
            zh = metrics.time_in_zones(df.hr.to_numpy(), lthr, metrics.HR_ZONES)
            b.plotly_chart(px.bar(zh, x="Zone", y="Sekunden", title=f"HR-Zonen (LTHR {lthr:.0f})"), width="stretch")
    with tabs[2]:
        q = metrics.quadrant_analysis(df.power.to_numpy(), df.cadence.to_numpy(), ftp, float(db.get_settings()["crank_mm"]))
        if len(q["aepf"]):
            idx = np.random.default_rng(0).choice(len(q["aepf"]), min(4000, len(q["aepf"])), replace=False)
            f = px.scatter(x=q["cpv"][idx], y=q["aepf"][idx], opacity=.3, labels=dict(x="CPV (m/s)", y="AEPF (N)"))
            f.add_vline(x=q["cpv_ref"]); f.add_hline(y=q["aepf_ref"])
            a, b = st.columns([2, 1])
            a.plotly_chart(f, width="stretch")
            b.dataframe(pd.DataFrame(q["share"], index=["% Zeit"]).T.round(1))
            b.caption("QI: hohe Kraft/hohe Geschw. · QII: hohe Kraft/niedrige Geschw. · QIII: Erholung · QIV: niedrige Kraft/hohe Geschw. Referenz: FTP bei 90 U/min.")
        else:
            st.info("Keine Kadenzdaten.")
    with tabs[3]:
        mdl = model.fit_pd(agg_mmp(db.workouts_df(str(date.fromisoformat(w.date) - timedelta(days=90)), w.date)))
        cp = st.number_input("CP / mFTP (W)", 50.0, 600.0, float(mdl.mftp if mdl else ftp))
        wp = st.number_input("W' / FRC (J)", 2000.0, 60000.0, float(mdl.frc if mdl else 20000))
        wb = metrics.wbal(df.power.to_numpy(), cp, wp)
        f = go.Figure(go.Scatter(x=t, y=wb / 1000, fill="tozeroy"))
        f.update_layout(yaxis_title="kJ verbleibend", xaxis_title="min", height=300)
        st.plotly_chart(f, width="stretch")
        st.caption(f"Minimum: {wb.min() / 1000:.1f} kJ ({(1 - wb.min() / wp) * 100:.0f} % von W' verbraucht). Integralmodell.")
    with tabs[4]:
        st.plotly_chart(mmp_fig({"Workout": w.mmp}), width="stretch")


def run_view(w, df):
    sp = metrics.get_speed(df)
    rp = db.threshold_on(w.date, "run_pace", None)
    explain("Lauf")
    show(insights.assess_run(w, df, rp))
    if w.tss_method == "pace":
        st.markdown("**Vergleich mit den letzten 90 Tagen**")
        show(insights.compare_to_history(w, db.workouts_df(str(date.fromisoformat(w.date) - timedelta(days=90)), w.date, "Running")))
    c = st.columns(8)
    avg_pace = pace_of(w.avg_speed) if w.avg_speed else None
    for col, (lbl, v) in zip(c, [("Dauer", f"{w.duration_s // 3600}:{w.duration_s % 3600 // 60:02d}h"),
                                  ("Distanz", f"{sp.sum() / 1000:.2f} km"), ("Ø Pace", f"{fmt_pace(avg_pace)} /km"),
                                  ("NGP", f"{fmt_pace(pace_of(w.ngp))} /km" if w.ngp else "–"),
                                  ("rIF", f"{w.if_:.2f}" if pd.notna(w.if_) else "–"),
                                  (f"TSS ({w.tss_method})", f"{w.tss:.0f}"), ("Ø HR", f"{w.avg_hr:.0f}" if pd.notna(w.avg_hr) else "–"),
                                  ("Pace:HR-Entk.", f"{w.decoupling:.1f} %" if pd.notna(w.decoupling) else "–")]):
        col.metric(lbl, v)
    if w.tss_method == "hr":
        st.warning("Keine Schwellenpace hinterlegt – TSS ist nur eine grobe HR-Näherung. Pace unter 'Athlet & Daten' eintragen und neu berechnen.")
    smooth = st.slider("Glättung (s)", 1, 60, 15)
    t = df.index / 60
    sm = pd.Series(sp).rolling(smooth, min_periods=1).mean().to_numpy()
    pace = np.where(sm > 0.5, 1000 / np.maximum(sm, 0.5) / 60, np.nan)       # min/km
    fig = go.Figure()
    fig.add_scatter(x=t, y=np.clip(pace, 2.5, 10), name="Pace", line=dict(color="#2ca02c", width=1),
                    text=[fmt_pace(x * 60) if np.isfinite(x) else "" for x in pace], hovertemplate="%{text} /km")
    if rp: fig.add_hline(y=rp / 60, line_dash="dot", annotation_text=f"Schwelle {fmt_pace(rp)}")
    if df.hr.notna().any():
        fig.add_scatter(x=t, y=df.hr.rolling(smooth, min_periods=1).mean(), name="HR", yaxis="y2", line=dict(color="#1f77b4", width=1))
    if df.altitude.notna().any():
        fig.add_scatter(x=t, y=df.altitude, name="Höhe", yaxis="y3", fill="tozeroy", opacity=.15, line=dict(color="gray"))
    fig.update_layout(height=420, xaxis_title="min", yaxis=dict(title="min/km", autorange="reversed"),
                      yaxis2=dict(overlaying="y", side="right", title="HR"), yaxis3=dict(overlaying="y", visible=False),
                      hovermode="x unified", margin=dict(t=20))
    st.plotly_chart(fig, width="stretch")
    tabs = st.tabs(["Splits", "Pace-Zonen", "HR-Zonen", "Bestzeiten"])
    with tabs[0]:
        spl = metrics.km_splits(sp, df.hr.to_numpy(float), df.altitude.to_numpy(float))
        if spl.empty:
            st.info("Weniger als 1 km.")
        else:
            spl["Pace"] = spl["Pace_s_km"].map(fmt_pace)
            st.plotly_chart(px.bar(spl, x="km", y="Pace_s_km", hover_data=["Pace"], title="Pace je km (s/km, niedriger = schneller)"), width="stretch")
            st.dataframe(spl.drop(columns=["Pace_s_km"]).round(0), hide_index=True)
    with tabs[1]:
        if rp:
            z = metrics.time_in_zones(sp, 1000 / rp, metrics.PACE_ZONES)
            z["von"] = z["von"].map(lambda v: f"{fmt_pace(1000 / v)}" if v else "–")
            z["bis"] = z["bis"].map(lambda v: f"{fmt_pace(1000 / v)}" if v else "schneller")
            z = z.rename(columns={"von": "langsamer als", "bis": "schneller als"})
            st.plotly_chart(px.bar(z, x="Zone", y="Sekunden"), width="stretch"); st.dataframe(z, hide_index=True)
            st.caption("Zonengrenzen als % der Schwellengeschwindigkeit (Näherung). Pausen (v≈0) zählen in Z1.")
        else:
            st.info("Schwellenpace fehlt.")
    with tabs[2]:
        lthr = db.threshold_on(w.date, "lthr_run", db.threshold_on(w.date, "lthr", None))
        if lthr and df.hr.notna().any():
            zh = metrics.time_in_zones(df.hr.to_numpy(), lthr, metrics.HR_ZONES)
            st.plotly_chart(px.bar(zh, x="Zone", y="Sekunden", title=f"LTHR {lthr:.0f}"), width="stretch")
        else:
            st.info("Lauf-LTHR oder HR-Daten fehlen.")
    with tabs[3]:
        rows = [(f"{d // 60} min" if d >= 60 else f"{d} s", fmt_pace(pace_of(w.smm.get(str(d)))), round(w.smm[str(d)] * d))
                for d in (60, 300, 600, 1200, 1800, 3600) if str(d) in w.smm]
        st.dataframe(pd.DataFrame(rows, columns=["Dauer", "Pace /km", "Distanz m"]), hide_index=True)


def page_run(wk, rng):
    st.header("Lauf: Pace-Duration & Critical Speed")
    rw = db.workouts_df(str(rng[0]), str(rng[1]), "Running")
    if rw.empty:
        st.info("Keine Läufe im gewählten Zeitraum."); return
    best = {}
    for m in rw.smm:
        for k, v in m.items():
            best[int(k)] = max(best.get(int(k), 0), v)
    cs = model.fit_cs(best)
    explain("Lauf")
    show(insights.assess_run_page(cs, run_threshold_pace(), rw))
    fig = go.Figure()
    t = sorted(best)
    fig.add_scatter(x=t, y=[pace_of(best[x]) / 60 for x in t], name="Bestwerte")
    if cs:
        tt = np.logspace(np.log10(60), np.log10(7200), 100)
        fig.add_scatter(x=tt, y=1000 / cs.speed(tt) / 60, name="CS-Modell", line=dict(dash="dash", color="black"))
    fig.update_xaxes(type="log", tickvals=[60, 300, 600, 1200, 1800, 3600, 7200], ticktext=["1m", "5m", "10m", "20m", "30m", "1h", "2h"])
    fig.update_yaxes(title="min/km", autorange="reversed")
    fig.update_layout(height=430, hovermode="x unified", margin=dict(t=20))
    st.plotly_chart(fig, width="stretch")
    if cs:
        c = st.columns(4)
        c[0].metric("Critical Speed", f"{fmt_pace(cs.cs_pace_s_km)} /km"); c[1].metric("D'", f"{cs.dprime:.0f} m")
        c[2].metric("R² des Fits", f"{cs.r2:.3f}")
        rp = run_threshold_pace()
        c[3].metric("Schwellenpace (hinterlegt)", f"{fmt_pace(rp)} /km" if rp else "–")
        st.caption("2-Parameter-Modell aus Bestwerten 3–30 min. Ohne maximale Efforts in diesem Bereich wird CS unterschätzt. "
                   "Als Schwellenpace taugt meist ein Wert nahe CS (leicht langsamer).")
        rows = [(lbl, fmt_pace(1000 / float(cs.speed(sec))), fmt_pace(pace_of(best[sec])) if sec in best else "–")
                for lbl, sec in (("3 min", 180), ("5 min", 300), ("10 min", 600), ("20 min", 1200), ("30 min", 1800), ("60 min", 3600))]
        st.dataframe(pd.DataFrame(rows, columns=["Dauer", "Modell /km", "Bestwert /km"]), hide_index=True)
        if st.button(f"CS-Pace {fmt_pace(cs.cs_pace_s_km)} als Schwellenpace ab heute übernehmen"):
            db.add_threshold(str(date.today()), run_pace=round(cs.cs_pace_s_km)); st.success("Gespeichert – unter 'Athlet & Daten' neu berechnen.")
    else:
        st.warning("Zu wenige Bestwerte zwischen 3 und 30 min für das CS-Modell.")
    st.subheader("Umfang & Entwicklung")
    wkly = rw.assign(Woche=pd.to_datetime(rw.date).dt.to_period("W").dt.start_time)
    wkly["km"] = wkly.avg_speed.fillna(0) * wkly.duration_s / 1000
    g = wkly.groupby("Woche").agg(km=("km", "sum"), TSS=("tss", "sum")).reset_index()
    st.plotly_chart(px.bar(g, x="Woche", y="km", title="Wochenkilometer (Näherung aus Ø-Tempo)"), width="stretch")
    ef = rw.dropna(subset=["ef"])
    if len(ef):
        st.plotly_chart(px.scatter(ef, x="date", y="ef", trendline="lowess" if False else None,
                                   title="Efficiency Factor (m/min je Herzschlag) – steigend = aerobe Verbesserung"), width="stretch")


def page_pd(wk, rng):
    st.header("Power-Duration-Kurve & Modell")
    per_kg = st.toggle("W/kg", False)
    wt = cur_weight() if per_kg else None
    a, b = st.columns(2)
    comp = a.selectbox("Vergleichszeitraum", ["Keiner", "Vorherige gleiche Länge", "Letzte 365 Tage (Bestwerte)"])
    mm = agg_mmp(wk)
    curves = {"Auswahl": mm}
    if comp != "Keiner" and rng:
        s0, e0 = rng[0], rng[1]
        if comp.startswith("Vorherige"):
            span = (e0 - s0).days or 1
            o = db.workouts_df(str(s0 - timedelta(days=span)), str(s0 - timedelta(days=1)), rng[2])
        else:
            o = db.workouts_df(str(date.today() - timedelta(days=365)), str(date.today()), rng[2])
        curves[comp] = agg_mmp(o)
    mdl = model.fit_pd(mm)
    st.plotly_chart(mmp_fig(curves, mdl, wt), width="stretch")
    if len(curves) > 1 and mdl:
        cmp_name = [k for k in curves if k != "Auswahl"][0]
        rows = [(d, curves["Auswahl"].get(d), curves[cmp_name].get(d)) for d in (5, 60, 300, 1200, 3600)]
        txt = [f"{'%d s' % d if d < 60 else '%d min' % (d // 60)}: {a:.0f} W vs. {b:.0f} W ({(a / b - 1) * 100:+.1f} %)" for d, a, b in rows if a and b]
        if txt:
            show([insights.Insight("info", "Vergleich mit „" + cmp_name + "“ – " + " · ".join(txt) +
                                   ". Differenzen unter ±2 % sind Schwankung; ein höherer Wert zählt nur, wenn Du in beiden Zeiträumen maximal gefahren bist.")])
    if not mdl:
        st.warning("Zu wenige Daten für das Modell (benötigt Efforts > 10 min).")
        return
    explain("Power-Duration-Kurve")
    show(insights.assess_model(mdl, mm, cur_ftp(), cur_weight()))
    c = st.columns(5)
    c[0].metric("mFTP", f"{mdl.mftp:.0f} W"); c[1].metric("FRC", f"{mdl.frc / 1000:.1f} kJ")
    c[2].metric("Pmax", f"{mdl.pmax:.0f} W"); c[3].metric("P(60 min)", f"{mdl.ftp_60:.0f} W")
    c[4].metric("Modellfehler (RMSE)", f"{mdl.rmse:.0f} W")
    st.caption("Eigenes WKO-ähnliches Modell, nicht identisch mit WKO. Je weniger Maximalbelastungen im Zeitraum, desto unsicherer die Parameter.")
    l, r = st.columns(2)
    durs = [1, 5, 15, 30, 60, 120, 300, 600, 1200, 1800, 3600, 5400]
    tbl = pd.DataFrame([dict(Dauer=f"{d // 60}:{d % 60:02d}" if d >= 60 else f"{d}s", Bestwert=round(mm[d]) if d in mm else None,
                             Modell=round(float(mdl.power(d)))) for d in durs])
    tbl["W/kg"] = (tbl["Bestwert"] / cur_weight()).round(2)
    l.subheader("Bestwerte vs. Modell"); l.dataframe(tbl, hide_index=True)
    z = pd.DataFrame([(n, round(lo), round(hi) if hi else None) for n, lo, hi in mdl.zones()], columns=["Zone", "von W", "bis W"])
    r.subheader("Zonen (aus mFTP)"); r.dataframe(z, hide_index=True)
    if mdl.mftp != cur_ftp() and st.button(f"mFTP {mdl.mftp:.0f} W als FTP ab heute übernehmen"):
        db.add_threshold(str(date.today()), ftp=round(mdl.mftp)); st.success("Gespeichert. Unter 'Athlet & Daten' neu berechnen.")
    st.subheader("Intervall-Planer")
    dmin = st.slider("Intervalldauer (min)", 1, 60, 5)
    st.write(f"Modell-Maximalleistung für {dmin} min: **{float(mdl.power(dmin * 60)):.0f} W** "
             f"({float(mdl.power(dmin * 60)) / mdl.mftp * 100:.0f} % mFTP). Typisch trainierbar: 90–100 % davon bei Wiederholungen.")


def page_recovery(wk, rng):
    st.header("Erholung: HRV & Schlaf")
    explain("Erholung (HRV & Schlaf)")
    start = rng[0] if rng else date.today() - timedelta(days=90)
    w = db.wellness_df(str(min(start, date.today() - timedelta(days=60))), str(date.today()))
    if w.empty:
        st.info("Noch keine Schlaf-/HRV-Daten. In „Athlet & Daten“ **Garmin Connect** (mit Haken „HRV & Schlaf“) ausführen "
                "oder im Terminal `./sync.command wellness --days 90`. Nur Garmin-Geräte/-Konten liefern diese Daten.")
        return
    ready = wellness.readiness(w, date.today())
    show(ready["items"])
    w["d"] = pd.to_datetime(w.date)
    view = w[w.d >= pd.Timestamp(start)]
    # --- HRV
    f = go.Figure()
    tss = daily_tss(); tss.index = pd.to_datetime(tss.index)
    tv = tss[tss.index >= pd.Timestamp(start)]
    f.add_bar(x=tv.index, y=tv.values, name="TSS", marker_color="rgba(150,150,150,.25)", yaxis="y2")
    if view.hrv_low.notna().any() and view.hrv_high.notna().any():
        f.add_scatter(x=view.d, y=view.hrv_high, line=dict(width=0), showlegend=False, hoverinfo="skip")
        f.add_scatter(x=view.d, y=view.hrv_low, fill="tonexty", fillcolor="rgba(44,160,44,.15)", line=dict(width=0), name="Garmin-Normbereich", hoverinfo="skip")
    f.add_scatter(x=view.d, y=view.hrv_night, mode="lines+markers", name="HRV Nacht (ms)", line=dict(color="#1f77b4", width=1))
    f.add_scatter(x=view.d, y=w.set_index("d").hrv_night.rolling(7, min_periods=3).mean().reindex(view.d).values, name="7-Tage-Mittel", line=dict(color="#d62728", width=3))
    f.update_layout(title="HRV (Nacht) und Trainingslast", height=380, hovermode="x unified", yaxis=dict(title="ms"),
                    yaxis2=dict(overlaying="y", side="right", title="TSS", showgrid=False, tickformat=".0f", nticks=5, rangemode="tozero"), margin=dict(t=40))
    st.plotly_chart(f, width="stretch")
    # --- Schlaf
    sv = view.dropna(subset=["sleep_s"])
    g = go.Figure()
    for col, name, color in (("deep_s", "Tiefschlaf", "#08306b"), ("light_s", "Leichtschlaf", "#6baed6"), ("rem_s", "REM", "#9467bd"), ("awake_s", "Wach", "#d9d9d9")):
        if sv[col].notna().any(): g.add_bar(x=sv.d, y=sv[col] / 3600, name=name, marker_color=color)
    g.add_hline(y=7, line_dash="dot", annotation_text="7 h")
    if sv.sleep_score.notna().any():
        g.add_scatter(x=sv.d, y=sv.sleep_score, name="Schlafscore", yaxis="y2", mode="lines+markers", line=dict(color="#e6b800"))
    g.update_layout(barmode="stack", title="Schlaf", height=360, hovermode="x unified", yaxis=dict(title="Stunden"),
                    yaxis2=dict(overlaying="y", side="right", title="Score", range=[0, 100], showgrid=False, tickvals=[0, 25, 50, 75, 100]), margin=dict(t=40))
    st.plotly_chart(g, width="stretch")
    if view.resting_hr.notna().any():
        st.plotly_chart(px.line(view, x="d", y="resting_hr", markers=True, title="Ruhepuls (bpm)", labels=dict(d="", resting_hr="bpm")), width="stretch")
    t = view[["date", "sleep_s", "sleep_score", "hrv_night", "hrv_week", "hrv_status", "resting_hr"]].copy()
    t["Schlaf h"] = (t.pop("sleep_s") / 3600).round(1)
    st.dataframe(t.tail(14)[::-1], hide_index=True, width="stretch")


PRIO_COLOR = {"A": "#d62728", "B": "#ff7f0e", "C": "#7f7f7f"}


def races_manager() -> None:
    with st.expander("Wettkämpfe anlegen & verwalten", expanded=db.races_df().empty):
        with st.form("race"):
            c = st.columns(4)
            d = c[0].date_input("Datum", date.today() + timedelta(days=28))
            name = c[1].text_input("Name", "")
            sport = c[2].selectbox("Sportart", ["Cycling", "Running", "Other"], format_func={"Cycling": "Rad", "Running": "Lauf", "Other": "Sonstige"}.get)
            prio = c[3].selectbox("Priorität", ["A", "B", "C"], index=1, help="A = Hauptziel, B = wichtig, C = Training/Test")
            c = st.columns(3)
            dur = c[0].number_input("Erwartete Dauer (h)", 0.0, 24.0, 2.0, 0.25)
            iff = c[1].number_input("Erwartete Intensität (IF)", 0.5, 1.2, 0.85, 0.01, help="Rennen: ca. 0,85–1,0 je nach Dauer; je kürzer, desto höher.")
            c[2].metric("Geschätzte TSS", f"{dur * iff * iff * 100:.0f}")
            if st.form_submit_button("Wettkampf speichern"):
                if not name.strip():
                    st.error("Bitte einen Namen eingeben.")
                else:
                    db.add_race(str(d), name.strip(), sport, prio, dur, round(dur * iff * iff * 100), "")
                    st.rerun()
        rc = db.races_df()
        if len(rc):
            st.dataframe(rc[["id", "date", "name", "sport", "priority", "duration_h", "tss"]].rename(columns={
                "date": "Datum", "name": "Name", "sport": "Sportart", "priority": "Prio", "duration_h": "Dauer h", "tss": "TSS (Schätzung)"}),
                hide_index=True, width="stretch")
            rid = st.selectbox("Wettkampf löschen", [0, *rc.id], format_func=lambda i: "–" if i == 0 else f"{rc[rc.id == i].date.iloc[0]}  {rc[rc.id == i].name.iloc[0]}")
            if rid and st.button("Löschen"):
                db.delete_race(int(rid)); st.rerun()
        st.caption("Die TSS-Schätzung fließt in die Prognose ein (Dauer × IF² × 100). Wettkämpfe in der Vergangenheit erscheinen als Markierung im Verlauf; ihre echte Belastung kommt aus dem importierten Workout.")


def page_pmc(wk, rng):
    st.header("Performance Management Chart")
    st.caption("Alle Sportarten kombiniert (Rad-TSS aus Leistung, Lauf-rTSS aus Pace, sonst HR-Näherung).")
    explain("Performance Management (PMC)")
    with st.expander("Wettkämpfe – Hinweise"):
        st.markdown(insights.EXPLAIN["Wettkämpfe"])
    d = full_pmc_adj()
    show(insights.assess_pmc(d))
    if d.readiness_pts.iloc[-3:].any():
        adj = d.tsb_adj.iloc[-1] - d.tsb.iloc[-1]
        st.info(f"Form inkl. Erholungsdaten: **{d.tsb_adj.iloc[-1]:+.0f}** statt {d.tsb.iloc[-1]:+.0f} (Abzug {abs(adj):.0f} wegen Schlaf/HRV/Ruhepuls, siehe „Erholung“). "
                "Der Abzug ist eine Heuristik (5 Punkte je Warnsignal, max. 25) – CTL/ATL/TSB bleiben reine Trainingslast.", icon="ℹ️")
    races_manager()
    rc = db.races_df()
    fc = forecast_all()
    if fc is not None and len(rc):
        show(insights.assess_races(fc, rc, date.today()))
    v = fc if fc is not None else d.assign(geplant=False)
    start, end = pd.Timestamp(rng[0]), max(pd.Timestamp(rng[1]), v.index.max() if fc is not None else pd.Timestamp(rng[1]))
    v = v.loc[start:end]
    act, fut = v[~v.geplant], v[v.geplant]
    if len(fut) and len(act):
        fut = pd.concat([act.iloc[[-1]], fut])           # nahtloser Übergang
    f = go.Figure()
    f.add_bar(x=act.index, y=act.tss, name="TSS", marker_color="rgba(150,150,150,.4)")
    if len(fut): f.add_bar(x=fut.index[1:], y=fut.tss.iloc[1:], name="geplante TSS", marker_color="rgba(255,165,0,.45)")
    for col, name, color, kw in (("ctl", "CTL (Fitness)", "#1f77b4", {}), ("atl", "ATL (Ermüdung)", "#d62728", {}), ("tsb", "TSB (Form)", "#e6b800", dict(fill="tozeroy", opacity=.5))):
        f.add_scatter(x=act.index, y=act[col], name=name, line=dict(color=color), **kw)
        if len(fut): f.add_scatter(x=fut.index, y=fut[col], name=f"{name} – Prognose", line=dict(color=color, dash="dot"), showlegend=False)
    adj_part = d.loc[start:, "tsb_adj"] if "tsb_adj" in d else None
    if adj_part is not None and (d.readiness_pts.loc[start:] > 0).any():
        f.add_scatter(x=adj_part.index, y=adj_part, name="TSB inkl. Erholung", line=dict(color="#7b3294", width=2, dash="dash"))
    for r in rc.itertuples():
        x = pd.Timestamp(r.date)
        if start <= x <= end:
            col = PRIO_COLOR.get(r.priority, "#7f7f7f")
            f.add_shape(type="line", x0=x, x1=x, y0=0, y1=1, yref="paper", line=dict(color=col, width=2, dash="dash"))
            f.add_annotation(x=x, y=1, yref="paper", text=f"{r.priority}: {r.name}", showarrow=False, yanchor="bottom", font=dict(color=col))
    f.update_layout(height=540, hovermode="x unified", margin=dict(t=40))
    st.plotly_chart(f, width="stretch")
    if len(fut):
        st.caption("Gepunktet = Prognose aus Plan und Wettkampf-TSS (ab morgen). Ohne Planeinträge wird 0 TSS angenommen.")
    st.caption("TSB-Richtwerte: > +25 Detraining, +5…+25 Frische/Peaking, −10…+5 neutral, −30…−10 produktives Training, < −30 Überlastungsrisiko. Rampe: > 7 CTL/Woche gilt als aggressiv.")
    st.dataframe(d.tail(14).round(1)[::-1])


def page_zones(wk, rng):
    st.header("Zeit in Zonen")
    ftp = cur_ftp()
    tot = np.zeros(7); rows = []
    for _, w in wk.iterrows():
        if w.tss_method != "power": continue  # nur Rad
        z = metrics.time_in_zones(db.load_stream(w.uid).power.to_numpy(), w.ftp_used or ftp)["Sekunden"].to_numpy()
        tot += z
        rows.append(dict(Woche=pd.Timestamp(w.date).to_period("W").start_time, **{metrics.POWER_ZONES[i][0][:2]: z[i] / 3600 for i in range(7)}))
    if not rows: st.info("Keine Leistungsdaten."); return
    zn = [z[0] for z in metrics.POWER_ZONES]
    st.plotly_chart(px.bar(x=zn, y=tot / 3600, labels=dict(x="Zone", y="Stunden"), title="Gesamt"), width="stretch")
    wk_df = pd.DataFrame(rows).groupby("Woche").sum().reset_index().melt("Woche", var_name="Zone", value_name="Stunden")
    st.plotly_chart(px.bar(wk_df, x="Woche", y="Stunden", color="Zone", title="Pro Woche"), width="stretch")
    explain("Zeit in Zonen")
    show(insights.assess_zones(tot))
    pol = tot / max(tot.sum(), 1) * 100
    st.write(f"Polarisierung: Z1–2 **{pol[:2].sum():.0f} %**, Z3–4 **{pol[2:4].sum():.0f} %**, Z5–7 **{pol[4:].sum():.0f} %**")


def page_profile(wk, rng):
    st.header("Profil & Phänotyp")
    sex = db.get_settings()["sex"]; wt = cur_weight()
    mm = agg_mmp(wk)
    rows = profile.profile(mm, wt, sex)
    if not rows: st.info("Zu wenige Daten."); return
    df = pd.DataFrame(rows)
    explain("Profil & Phänotyp")
    show(insights.assess_profile(rows))
    st.plotly_chart(px.bar_polar(df, r="Score", theta="Dauer", range_r=[0, 100], color="Score", height=420)
                    if False else px.bar(df, x="Dauer", y="Score", text="Level", range_y=[0, 100]), width="stretch")
    st.dataframe(df[["Dauer", "Watt", "WperKg", "Score", "Level"]], hide_index=True)
    ph, desc = profile.phenotype(rows)
    st.subheader(f"Phänotyp: {ph}"); st.write(desc)
    st.caption("Referenzwerte: Näherung an die übliche Power-Profile-Tabelle (siehe profile.py), Phänotyp-Regeln heuristisch – nicht WKOs Phänotyp-Modell.")


def page_fatigue(wk, rng):
    st.header("Fatigue Resistance")
    tbl = profile.fatigue_resistance(list(wk.fatigue))
    explain("Fatigue Resistance")
    if not tbl: st.info("Keine Daten."); return
    show(insights.assess_fatigue(tbl))
    f = go.Figure()
    for d, v in tbl.items():
        kjs = sorted(v)
        f.add_scatter(x=kjs, y=[v[k][1] for k in kjs], name=f"{d // 60} min" if d >= 60 else f"{d} s", mode="lines+markers")
    f.update_layout(xaxis_title="Vorab geleistete Arbeit (kJ)", yaxis_title="% des frischen Bestwerts", height=420)
    st.plotly_chart(f, width="stretch")
    rows = [dict(Dauer=d, **{f"{k} kJ": f"{v[k][0]:.0f} W ({v[k][1]:.0f} %)" for k in sorted(v)}) for d, v in tbl.items()]
    st.dataframe(pd.DataFrame(rows), hide_index=True)
    st.caption("Bestleistung nach X kJ Vorbelastung im gewählten Zeitraum. Fehlende Werte = keine so langen Workouts.")


def page_progress(wk, rng):
    st.header("Fortschritt")
    all_w = db.workouts_df(sport=rng[2] if rng else None)
    if all_w.empty: return
    win = st.slider("Fensterlänge für Modell (Tage)", 42, 180, 90)
    pts, d = [], pd.to_datetime(all_w.date).min() + timedelta(days=win)
    while d <= pd.Timestamp(date.today()):
        sub = all_w[(pd.to_datetime(all_w.date) > d - timedelta(days=win)) & (pd.to_datetime(all_w.date) <= d)]
        mm = agg_mmp(sub)
        m = model.fit_pd(mm)
        row = dict(Datum=d, **{f"{k}s": mm.get(k) for k in (5, 60, 300, 1200, 3600)})
        if m: row.update(mFTP=m.mftp, FRC=m.frc / 1000, Pmax=m.pmax)
        pts.append(row); d += timedelta(days=7)
    df = pd.DataFrame(pts)
    if "mFTP" not in df: st.info("Zu wenige Daten für Modelltrends."); return
    explain("Fortschritt")
    show(insights.assess_progress(df))
    for col, title in (("mFTP", "mFTP (W)"), ("FRC", "FRC (kJ)"), ("Pmax", "Pmax (W)")):
        st.plotly_chart(px.line(df, x="Datum", y=col, title=title, markers=True), width="stretch")
    best = df.melt("Datum", ["5s", "60s", "300s", "1200s", "3600s"], var_name="Dauer", value_name="Watt")
    st.plotly_chart(px.line(best, x="Datum", y="Watt", color="Dauer", title=f"Bestwerte (gleitendes {win}-Tage-Fenster)"), width="stretch")


def page_plan(wk, rng):
    st.header("Planung")
    explain("Planung")
    s = db.get_settings()
    act = daily_tss()
    base = full_pmc()
    ctl0 = base.ctl.iloc[-1] if len(base) else 0
    with st.expander("Aufbauplan generieren (CTL-Ziel)", expanded=True):
        c = st.columns(5)
        target = c[0].number_input("Ziel-CTL", 10, 250, int(ctl0 + 10))
        weeks = c[1].number_input("Wochen", 2, 52, 8)
        rec = c[2].number_input("Erholungswoche alle n", 0, 8, 4)
        start = c[3].date_input("Start (Montag)", date.today() + timedelta(days=(7 - date.today().weekday()) % 7))
        days = c[4].multiselect("Trainingstage", ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"], ["Di", "Do", "Sa", "So"])
        loads = pmc.ramp_plan(ctl0, target, int(weeks), int(rec))
        st.write("Wochen-TSS:", ", ".join(map(str, loads)), f"(aktuelle CTL {ctl0:.0f})")
        if st.button("Plan speichern (ersetzt künftige Einträge)") and days:
            db.clear_planned_from(str(start))
            idx = [["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"].index(d) for d in days]
            share = np.array([1.0 if i in (5, 6) else 0.7 for i in idx]); share /= share.sum()
            for wi, L in enumerate(loads):
                for i, sh in zip(idx, share):
                    db.add_planned(str(start + timedelta(days=wi * 7 + i)), "Training", round(L * sh))
            st.success("Gespeichert.")
    with st.expander("Einzelnes Workout planen"):
        c = st.columns(4)
        d = c[0].date_input("Datum", date.today() + timedelta(days=1)); n = c[1].text_input("Name", "Intervalle")
        t = c[2].number_input("Geplante TSS", 0, 600, 80)
        if c[3].button("Hinzufügen"): db.add_planned(str(d), n, t)
    pl = db.planned_df()
    if len(pl):
        until = st.date_input("Prognose bis", pd.to_datetime(pl.date).max().date())
        planned = planned_load()
        fc = pmc.forecast(act, planned, str(max(until, pd.to_datetime(planned.index).max().date())), ctl_tau=float(s["ctl_tau"]), atl_tau=float(s["atl_tau"]))
        fc = fc.loc[str(date.today() - timedelta(days=60)):]
        show(insights.assess_plan(fc))
        f = go.Figure()
        for k, n in (("ctl", "CTL"), ("atl", "ATL"), ("tsb", "TSB")):
            f.add_scatter(x=fc.index, y=fc[k], name=n)
        f.add_bar(x=fc.index, y=fc.tss.where(fc.geplant), name="geplante TSS", marker_color="rgba(255,165,0,.5)")
        f.update_layout(height=450, hovermode="x unified"); st.plotly_chart(f, width="stretch")
        st.write(f"Prognose {until}: CTL **{fc.ctl.iloc[-1]:.0f}**, ATL {fc.atl.iloc[-1]:.0f}, TSB {fc.tsb.iloc[-1]:+.0f}")
        edit = st.data_editor(pl, hide_index=True, disabled=["id"], width="stretch")
        dl = st.number_input("ID zum Löschen", 0, int(pl.id.max()), 0)
        if st.button("Eintrag löschen") and dl: db.delete_planned(int(dl)); st.rerun()


GARMIN_LOG = config.ROOT / "garmin_sync.log"
GARMIN_MFA = config.ROOT / "garmin_mfa.txt"


def start_garmin(days: int, env: dict, with_wellness: bool = True) -> None:
    """Garmin-Sync als Hintergrundprozess; fragt bei 2FA über das Eingabefeld (garmin_status) nach dem Code."""
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
            st.warning("Garmin hat einen 2FA-Code an Dich geschickt (E-Mail/Authenticator). Bitte hier eingeben:")
            with st.form("mfa"):
                code = st.text_input("2FA-Code")
                if st.form_submit_button("Code senden") and code.strip():
                    GARMIN_MFA.write_text(code.strip())
                    st.session_state["mfa_sent"] = True
        else:
            st.info("Garmin-Sync läuft … " + shown[-300:])
    else:
        (st.success if p.returncode == 0 else st.error)(shown or "Fertig.")


def page_athlete(wk, rng):
    st.header("Athlet & Daten")
    s = db.get_settings()
    explain("Athlet & Daten")
    show(insights.assess_data(db.workouts_df(), db.thresholds_df(), date.today()))
    a, b = st.columns(2)
    with a:
        st.subheader("Schwellenwerte (mit Datum)")
        with st.form("thr"):
            c = st.columns(3)
            d = c[0].date_input("Gültig ab", date.today())
            ftp = c[1].number_input("Rad-FTP (W)", 0, 600, int(cur_ftp()))
            kg = c[2].number_input("Gewicht (kg)", 30.0, 150.0, float(cur_weight()))
            c = st.columns(3)
            lthr = c[0].number_input("Rad-LTHR (bpm)", 0, 230, int(db.threshold_on(str(date.today()), "lthr", 0) or 0))
            lthr_run = c[1].number_input("Lauf-LTHR (bpm)", 0, 230, int(db.threshold_on(str(date.today()), "lthr_run", 0) or 0))
            rp0 = run_threshold_pace()
            rp_txt = c[2].text_input("Lauf-Schwellenpace (min:sek /km)", fmt_pace(rp0) if rp0 else "")
            if st.form_submit_button("Speichern"):
                rp = parse_pace(rp_txt) if rp_txt else None
                if rp_txt and rp is None:
                    st.error("Pace-Format: 4:45")
                else:
                    db.add_threshold(str(d), ftp or None, lthr or None, kg, rp, lthr_run or None); st.rerun()
        st.dataframe(db.thresholds_df(), hide_index=True)
        if st.button("Alle Workouts (Rad + Lauf) mit Schwellenwert-Verlauf neu berechnen"):
            st.success(f"{ingest.recompute_all()} Workouts neu berechnet.")
    with b:
        st.subheader("Einstellungen")
        sex = st.selectbox("Geschlecht (Profilreferenz)", ["m", "f"], index=["m", "f"].index(s["sex"]))
        rest = st.number_input("Ruhepuls", 30, 100, int(s["rest_hr"]))
        crank = st.number_input("Kurbellänge (mm)", 150.0, 185.0, float(s["crank_mm"]))
        if st.button("Einstellungen speichern"):
            for k, v in dict(sex=sex, rest_hr=rest, crank_mm=crank).items(): db.set_setting(k, v)
            st.success("OK")
    st.subheader("Daten laden")
    c = st.columns(4)
    days = c[0].number_input("Tage zurück", 1, 3650, 30)
    env = dict(os.environ)
    if not any(config.TOKEN_DIR.glob("*")):
        st.info("Garmin ist noch nicht angemeldet: E-Mail und Passwort eingeben und „Garmin Connect“ klicken. Bei aktivierter 2FA erscheint "
                "danach ein Feld für den Code. Das Passwort wird nicht gespeichert, nur das Anmelde-Token (data/garmin_tokens).")
        ge, gp = st.columns(2)
        em, pw = ge.text_input("Garmin E-Mail"), gp.text_input("Garmin Passwort", type="password")
        if em and pw:
            env.update(GARMIN_EMAIL=em, GARMIN_PASSWORD=pw)
    wl = st.checkbox("HRV & Schlaf mitladen", True, help="Zusätzliche Abrufe pro Tag (ca. 1 s je Tag). Beim ersten Mal mit vielen Tagen dauert das einige Minuten.")
    if c[1].button("Garmin Connect"):
        start_garmin(days, env, wl)
    runs = {"TrainingPeaks": ["trainingpeaks", "--days", str(days)], f"Inbox-Ordner ({config.INBOX})": ["folder"]}
    for col, (lbl, args) in zip(c[2:], runs.items()):
        if col.button(lbl):
            r = subprocess.run([sys.executable, str(ROOT / "sync.py"), *args], capture_output=True, text=True, stdin=subprocess.DEVNULL, env=env)
            (st.success if r.returncode == 0 else st.error)(r.stdout + r.stderr)
    garmin_status()
    up = st.file_uploader("Dateien hochladen (FIT/TCX/GPX/CSV/ZIP)", accept_multiple_files=True)
    if up and st.button("Hochgeladene Dateien importieren"):
        config.ensure_dirs(); tot = [0, 0, []]
        for f in up:
            p = config.INBOX / f.name; p.write_bytes(f.getvalue())
            n, k, e = ingest.import_path(p, "upload"); tot[0] += n; tot[1] += k; tot[2] += e
        st.write(f"{tot[0]} neu, {tot[1]} Duplikate"); [st.error(e) for e in tot[2]]
    if len(wk):
        st.subheader("Workouts")
        view = wk[["uid", "start_time", "sport", "name", "source", "duration_s", "np", "tss", "tss_method"]].copy()
        st.dataframe(view[::-1], hide_index=True, width="stretch")
        d = st.selectbox("Workout löschen", [""] + list(wk.uid))
        if d and st.button("Löschen"): db.delete_workout(d); st.rerun()


POWER_PAGES = {"Power-Duration-Kurve", "Zeit in Zonen", "Profil & Phänotyp", "Fatigue Resistance"}


def main():
    page, wk, rng = sidebar_filters()
    if rng is None:
        st.title("WKO Lokal")
        st.info("Noch keine Daten. Terminal: `python sync.py garmin`, Dateien nach `data/inbox/` + `python sync.py folder`, "
                "oder `python sync.py demo` für Beispieldaten – oder hier direkt hochladen:")
        page_athlete(wk, rng); return
    if wk.empty and page != "Athlet & Daten":
        st.warning("Keine Workouts im gewählten Zeitraum/Sport."); return
    if page in POWER_PAGES and not wk.empty and not (wk.tss_method == "power").any():
        st.info("Im gewählten Zeitraum/Sport gibt es keine Rad-Workouts mit Leistungsdaten. Für Läufe siehe 'Lauf: Pace & Critical Speed'.")
        return
    dict(zip(PAGES, [page_dashboard, page_workout, page_pd, page_run, page_pmc, page_recovery, page_zones, page_profile, page_fatigue,
                     page_progress, page_plan, page_athlete]))[page](wk, rng)


main()
