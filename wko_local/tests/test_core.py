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
