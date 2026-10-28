"""Dateiparser: FIT, TCX, GPX, CSV (auch .gz/.zip) -> 1-Hz-DataFrame + Metadaten."""
from __future__ import annotations

import gzip
import io
import zipfile
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

COLS = ["power", "hr", "cadence", "speed", "altitude", "distance"]
SPORT_MAP = {"cycling": "Cycling", "biking": "Cycling", "running": "Running", "swimming": "Swimming",
             "e_biking": "Cycling", "virtual_ride": "Cycling", "walking": "Walking", "hiking": "Walking"}


def _norm_sport(s) -> str:
    return SPORT_MAP.get(str(s or "").lower().replace(" ", "_"), (str(s).title() if s else "Other"))


def _to_1hz(rows: list[dict]) -> pd.DataFrame:
    """rows mit 'time' (UTC datetime) -> 1-Hz-Raster; kurze Lücken interpoliert, lange = Pause (Power 0)."""
    df = pd.DataFrame(rows).dropna(subset=["time"]).sort_values("time")
    df = df.drop_duplicates("time")
    t0 = df["time"].iloc[0]
    df["t"] = ((df["time"] - t0).dt.total_seconds()).round().astype(int)
    df = df.drop_duplicates("t").set_index("t")
    full = df.reindex(range(0, int(df.index.max()) + 1))
    for c in COLS:
        if c not in full: full[c] = np.nan
    gap = full["power"].isna()
    # Lücken <= 10 s interpolieren, größere Lücken (Pausen) -> Power 0, HR bleibt NaN
    for c in COLS:
        full[c] = full[c].interpolate(limit=10, limit_area="inside")
    full["power"] = full["power"].fillna(0.0)
    full["cadence"] = full["cadence"].fillna(0.0)
    return full[COLS].astype("float32"), t0.to_pydatetime()


def parse_fit(data: bytes) -> dict:
    import fitdecode
    rows, sport, name = [], None, None
    with fitdecode.FitReader(io.BytesIO(data)) as fr:
        for fr_ in fr:
            if not isinstance(fr_, fitdecode.FitDataMessage):
                continue
            if fr_.name == "record":
                g = fr_.get_value
                def v(k):
                    try: return g(k)
                    except KeyError: return None
                t = v("timestamp")
                if t is None: continue
                rows.append(dict(time=pd.Timestamp(t).tz_localize("UTC") if pd.Timestamp(t).tzinfo is None else pd.Timestamp(t),
                                 power=v("power"), hr=v("heart_rate"), cadence=v("cadence"),
                                 speed=v("enhanced_speed") if v("enhanced_speed") is not None else v("speed"),
                                 altitude=v("enhanced_altitude") if v("enhanced_altitude") is not None else v("altitude"),
                                 distance=v("distance")))
            elif fr_.name == "sport":
                try: sport = fr_.get_value("sport"); name = fr_.get_value("name")
                except KeyError: pass
            elif fr_.name == "session" and sport is None:
                try: sport = fr_.get_value("sport")
                except KeyError: pass
    if not rows:
        raise ValueError("Keine Record-Daten in FIT-Datei")
    df, t0 = _to_1hz(rows)
    return dict(df=df, start=t0, sport=_norm_sport(sport), name=name)


def parse_tcx(data: bytes) -> dict:
    root = ET.fromstring(data)
    ns = {"t": "http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2",
          "x": "http://www.garmin.com/xmlschemas/ActivityExtension/v2"}
    act = root.find(".//t:Activity", ns)
    sport = act.get("Sport") if act is not None else None
    rows = []
    for tp in root.iterfind(".//t:Trackpoint", ns):
        ts = tp.findtext("t:Time", namespaces=ns)
        if not ts: continue
        def f(path):
            x = tp.findtext(path, namespaces=ns)
            return float(x) if x not in (None, "") else None
        rows.append(dict(time=pd.Timestamp(ts).tz_convert("UTC") if pd.Timestamp(ts).tzinfo else pd.Timestamp(ts).tz_localize("UTC"),
                         hr=f("t:HeartRateBpm/t:Value"), cadence=f("t:Cadence") or f(".//x:RunCadence"),
                         altitude=f("t:AltitudeMeters"), distance=f("t:DistanceMeters"),
                         power=f(".//x:Watts"), speed=f(".//x:Speed")))
    if not rows: raise ValueError("Keine Trackpoints in TCX")
    df, t0 = _to_1hz(rows)
    return dict(df=df, start=t0, sport=_norm_sport(sport), name=None)


def parse_gpx(data: bytes) -> dict:
    root = ET.fromstring(data)
    rows = []
    for pt in root.iter():
        if not pt.tag.endswith("trkpt"): continue
        r = dict(time=None)
        for ch in pt.iter():
            tag = ch.tag.split("}")[-1].lower()
            txt = (ch.text or "").strip()
            if not txt: continue
            if tag == "time": r["time"] = pd.Timestamp(txt).tz_convert("UTC") if pd.Timestamp(txt).tzinfo else pd.Timestamp(txt).tz_localize("UTC")
            elif tag == "ele": r["altitude"] = float(txt)
            elif tag in ("hr", "heartrate"): r["hr"] = float(txt)
            elif tag in ("cad", "cadence"): r["cadence"] = float(txt)
            elif tag in ("power", "watts"): r["power"] = float(txt)
        if r["time"] is not None: rows.append(r)
    if not rows: raise ValueError("Keine Trackpunkte in GPX")
    df, t0 = _to_1hz(rows)
    return dict(df=df, start=t0, sport="Other", name=None)


CSV_ALIASES = {"power": ["power", "watts", "watt", "pwr"], "hr": ["hr", "heartrate", "heart_rate", "heart rate", "bpm"],
               "cadence": ["cadence", "cad", "rpm"], "speed": ["speed", "velocity"],
               "altitude": ["altitude", "elevation", "ele"], "distance": ["distance", "dist"],
               "time": ["time", "timestamp", "datetime", "seconds", "secs", "elapsed", "sec"]}


def parse_csv(data: bytes, start: datetime | None = None) -> dict:
    df = pd.read_csv(io.BytesIO(data), sep=None, engine="python")
    low = {c.strip().lower(): c for c in df.columns}
    pick = {k: next((low[a] for a in al if a in low), None) for k, al in CSV_ALIASES.items()}
    if pick["time"] is None: raise ValueError("CSV braucht eine Zeitspalte (time/seconds)")
    tcol = df[pick["time"]]
    if np.issubdtype(tcol.dtype, np.number):
        t0 = start or datetime.fromtimestamp(0, timezone.utc).replace(year=2000)
        times = pd.to_datetime(t0) + pd.to_timedelta(tcol.astype(float), unit="s")
    else:
        times = pd.to_datetime(tcol, utc=True)
        t0 = times.iloc[0].to_pydatetime()
    rows = pd.DataFrame({"time": times})
    for k in COLS:
        if pick[k]: rows[k] = pd.to_numeric(df[pick[k]], errors="coerce")
    rows["time"] = rows["time"].dt.tz_localize("UTC") if rows["time"].dt.tz is None else rows["time"]
    out, t0 = _to_1hz(rows.to_dict("records"))
    return dict(df=out, start=t0, sport="Cycling" if pick["power"] else "Other", name=None)


def parse_file(path: Path | str, data: bytes | None = None) -> list[dict]:
    """Gibt eine Liste von Aktivitäten zurück (ZIP kann mehrere enthalten)."""
    path = Path(path)
    data = data if data is not None else path.read_bytes()
    name = path.name.lower()
    if name.endswith(".zip") or data[:2] == b"PK":
        out = []
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            for n in z.namelist():
                if n.endswith("/") or n.startswith("__MACOSX"): continue
                out += parse_file(Path(n), z.read(n))
        return out
    if name.endswith(".gz"):
        return parse_file(Path(name[:-3]), gzip.decompress(data))
    if name.endswith(".fit") or data[8:12] == b".FIT":
        r = parse_fit(data)
    elif name.endswith(".tcx"):
        r = parse_tcx(data)
    elif name.endswith(".gpx"):
        r = parse_gpx(data)
    elif name.endswith(".csv"):
        r = parse_csv(data)
    else:
        raise ValueError(f"Unbekanntes Format: {path.name}")
    r["name"] = r.get("name") or path.stem
    return [r]
