import numpy as np
import pytest

from wkolocal import metrics, model, pmc


def test_np_constant_equals_power():
    assert metrics.normalized_power(np.full(600, 200)) == pytest.approx(200)


def test_tss_one_hour_at_ftp_is_100():
    _, tss = metrics.tss_power(250, 3600, 250)
    assert tss == pytest.approx(100)


def test_mean_max():
    p = np.concatenate([np.full(100, 100), np.full(60, 300), np.full(100, 100)])
    m = metrics.mean_max(p, [1, 60, 260])
    assert m[1] == 300 and m[60] == pytest.approx(300) and m[260] == pytest.approx(p.mean() * 1)


def test_pmc_steady_state():
    df = pmc.pmc(__import__("pandas").Series([100.0] * 400, index=__import__("pandas").date_range("2024-01-01", periods=400)))
    assert df["ctl"].iloc[-1] == pytest.approx(100, abs=0.1) and df["tsb"].iloc[-1] == pytest.approx(0, abs=0.1)


def test_pd_fit_recovers_params():
    t = np.array(sorted(set(metrics.DURATIONS[metrics.DURATIONS <= 3600])), float)
    y = model.pd_model(t, 260, 20000, 1100)
    m = model.fit_pd({int(a): float(b) for a, b in zip(t, y)})
    assert m.mftp == pytest.approx(260, rel=0.05) and m.frc == pytest.approx(20000, rel=0.15)
    assert m.pmax == pytest.approx(1100, rel=0.1)


def test_wbal_drops_and_recovers():
    p = np.concatenate([np.full(120, 400), np.full(600, 100)])
    w = metrics.wbal(p, 250, 20000)
    assert w[119] < 20000 - 15000 and w[-1] > w[119]


def test_quadrants_sum_100():
    r = metrics.quadrant_analysis(np.random.default_rng(0).uniform(100, 400, 500), np.full(500, 90.0), 250)
    assert sum(r["share"].values()) == pytest.approx(100)


def test_intervals():
    p = np.concatenate([np.full(300, 100), np.full(300, 300), np.full(300, 100)])
    iv = metrics.detect_intervals(p, 250)
    assert len(iv) == 1 and abs(iv["Dauer_s"].iloc[0] - 300) <= 10


def test_running_metrics():
    v = np.full(3600, 3.5)                      # 4:46/km konstant, flach
    ngp = metrics.normalized_graded_pace(v, np.full(3600, 100.0))
    assert ngp == pytest.approx(3.5, rel=0.01)
    _, tss = metrics.tss_pace(3.5, 3600, 3.5)
    assert tss == pytest.approx(100)
    up = metrics.grade_adjusted_speed(np.full(600, 3.0), np.linspace(0, 180, 600))  # ca. +10 % Steigung
    assert up.mean() > 3.0 * 1.5


def test_critical_speed_recovers():
    smm = {t: 3.8 + 250 / t for t in (180, 240, 300, 420, 600, 900, 1200, 1800)}
    m = model.fit_cs(smm)
    assert m.cs == pytest.approx(3.8, rel=1e-3) and m.dprime == pytest.approx(250, rel=1e-2)


def test_run_summary_uses_pace_threshold():
    import pandas as pd
    df = pd.DataFrame(dict(power=np.zeros(3600), hr=np.full(3600, 150.0), speed=np.full(3600, 3.5),
                           altitude=np.full(3600, 50.0), cadence=np.full(3600, 170.0)))
    s = metrics.summarize(df, 250, 170, 50, "Running", 1000 / 3.5)
    assert s["tss_method"] == "pace" and s["tss"] == pytest.approx(100, rel=0.02) and s["np"] is None
    s2 = metrics.summarize(df, 250, 170, 50, "Running", None)
    assert s2["tss_method"] == "hr"


def test_insights_ride_and_pmc():
    import pandas as pd
    from types import SimpleNamespace as NS
    from wkolocal import insights
    p = np.concatenate([np.full(900, 150), np.tile(np.concatenate([np.full(480, 255), np.full(240, 120)]), 3), np.full(600, 150)])
    df = pd.DataFrame(dict(power=p))
    w = NS(if_=.8, vi=1.1, tss=90, decoupling=None, np=200)
    out = insights.assess_ride(w, df, 250)
    assert out[0].level in ("good", "info", "warn") and "Schwelle" in out[0].text
    assert insights.assess_ride(w, df, 250, "Erholung")[0].level == "warn"      # 255 W-Intervalle sind keine Erholung
    d = pmc.pmc(pd.Series([300.0] * 60, index=pd.date_range("2024-01-01", periods=60)))
    assert insights.assess_pmc(d)[0].level in ("bad", "warn", "info") and any("aggressiv" in i.text for i in insights.assess_pmc(d))


def test_insights_progress_noise():
    import pandas as pd
    from wkolocal import insights
    df = pd.DataFrame(dict(Datum=pd.to_datetime(["2024-01-01", "2024-03-01"]), mFTP=[250.0, 251.0], FRC=[15.0, 18.0]))
    txt = {i.text.split(":")[0]: i.level for i in insights.assess_progress(df) if ":" in i.text}
    assert txt["mFTP"] == "info" and txt["FRC"] == "good"


# ------------------------------------------------------------------ Empfehlung / Wettkämpfe
def _scenario(loads: list[float], hard_idx=(), sport="Cycling", races=None):
    """loads: TSS der letzten Tage (letzter Eintrag = heute). hard_idx: Positionen harter Einheiten."""
    import pandas as pd
    from datetime import date, timedelta
    today = date(2026, 10, 28)
    n = len(loads)
    days = [today - timedelta(days=n - 1 - i) for i in range(n)]
    daily = pd.Series(loads, index=pd.to_datetime(days))
    rows = [dict(uid=str(i), start_time=f"{d} 07:00:00", date=str(d), sport=sport, tss=t, tss_method="power",
                 if_=.95 if i in hard_idx else .65, duration_s=5400, mmp={"300": 250.0}, ftp_used=250.0)
            for i, (d, t) in enumerate(zip(days, loads)) if t > 0]
    races = races if races is not None else pd.DataFrame(columns=["id", "date", "name", "sport", "priority", "duration_h", "tss", "notes"])
    return today, daily, pd.DataFrame(rows), races


def test_recommend_rest_when_overreached():
    from wkolocal import recommend
    today, daily, recent, races = _scenario([200.0] * 40 + [300.0] * 8, hard_idx=(44, 45, 46, 47))
    import pandas as pd
    r = recommend.recommend(today, daily, recent, races, pd.DataFrame(), 250, None)
    assert r.kind in ("Ruhetag", "Regeneration") and r.sport in ("–", "Cycling")


def test_recommend_key_session_when_fresh():
    from wkolocal import recommend
    import pandas as pd
    today, daily, recent, races = _scenario([55.0] * 45 + [80.0, 0, 70, 0, 80, 0, 0, 60, 0, 0, 80, 0, 70, 50], hard_idx=())
    r = recommend.recommend(today, daily, recent, races, pd.DataFrame(), 250, None)
    assert r.kind in ("Schwelle", "VO2max", "Sweetspot", "Lange Grundlage") and r.details and r.tss[1] > 0


def test_recommend_quota_full_and_feeling():
    from wkolocal import recommend
    import pandas as pd
    today, daily, recent, races = _scenario([60.0, 0, 70, 0, 60, 0, 50, 0, 60, 110, 0, 120, 0, 40], hard_idx=(9, 11))
    r = recommend.recommend(today, daily, recent, races, pd.DataFrame(), 250, None)
    assert r.kind in ("Grundlage", "Lange Grundlage")
    assert recommend.recommend(today, daily, recent, races, pd.DataFrame(), 250, None, "Krank").kind == "Ruhetag"
    assert recommend.recommend(today, daily, recent, races, pd.DataFrame(), 250, None, "Müde").kind in ("Regeneration", "Grundlage")


def test_recommend_races():
    from wkolocal import recommend
    import pandas as pd
    today, daily, recent, _ = _scenario([60.0, 0, 70, 0, 60, 0, 40, 0, 50, 0, 60, 0, 40, 30])
    mk = lambda days, pr="A": pd.DataFrame([dict(id=1, date=str(today + pd.Timedelta(days=days)), name="Test", sport="Cycling", priority=pr, duration_h=2, tss=150.0, notes="")])
    assert recommend.recommend(today, daily, recent, mk(1), pd.DataFrame(), 250, None).kind == "Wettkampf"
    assert recommend.recommend(today, daily, recent, mk(2), pd.DataFrame(), 250, None).kind == "Aktivierung"
    assert recommend.recommend(today, daily, recent, mk(6), pd.DataFrame(), 250, None).kind in ("Taper", "Grundlage")
    after = mk(0).assign(date=str(today))
    assert recommend.recommend(today, daily, recent, after, pd.DataFrame(), 250, None).kind in ("Regeneration", "Ruhetag")


def test_forecast_uses_today_boundary():
    import pandas as pd
    act = pd.Series([50.0, 60.0], index=pd.to_datetime(["2026-10-20", "2026-10-21"]))
    pl = pd.Series([100.0, 100.0], index=pd.to_datetime(["2026-10-25", "2026-10-30"]))
    fc = pmc.forecast(act, pl, "2026-11-02", today="2026-10-27")
    assert fc.loc["2026-10-25", "tss"] == 0 and fc.loc["2026-10-30", "tss"] == 100 and bool(fc.loc["2026-10-30", "geplant"]) and not bool(fc.loc["2026-10-27", "geplant"])


# ------------------------------------------------------------------ Schlaf / HRV
def _wdf(hrv_recent, sleep_recent, rhr_recent, n_base=28):
    import pandas as pd
    days = pd.date_range("2026-09-01", periods=n_base + 3)
    rng = np.random.default_rng(0)
    rows = []
    for i, d in enumerate(days):
        rec = i >= n_base
        rows.append(dict(date=f"{d:%Y-%m-%d}", sleep_s=int((sleep_recent if rec else 7.5) * 3600), sleep_score=75.0,
                         hrv_night=hrv_recent if rec else 68 + rng.normal(0, 4), hrv_status="BALANCED",
                         resting_hr=rhr_recent if rec else 51 + rng.normal(0, 1)))
    return pd.DataFrame(rows), days[-1]


def test_parse_garmin_day():
    from wkolocal import wellness
    sleep = {"dailySleepDTO": {"sleepTimeSeconds": 27000, "deepSleepSeconds": 5000, "sleepScores": {"overall": {"value": 81}}}, "restingHeartRate": 49}
    hrv = {"hrvSummary": {"lastNightAvg": 71, "weeklyAvg": 69, "status": "BALANCED", "baseline": {"balancedLow": 60, "balancedUpper": 80}}}
    r = wellness.parse_day("2026-10-01", sleep, hrv)
    assert r["sleep_s"] == 27000 and r["sleep_score"] == 81 and r["hrv_night"] == 71 and r["hrv_low"] == 60 and r["resting_hr"] == 49
    assert wellness.parse_day("2026-10-02", {}, None) is None
    assert wellness.parse_day("2026-10-03", None, {"hrvSummary": {"lastNightAvg": 55}})["hrv_night"] == 55


def test_readiness_states():
    from wkolocal import wellness
    import pandas as pd
    ok, t = _wdf(68, 7.5, 51)
    assert wellness.readiness(ok, t)["state"] == "ok"
    low, t = _wdf(48, 5.2, 60)
    assert wellness.readiness(low, t)["state"] == "low"
    assert wellness.readiness(pd.DataFrame())["state"] == "unknown"


def test_recommend_uses_readiness():
    from wkolocal import recommend, wellness
    import pandas as pd
    today, daily, recent, races = _scenario([55.0] * 45 + [80.0, 0, 70, 0, 80, 0, 0, 60, 0, 0, 80, 0, 70, 50])
    base = recommend.recommend(today, daily, recent, races, pd.DataFrame(), 250, None)
    assert base.kind in ("Schwelle", "VO2max", "Sweetspot", "Lange Grundlage")
    low, t = _wdf(48, 5.2, 60)
    ready = wellness.readiness(low, t)
    r = recommend.recommend(today, daily, recent, races, pd.DataFrame(), 250, None, "Normal", readiness=ready)
    assert r.kind in ("Grundlage", "Regeneration") and any("Erholungsdaten" in x or "Schlaf" in x for x in r.reasons)


def test_adjusted_form_and_recommend_reasons():
    from wkolocal import wellness, pmc as pm
    import pandas as pd
    low, t = _wdf(48, 5.2, 60)
    d = pm.pmc(pd.Series([60.0] * 31, index=pd.date_range("2026-09-01", periods=31)))
    out = wellness.adjusted_form(d, low)
    assert out.tsb_adj.iloc[-1] < out.tsb.iloc[-1] and out.tsb_adj.iloc[0] == out.tsb.iloc[0]
    assert wellness.form_adjustment(10) == 25 and wellness.form_adjustment(0) == 0
    from wkolocal import recommend
    today, daily, recent, races = _scenario([55.0] * 45 + [80.0, 0, 70, 0, 80, 0, 0, 60, 0, 0, 80, 0, 70, 50])
    r = recommend.recommend(today, daily, recent, races, pd.DataFrame(), 250, None, "Normal", readiness=wellness.readiness(low, t))
    assert any("Mit Erholungsdaten angepasst" in x for x in r.reasons)


def test_evidence_and_guidance():
    from wkolocal import evidence, recommend
    assert len({e["id"] for e in evidence.EVIDENCE}) == len(evidence.EVIDENCE) and all(e["level"] in evidence.LEVELS for e in evidence.EVIDENCE)
    assert "Q6" in evidence.refs("Q6") and evidence.by_id("Q7")["level"] == "Review"
    assert recommend.fuel_line(45) is None and "30–60" in recommend.fuel_line(90) and "60–90" in recommend.fuel_line(200)
    import pandas as pd
    from types import SimpleNamespace as NS
    assert recommend._hard(NS(if_=.7, sport="Running", duration_s=6000, tss=70))          # langer Lauf zählt als hart
    assert not recommend._hard(NS(if_=.7, sport="Cycling", duration_s=6000, tss=70))
    lines, _, _ = recommend.build_session("Lange Grundlage", "Cycling", 250, None, dict(end_min=75, long_min=180, finisher=True))
    assert any("Optional (Ermüdungsresistenz)" in x for x in lines) and any("Verpflegung" in x for x in lines)
    lines, _, _ = recommend.build_session("Grundlage", "Running", 250, 285, dict(end_min=60, long_min=90, strides=True))
    assert any("Steigerungen" in x for x in lines)


def test_recommend_evidence_rules():
    from wkolocal import recommend
    import pandas as pd
    # keine lange Einheit (alle 90 min), kaum hart, erholt -> lange Einheit + Quellen + Kraft-Hinweis
    today, daily, recent, races = _scenario([55.0] * 45 + [60.0, 0, 70, 0, 80, 0, 0, 60, 0, 0, 0, 55, 0, 0])
    r = recommend.recommend(today, daily, recent, races, pd.DataFrame(), 250, None)
    assert r.kind in ("Lange Grundlage", "Schwelle", "VO2max", "Sweetspot", "Grundlage")
    if r.kind == "Lange Grundlage":
        assert any("Q11" in x for x in r.reasons) and any("Zusatz Kraft" in x for x in r.details)
    assert all(q.startswith("Q") for q in recommend.cited_ids(r))
    # mit langer Einheit in den letzten 14 Tagen entfällt der Hinweis
    today2, daily2, recent2, races2 = _scenario([55.0] * 45 + [60.0, 0, 70, 0, 80, 0, 0, 60, 0, 0, 0, 55, 0, 0])
    recent2.loc[recent2.index[-2], "duration_s"] = 9000
    r2 = recommend.recommend(today2, daily2, recent2, races2, pd.DataFrame(), 250, None)
    assert not any("Seit 14 Tagen keine lange Einheit" in x for x in r2.reasons)


def test_parse_without_power_or_speed_columns():
    """Rad nur mit HF / Wandern: leere Spalten dürfen den Import nicht abbrechen (Fehler 'cannot interpolate with object dtype')."""
    import pandas as pd
    from wkolocal.parsers import _to_1hz
    t0 = pd.Timestamp("2026-10-01 07:00", tz="UTC")
    rows = [dict(time=t0 + pd.Timedelta(seconds=i * (1 if i < 50 else 5)), power=None, hr=120 + i % 5, cadence=None,
                 speed=None, altitude=None, distance=None) for i in range(100)]
    df, start = _to_1hz(rows)
    assert len(df) > 100 and (df.power == 0).all() and df.hr.notna().mean() > .5
    rows2 = [dict(time=t0 + pd.Timedelta(seconds=i), hr=110) for i in range(60)]          # Spalten fehlen ganz
    df2, _ = _to_1hz(rows2)
    assert set(["power", "speed", "altitude"]) <= set(df2.columns)


def test_garmin_fallback_to_tcx():
    """Fehlerhafte Originaldatei -> TCX-Export wird verwendet (Leistung, HF, Sportart)."""
    import io, zipfile
    from wkolocal.sync import garmin
    pts = "".join(f"<Trackpoint><Time>2026-10-01T07:{i // 60:02d}:{i % 60:02d}Z</Time><HeartRateBpm><Value>{120 + i % 5}</Value></HeartRateBpm>"
                  f"<Cadence>88</Cadence><Extensions><ns3:TPX><ns3:Watts>{180 + i % 7}</ns3:Watts></ns3:TPX></Extensions></Trackpoint>" for i in range(120))
    tcx = ('<?xml version="1.0"?><TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2" '
           'xmlns:ns3="http://www.garmin.com/xmlschemas/ActivityExtension/v2"><Activities><Activity Sport="Biking"><Lap><Track>'
           + pts + "</Track></Lap></Activity></Activities></TrainingCenterDatabase>").encode()
    bad = io.BytesIO()
    with zipfile.ZipFile(bad, "w") as z:
        z.writestr("x.fit", b"\x0e\x10" + b"\x00" * 10 + b".FIT" + b"\x00" * 40)
    class Fake:
        def download_activity(self, aid, dl_fmt):
            return bad.getvalue() if dl_fmt.name == "ORIGINAL" else tcx
    acts = garmin.download_and_parse(Fake(), "1", log=lambda *_: None)
    assert acts[0]["sport"] == "Cycling" and acts[0]["df"].power.max() >= 180 and acts[0]["df"].hr.notna().any()


# ------------------------------------------------------------------ Kraft & Sportwahl
def test_strength_rules():
    from datetime import date, timedelta
    from wkolocal import strength
    d = date(2026, 11, 3)
    key = strength.recommend_strength(d, "Schwelle", [d - timedelta(days=4)], False, None, None, "Geübt")
    assert key.available and "NACH dem Lauf" in key.timing and any(b["Block"] == "Plyometrie" for b in key.blocks)
    assert "85–90" in " ".join(b["Intensität"] for b in key.blocks)
    beg = strength.recommend_strength(d, "Schwelle", [], False, None, None, "Einsteiger")
    assert beg.available and "Einstieg" in beg.title
    assert not strength.recommend_strength(d, "Schwelle", [d - timedelta(days=1)], False, None, None).available          # < 48 h
    assert not strength.recommend_strength(d, "Grundlage", [], True, None, None).available                                # morgen hart
    assert not strength.recommend_strength(d, "Schwelle", [], False, 3, "A").available                                    # Rennen nah
    m = strength.recommend_strength(d, "Schwelle", [], False, 12, "A", "Geübt")
    assert m.available and "Erhalt" in m.title
    full = strength.recommend_strength(d, "Schwelle", [d - timedelta(days=2), d - timedelta(days=5)], False, None, None)
    assert not full.available and "Wochenziel" in full.title


def test_sport_override_running_after_hard_run():
    from wkolocal import recommend
    import pandas as pd
    today, daily, recent, races = _scenario([55.0] * 45 + [80.0, 0, 70, 0, 80, 0, 0, 60, 0, 0, 80, 0, 70, 50])
    auto = recommend.recommend(today, daily, recent, races, pd.DataFrame(), 250, 285)
    other = "Running" if auto.auto_sport == "Cycling" else "Cycling"
    r = recommend.recommend(today, daily, recent, races, pd.DataFrame(), 250, 285, sport_override=other)
    assert r.sport == other and r.auto_sport == auto.auto_sport and any("von Dir gewählt" in x for x in r.reasons)
    # harter Lauf gestern -> gewählter Lauf wird locker statt Schlüsseleinheit
    recent2 = recent.copy()
    recent2.loc[recent2.index[-1], ["sport", "if_", "duration_s"]] = ["Running", 1.0, 3600]
    r2 = recommend.recommend(today, daily, recent2, races, pd.DataFrame(), 250, 285, sport_override="Running")
    assert r2.sport == "Running" and r2.kind not in ("Schwelle", "VO2max", "Sweetspot")
    assert not any("Zusatz Kraft" in x for x in r2.details)


# ------------------------------------------------------------------ Laufauswertung (nur belegte Regeln)
def test_spike_and_cap():
    import pandas as pd
    from datetime import date, timedelta
    from wkolocal import runplan
    t = date.today()
    runs = pd.DataFrame([dict(date=str(t - timedelta(days=d)), name=f"L{d}", distance_m=km * 1000, uid=str(d))
                         for d, km in ((25, 11.5), (18, 12.0), (10, 12.5), (3, 16.0))])
    sp = runplan.spikes(runs)
    assert len(sp) == 1 and sp.iloc[0].km == 16.0 and "klein" in sp.iloc[0].Klasse      # 16 vs 12.5 = +28 %
    assert runplan.next_long_run_cap(runs, t) == round(16.0 * 1.1, 1)


def test_taper_meta_analysis():
    from datetime import date, timedelta
    from wkolocal import runplan
    race = date.today() + timedelta(days=14)
    tp = runplan.taper_plan(8.0, race)
    assert len(tp) == 2 and tp[0]["Umfang_h"] > tp[1]["Umfang_h"]
    assert 0.40 <= tp[1]["Umfang_h"] / 8.0 <= 0.65 and "unverändert" in tp[0]["Intensität"]


def test_run_cap_in_recommendation():
    from wkolocal import recommend
    import pandas as pd
    today, daily, recent, races = _scenario([55.0] * 45 + [80.0, 0, 70, 0, 80, 0, 0, 60, 0, 0, 80, 0, 70, 50])
    r = recommend.recommend(today, daily, recent, races, pd.DataFrame(), 250, 300, sport_override="Running", run_cap_km=8.0)
    assert any("höchstens ca. 8 km" in x for x in r.details)
    assert r.duration_min is None or r.kind in ("Schwelle", "VO2max", "Sweetspot", "Taper") or r.duration_min[1] <= 8.0 * 375 / 60 * 1.15


def test_weekly_stats_and_checks():
    import numpy as np, pandas as pd
    from datetime import date, timedelta
    from wkolocal import runplan
    t = date.today()
    rows = [dict(uid=str(i), date=str(t - timedelta(days=i)), sport="Running", duration_s=3600, distance_m=10000, avg_speed=2.8, ascent_m=50, name="L")
            for i in range(1, 60, 2)]
    w = pd.DataFrame(rows)
    stream = pd.DataFrame(dict(hr=np.r_[np.full(3000, 140.0), np.full(600, 175.0)], speed=np.full(3600, 2.8)))
    z = runplan.run_zones({"hf_max": "190"}, None, None, None)
    st = runplan.weekly_stats(w, lambda uid: stream, z)
    assert len(st) >= 8 and abs(st.anteil_z1.dropna().iloc[-2] - 3000 / 3600) < .02
    checks = runplan.rule_check(st, w)
    assert {c.regel for c in checks} >= {"Umfang", "Verteilung", "Steigerung", "10-%-Regel"}
    assert all(c.status in ("ok", "warnung", "info") for c in checks)


def test_hr_speed_relation():
    import numpy as np, pandas as pd
    from wkolocal import runplan
    n = 3600
    hr = np.r_[np.linspace(110, 140, 600), np.repeat([135.0, 145.0, 155.0], 1000)]
    speed = 2.0 + (hr - 120) * 0.03                     # bei 145 bpm: 2,75 m/s
    df = pd.DataFrame(dict(hr=hr, speed=speed, altitude=np.full(n, 100.0)))
    r = runplan.hr_speed_relation(df, 145)
    assert r and abs(r["speed"] - 2.75) < .05 and r["method"] == "Regression"
    assert runplan.hr_speed_relation(df, 185)["speed"] is None                    # keine Extrapolation
    assert runplan.hr_speed_relation(df.assign(hr=np.nan), 145) is None
