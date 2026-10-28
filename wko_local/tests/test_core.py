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
