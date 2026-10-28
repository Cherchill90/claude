"""Power-Duration-Modell (WKO-ähnlich): mFTP, FRC, Pmax, Stamina.

P(t) = mFTP_t + (FRC/t) * (1 - exp(-t * (Pmax - mFTP) / FRC))
mit mFTP_t = mFTP für t <= TTE, danach mFTP * (1 - stamina * ln(t / TTE)).

Das ist eine eigene Näherung an das Konzept des WKO-Modells (Anaerobe Kapazität FRC +
aerober Anteil mFTP + Maximalleistung Pmax), NICHT die proprietäre WKO-Implementierung.
Die Werte stimmen daher nicht exakt mit WKO überein.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from scipy.optimize import least_squares

TTE = 3000.0  # s – Zeit, bis zu der mFTP als konstant gilt (Annahme)


def pd_model(t, mftp: float, frc: float, pmax: float, stamina: float = 0.0):
    t = np.asarray(t, float)
    aer = np.where(t <= TTE, mftp, mftp * (1 - stamina * np.log(np.maximum(t, TTE) / TTE)))
    pmax = max(pmax, mftp + 1)
    return aer + frc / t * (1 - np.exp(-t * (pmax - mftp) / frc))


@dataclass
class PDModel:
    mftp: float
    frc: float      # J
    pmax: float
    stamina: float
    rmse: float

    def power(self, t):
        return pd_model(t, self.mftp, self.frc, self.pmax, self.stamina)

    @property
    def ftp_60(self) -> float:
        return float(self.power(3600))

    def zones(self) -> list[tuple[str, float, float | None]]:
        f = self.mftp
        return [("Z1 Active Recovery", 0, .55 * f), ("Z2 Endurance", .55 * f, .75 * f),
                ("Z3 Tempo", .75 * f, .90 * f), ("Z4 Threshold", .90 * f, 1.05 * f),
                ("Z5 VO2max", 1.05 * f, 1.20 * f), ("Z6 Anaerobic", 1.20 * f, 1.50 * f),
                ("Z7 Neuromuscular", 1.50 * f, None)]


def fit_pd(mmp: dict[int, float], tmin=3, tmax=3600 * 3) -> PDModel | None:
    """Fit an die obere Einhüllende der MMP-Kurve (Überschätzung wird stärker bestraft)."""
    items = [(t, p) for t, p in sorted(mmp.items()) if tmin <= t <= tmax and p > 0]
    if len(items) < 10:
        return None
    t = np.array([i[0] for i in items], float)
    y = np.array([i[1] for i in items], float)
    if t.max() < 600:               # ohne lange Efforts ist mFTP nicht bestimmbar
        return None
    w = 1 / np.sqrt(t)               # Kurz- und Langzeitbereich gleichmäßig gewichten
    w /= w.mean()
    use_stam = t.max() > TTE * 1.2

    def res(x):
        m = pd_model(t, x[0], x[1], x[2], x[3] if use_stam else 0.0)
        r = (m - y) / y
        return np.where(r > 0, r * 6, r) * w     # Modell über Daten => 6x Strafe

    x0 = [0.85 * float(np.interp(1200, t, y)), 15000, max(y[:5].max(), 400), 0.1]
    lo, hi = [50, 2000, 200, 0.0], [700, 80000, 3500, 0.5]
    x0 = [min(max(v, l), h) for v, l, h in zip(x0, lo, hi)]
    sol = least_squares(res, x0, bounds=(lo, hi))
    m, frc, pmax, stam = sol.x
    pred = pd_model(t, m, frc, pmax, stam if use_stam else 0.0)
    return PDModel(float(m), float(frc), float(max(pmax, m + 1)), float(stam if use_stam else 0.0),
                   float(np.sqrt(np.mean((pred - y) ** 2))))
