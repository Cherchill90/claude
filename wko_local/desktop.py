"""Natives Fenster (WKWebView via pywebview) um die Streamlit-Oberfläche.

  python desktop.py            # Fenster öffnen
  python desktop.py --browser  # stattdessen Standardbrowser
  python desktop.py --check    # Selbsttest: Server starten, Health prüfen, beenden
"""
from __future__ import annotations

import argparse
import os
import socket
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
TITLE = "WKO Lokal"


def log_path() -> Path:
    if sys.platform == "darwin":
        p = Path.home() / "Library" / "Logs"
    else:
        p = ROOT / "data"
    p.mkdir(parents=True, exist_ok=True)
    return p / "WKO Lokal server.log"


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def start_server(port: int) -> subprocess.Popen:
    log = open(log_path(), "ab")
    cmd = [sys.executable, "-m", "streamlit", "run", str(ROOT / "app.py"),
           "--server.port", str(port), "--server.address", "127.0.0.1", "--server.headless", "true",
           "--server.fileWatcherType", "none", "--browser.gatherUsageStats", "false",
           "--client.toolbarMode", "minimal"]
    return subprocess.Popen(cmd, cwd=ROOT, stdout=log, stderr=log, stdin=subprocess.DEVNULL)


def wait_ready(port: int, proc: subprocess.Popen, timeout=90) -> bool:
    url = f"http://127.0.0.1:{port}/_stcore/health"
    t0 = time.time()
    while time.time() - t0 < timeout:
        if proc.poll() is not None:
            return False
        try:
            with urllib.request.urlopen(url, timeout=2) as r:
                if r.status == 200:
                    return True
        except OSError:
            time.sleep(.3)
    return False


def _dock_name() -> None:
    """Best effort: Programmname im Menü/Dock statt 'Python'."""
    try:
        from Foundation import NSBundle
        info = NSBundle.mainBundle().infoDictionary()
        info["CFBundleName"] = TITLE
    except Exception:
        pass


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--browser", action="store_true")
    ap.add_argument("--check", action="store_true")
    a = ap.parse_args()
    port = free_port()
    proc = start_server(port)
    try:
        if not wait_ready(port, proc):
            print(f"Server startete nicht – siehe Log: {log_path()}", file=sys.stderr)
            return 1
        url = f"http://127.0.0.1:{port}"
        if a.check:
            print("OK", url)
            return 0
        if not a.browser:
            try:
                import webview
                _dock_name()
                webview.create_window(TITLE, url, width=1500, height=950, min_size=(1000, 650))
                webview.start()
                return 0
            except Exception as e:   # kein pywebview/keine GUI -> Browser-Fallback
                print(f"Natives Fenster nicht verfügbar ({e}); öffne Browser.", file=sys.stderr)
        import webbrowser
        webbrowser.open(url)
        print(f"Läuft auf {url} – Strg+C zum Beenden.")
        while proc.poll() is None:
            time.sleep(1)
        return 0
    except KeyboardInterrupt:
        return 0
    finally:
        proc.terminate()
        try:
            proc.wait(5)
        except subprocess.TimeoutExpired:
            proc.kill()


if __name__ == "__main__":
    sys.exit(main())
