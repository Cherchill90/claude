#!/usr/bin/env bash
# Daten laden. Beispiele:  ./sync.command garmin --days 90   |  ./sync.command folder ~/Downloads/fit
# Ohne Argumente (Doppelklick): Garmin, letzte 30 Tage.
cd "$(dirname "$0")"
[ -x .venv/bin/python ] || { echo "Erst ./setup_mac.sh ausführen."; read -r -p "Enter zum Schließen"; exit 1; }
if [ $# -eq 0 ]; then set -- garmin --days 30; fi
.venv/bin/python sync.py "$@"
status=$?
# Beim Doppelklick (ohne Terminal-Argumente) Fenster offen lassen
[ -t 0 ] && read -r -p "Fertig – Enter zum Schließen"
exit $status
