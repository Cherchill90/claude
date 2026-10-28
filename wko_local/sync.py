#!/usr/bin/env python3
"""Lädt Trainingsdaten (Garmin Connect / TrainingPeaks / lokale Dateien) in die lokale Datenbank.

  python sync.py garmin [--days 30 | --since 2025-01-01]
  python sync.py trainingpeaks [--days 30]
  python sync.py folder [PFAD]        # Standard: data/inbox
  python sync.py demo                 # synthetische Beispieldaten (zum Ausprobieren)
  python sync.py recompute            # Kennzahlen nach FTP-Änderung neu berechnen
"""
import argparse
import sys
from datetime import date
from pathlib import Path


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("quelle", choices=["garmin", "trainingpeaks", "folder", "demo", "recompute", "all"])
    ap.add_argument("pfad", nargs="?")
    ap.add_argument("--days", type=int, default=30)
    ap.add_argument("--since", type=date.fromisoformat)
    a = ap.parse_args()

    from wkolocal import config, ingest
    config.ensure_dirs()
    results = []
    if a.quelle in ("garmin", "all"):
        from wkolocal.sync import garmin
        results.append(("Garmin", garmin.sync(a.days, a.since)))
    if a.quelle in ("trainingpeaks", "all"):
        from wkolocal.sync import trainingpeaks
        results.append(("TrainingPeaks", trainingpeaks.sync(a.days)))
    if a.quelle in ("folder", "all"):
        results.append(("Ordner", ingest.import_path(Path(a.pfad) if a.pfad else config.INBOX)))
    if a.quelle == "demo":
        from wkolocal.demo import generate
        print(f"{generate()} Demo-Workouts erzeugt.")
    if a.quelle == "recompute":
        print(f"{ingest.recompute_all()} Workouts neu berechnet.")
    rc = 0
    for name, (new, skipped, errors) in results:
        print(f"{name}: {new} neu, {skipped} bereits vorhanden, {len(errors)} Fehler")
        for e in errors: print("  !", e); rc = 1
    return rc


if __name__ == "__main__":
    sys.exit(main())
