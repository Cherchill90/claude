"""Erzeugt 'WKO Lokal.app' (dünner Starter, der die .venv dieses Projekts nutzt).

  python tools/make_app.py --dest ~/Applications
Das Bundle verweist per absolutem Pfad auf den Projektordner: Ordner danach nicht verschieben/löschen
(sonst install_mac_app.sh erneut ausführen).
"""
from __future__ import annotations

import argparse
import shlex
import shutil
import struct
import subprocess
import sys
import zlib
from pathlib import Path

import numpy as np

NAME = "WKO Lokal"
ROOT = Path(__file__).resolve().parent.parent


def write_png(path: Path, rgba: np.ndarray) -> None:
    h, w, _ = rgba.shape
    raw = b"".join(b"\x00" + rgba[y].tobytes() for y in range(h))
    def chunk(t: bytes, d: bytes) -> bytes:
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
    path.write_bytes(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))
                     + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))


def _seg_dist(px, py, pts):
    d = np.full(px.shape, 1e9)
    for (x0, y0), (x1, y1) in zip(pts[:-1], pts[1:]):
        vx, vy = x1 - x0, y1 - y0
        t = np.clip(((px - x0) * vx + (py - y0) * vy) / (vx * vx + vy * vy), 0, 1)
        d = np.minimum(d, np.hypot(px - (x0 + t * vx), py - (y0 + t * vy)))
    return d


def draw_icon(n=1024) -> np.ndarray:
    """Abgerundetes Quadrat mit Fitness-/Ermüdungs-/Form-Kurve (PMC-Motiv)."""
    y, x = np.mgrid[0:n, 0:n].astype(np.float32)
    r, m = n * .225, n * .06                           # Eckenradius, Rand
    cx = np.clip(x, m + r, n - m - r); cy = np.clip(y, m + r, n - m - r)
    sdf = np.hypot(x - cx, y - cy) - r
    mask = np.clip(.5 - sdf, 0, 1)
    t = y / n
    img = np.zeros((n, n, 4), np.float32)
    img[..., 0] = 20 + 25 * t; img[..., 1] = 30 + 40 * t; img[..., 2] = 60 + 70 * t       # Verlauf dunkelblau
    xs = np.linspace(.18, .82, 9) * n
    curves = [(np.array([.70, .66, .60, .56, .48, .42, .36, .30, .26]) * n, (80, 170, 255)),   # CTL
              (np.array([.74, .60, .70, .46, .62, .38, .52, .30, .40]) * n, (255, 100, 90)),    # ATL
              (np.array([.80, .80, .78, .78, .76, .74, .74, .72, .70]) * n, (255, 210, 70))]    # TSB
    for ys, col in curves:
        pts = list(zip(xs, ys))
        d = _seg_dist(x, y, pts)
        a = np.clip(.5 - (d - n * .018), 0, 1)[..., None]
        img[..., :3] = img[..., :3] * (1 - a) + np.array(col, np.float32) * a
    img[..., 3] = 255 * mask
    return img.clip(0, 255).astype(np.uint8)


def downscale(img: np.ndarray, size: int) -> np.ndarray:
    f = img.shape[0] // size
    a = img.astype(np.float32)
    a[..., :3] *= a[..., 3:4] / 255                     # prämultipliziert mitteln
    a = a.reshape(size, f, size, f, 4).mean(axis=(1, 3))
    a[..., :3] = a[..., :3] / np.maximum(a[..., 3:4], 1) * 255
    return a.clip(0, 255).astype(np.uint8)


def build(dest: Path, repo: Path = ROOT) -> Path:
    app = dest / f"{NAME}.app"
    if app.exists():
        shutil.rmtree(app)
    macos, res = app / "Contents" / "MacOS", app / "Contents" / "Resources"
    macos.mkdir(parents=True); res.mkdir(parents=True)
    (app / "Contents" / "Info.plist").write_text(f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleName</key><string>{NAME}</string>
<key>CFBundleDisplayName</key><string>{NAME}</string>
<key>CFBundleIdentifier</key><string>local.wkolokal</string>
<key>CFBundleExecutable</key><string>wko-lokal</string>
<key>CFBundleIconFile</key><string>AppIcon</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>1.0</string>
<key>CFBundleVersion</key><string>1</string>
<key>LSMinimumSystemVersion</key><string>11.0</string>
<key>NSHighResolutionCapable</key><true/>
<key>LSApplicationCategoryType</key><string>public.app-category.healthcare-fitness</string>
</dict></plist>
""")
    launcher = macos / "wko-lokal"
    launcher.write_text(f"""#!/bin/bash
# Starter für {NAME}: nutzt die Python-Umgebung des Projektordners.
REPO={shlex.quote(str(repo))}
LOG="$HOME/Library/Logs/WKO Lokal.log"
mkdir -p "$HOME/Library/Logs"
if [ ! -x "$REPO/.venv/bin/python" ]; then
  osascript -e 'display alert "WKO Lokal" message "Python-Umgebung nicht gefunden. Bitte im Projektordner ./install_mac_app.sh ausführen."'
  exit 1
fi
cd "$REPO" || exit 1
exec "$REPO/.venv/bin/python" "$REPO/desktop.py" >>"$LOG" 2>&1
""")
    launcher.chmod(0o755)
    # Icon: iconset (PNG) und – falls auf macOS – icns
    iconset = res / "AppIcon.iconset"
    iconset.mkdir()
    base = draw_icon(1024)
    for s in (16, 32, 128, 256, 512):
        write_png(iconset / f"icon_{s}x{s}.png", downscale(base, s) if s < 1024 else base)
        write_png(iconset / f"icon_{s}x{s}@2x.png", downscale(base, s * 2) if s * 2 < 1024 else base)
    if shutil.which("iconutil"):
        subprocess.run(["iconutil", "-c", "icns", str(iconset), "-o", str(res / "AppIcon.icns")], check=True)
        shutil.rmtree(iconset)
    return app


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--dest", type=Path, default=Path.home() / "Applications")
    a = ap.parse_args()
    a.dest.mkdir(parents=True, exist_ok=True)
    print(build(a.dest))
