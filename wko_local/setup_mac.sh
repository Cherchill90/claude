#!/usr/bin/env bash
# Einrichtung auf macOS (Apple Silicon und Intel): legt .venv an bzw. repariert sie und installiert Pakete.
# Auf Apple Silicon wird zwingend NATIVES arm64-Python verwendet (kein Rosetta/x86_64).
set -euo pipefail
cd "$(dirname "$0")"

ARCH=""
if [ "$(uname)" = Darwin ] && [ "$(sysctl -n hw.optional.arm64 2>/dev/null || echo 0)" = 1 ]; then ARCH="arch -arm64"; fi
native() { [ -z "$ARCH" ] || [ "$($ARCH "$1" -c 'import platform; print(platform.machine())' 2>/dev/null)" = arm64 ]; }

# Gut getestete Versionen zuerst; ganz neue (3.15) nur als letzte Wahl, weil Pakete dafür oft später erscheinen.
PY=""
for c in python3.13 python3.12 python3.14 python3.11 python3 python3.15; do
  p=$(command -v "$c" 2>/dev/null) || continue
  "$p" -c 'import sys; sys.exit(sys.version_info < (3, 11))' 2>/dev/null || continue
  native "$p" || { echo "Übersprungen (nicht arm64-nativ): $p"; continue; }
  PY="$p"; break
done
if [ -z "$PY" ]; then
  echo "Kein passendes Python (>= 3.11${ARCH:+, nativ arm64}) gefunden."
  echo "Installation:  ${ARCH:+arch -arm64 }/bin/bash -c \"\$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\"   (falls Homebrew fehlt)"
  echo "               brew install python@3.13        (Apple Silicon: Homebrew liegt unter /opt/homebrew, NICHT /usr/local)"
  echo "oder Python von python.org (universal2) installieren."
  exit 1
fi
echo "Verwende $($ARCH "$PY" --version) ($PY), Architektur: $($ARCH "$PY" -c 'import platform; print(platform.machine())')"

CHECK='import numpy, pandas, scipy, streamlit, plotly, fitdecode'
if [ -x .venv/bin/python ] && $ARCH .venv/bin/python -c "$CHECK" 2>/dev/null; then
  echo "Vorhandene Umgebung funktioniert."
else
  [ -d .venv ] && echo "Vorhandene Umgebung ist defekt oder hat falsche Architektur – wird neu gebaut."
  rm -rf .venv
  $ARCH "$PY" -m venv .venv
  $ARCH .venv/bin/python -m pip install --quiet --upgrade pip
  $ARCH .venv/bin/python -m pip install --quiet -r requirements.txt
fi
$ARCH .venv/bin/python -c "$CHECK" || { echo "Import-Test fehlgeschlagen."; exit 1; }
$ARCH .venv/bin/python -m pytest -q tests && echo "Selbsttest OK ($($ARCH .venv/bin/python -c 'import platform; print(platform.machine())'))"
chmod +x start.command sync.command install_mac_app.sh 2>/dev/null || true
echo
echo "Fertig. Start: ./start.command   –   als App installieren: ./install_mac_app.sh"
