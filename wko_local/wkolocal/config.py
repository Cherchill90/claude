"""Pfade und Konstanten."""
import os
from pathlib import Path

ROOT = Path(os.environ.get("WKOLOCAL_HOME", Path(__file__).resolve().parent.parent / "data"))
DB_PATH = ROOT / "wko.sqlite"
STREAM_DIR = ROOT / "streams"
TOKEN_DIR = ROOT / "garmin_tokens"
INBOX = ROOT / "inbox"  # hier abgelegte Dateien (FIT/TCX/GPX/CSV/ZIP) werden importiert


def ensure_dirs() -> None:
    for d in (ROOT, STREAM_DIR, TOKEN_DIR, INBOX):
        d.mkdir(parents=True, exist_ok=True)
