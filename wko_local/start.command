#!/usr/bin/env bash
# Startet die Oberfläche (Doppelklick im Finder oder ./start.command). Browser öffnet sich automatisch.
cd "$(dirname "$0")"
[ -x .venv/bin/python ] || { echo "Erst ./setup_mac.sh ausführen."; read -r -p "Enter zum Schließen"; exit 1; }
exec .venv/bin/python -m streamlit run app.py --server.address 127.0.0.1 --browser.gatherUsageStats false
