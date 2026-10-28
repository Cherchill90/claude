"""Performance Management Chart: CTL / ATL / TSB und Prognose."""
from __future__ import annotations

import math

import pandas as pd


def pmc(daily_tss: pd.Series, ctl_tau=42, atl_tau=7, start_ctl=0.0, start_atl=0.0) -> pd.DataFrame:
    """daily_tss: Index = Datum (lückenlos wird ergänzt). TSB = CTL(Vortag) - ATL(Vortag)."""
    if daily_tss.empty:
        return pd.DataFrame(columns=["tss", "ctl", "atl", "tsb", "ramp"])
    s = daily_tss.copy()
    s.index = pd.to_datetime(s.index)
    s = s.groupby(level=0).sum().asfreq("D", fill_value=0.0)
    kc, ka = 1 - math.exp(-1 / ctl_tau), 1 - math.exp(-1 / atl_tau)
    ctl, atl, rows = start_ctl, start_atl, []
    for d, v in s.items():
        tsb = ctl - atl
        ctl += (v - ctl) * kc
        atl += (v - atl) * ka
        rows.append((d, v, ctl, atl, tsb))
    df = pd.DataFrame(rows, columns=["date", "tss", "ctl", "atl", "tsb"]).set_index("date")
    df["ramp"] = df["ctl"].diff(7)
    return df


def forecast(daily_actual: pd.Series, planned: pd.Series, until: str, **kw) -> pd.DataFrame:
    """Tatsächliche TSS bis heute + geplante TSS danach -> PMC mit Spalte 'geplant'."""
    a = daily_actual.copy(); a.index = pd.to_datetime(a.index)
    last = a.index.max() if len(a) else pd.Timestamp.today().normalize()
    p = planned.copy(); p.index = pd.to_datetime(p.index)
    p = p[p.index > last]
    full = pd.concat([a, p]).groupby(level=0).sum()
    full = full.reindex(pd.date_range(full.index.min(), max(pd.Timestamp(until), full.index.max())), fill_value=0.0)
    df = pmc(full, **kw)
    df["geplant"] = df.index > last
    return df


def ramp_plan(current_ctl: float, target_ctl: float, weeks: int, recovery_every=4,
              recovery_factor=0.6) -> list[float]:
    """Wöchentliche TSS-Ziele für einen CTL-Aufbau (Näherung: Wochen-TSS ≈ 7 * CTL_Ziel der Woche)."""
    out = []
    for w in range(1, weeks + 1):
        ctl_w = current_ctl + (target_ctl - current_ctl) * w / weeks
        # Der Aufbau braucht Wochen-TSS oberhalb des Gleichgewichts, damit CTL steigt
        load = 7 * (ctl_w + (target_ctl - current_ctl) / weeks * 6 / 7 * 1.0)
        if recovery_every and w % recovery_every == 0 and w != weeks:
            load *= recovery_factor
        out.append(round(load))
    return out
