#!/usr/bin/env bash
# Startet die Oberfläche (Doppelklick im Finder oder ./start.command). Browser öffnet sich automatisch.
cd "$(dirname "$0")"
ARCH=""
if [ "$(uname)" = Darwin ] && [ "$(sysctl -n hw.optional.arm64 2>/dev/null || echo 0)" = 1 ]; then ARCH="arch -arm64"; fi
[ -x .venv/bin/python ] || { echo "Erst ./setup_mac.sh ausführen (bei ImportError/Architekturfehler ebenfalls: baut die Umgebung neu)."; read -r -p "Enter zum Schließen"; exit 1; }
exec $ARCH .venv/bin/python -m streamlit run app.py --server.address 127.0.0.1 --browser.gatherUsageStats false
