#!/usr/bin/env bash
# Installiert "WKO Lokal" als Mac-App (Fenster statt Browser-Tab).
#   ./install_mac_app.sh              -> ~/Applications
#   ./install_mac_app.sh --system     -> /Applications (evtl. Passwort)
#   ./install_mac_app.sh --uninstall
set -euo pipefail
cd "$(dirname "$0")"
DEST="$HOME/Applications"; MODE=install
for a in "$@"; do case "$a" in --system) DEST=/Applications;; --uninstall) MODE=uninstall;; esac; done
APP="$DEST/WKO Lokal.app"
if [ "$MODE" = uninstall ]; then rm -rf "$APP"; echo "Entfernt: $APP (Daten in $(pwd)/data bleiben erhalten)"; exit 0; fi
[ "$(uname)" = Darwin ] || echo "Hinweis: Das ist kein macOS – die App wird nur als Test gebaut."
[ -x .venv/bin/python ] || ./setup_mac.sh
.venv/bin/python -c "import webview" 2>/dev/null || .venv/bin/python -m pip install --quiet pywebview
mkdir -p "$DEST"
.venv/bin/python tools/make_app.py --dest "$DEST"
if command -v codesign >/dev/null; then codesign --force --deep --sign - "$APP" 2>/dev/null || true; fi
xattr -cr "$APP" 2>/dev/null || true
touch "$APP"
echo
echo "Installiert: $APP"
echo "Start: Spotlight (Cmd+Leertaste) -> 'WKO Lokal', oder Launchpad. Zum Behalten im Dock: App starten, Rechtsklick auf das Dock-Symbol -> Optionen -> Im Dock behalten."
echo "Wichtig: Der Projektordner ($(pwd)) darf nicht verschoben oder gelöscht werden; Deine Daten liegen in $(pwd)/data."
echo "Fehlersuche: ~/Library/Logs/WKO\\ Lokal.log und 'WKO Lokal server.log'"
