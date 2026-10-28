#!/usr/bin/env bash
# Einmalige Einrichtung auf macOS (Apple Silicon und Intel): legt .venv an und installiert Pakete.
set -euo pipefail
cd "$(dirname "$0")"

PY=""
for c in python3.13 python3.12 python3.11 python3; do
  if command -v "$c" >/dev/null 2>&1 && "$c" -c 'import sys; sys.exit(sys.version_info < (3, 11))' 2>/dev/null; then PY="$c"; break; fi
done
if [ -z "$PY" ]; then
  echo "Python >= 3.11 nicht gefunden."
  echo "Installation: brew install python@3.12   (Homebrew: https://brew.sh)  oder von python.org"
  exit 1
fi
echo "Verwende $($PY --version) ($(command -v $PY))"
"$PY" -m venv .venv
.venv/bin/python -m pip install --quiet --upgrade pip
.venv/bin/python -m pip install --quiet -r requirements.txt
.venv/bin/python -m pytest -q tests && echo "Selbsttest OK"
chmod +x start.command sync.command setup_mac.sh 2>/dev/null || true
echo
echo "Fertig. Start per Doppelklick auf start.command oder:  ./start.command"
