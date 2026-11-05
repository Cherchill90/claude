#!/bin/bash
# Gleicher Test wie in GitHub Actions, aber lokal auf deinem Mac (Xcode muss installiert sein):
# baut die iPhone-App für den Simulator, startet die echte Mac-App und prüft die Synchronisation in beide Richtungen.
# Aufruf im Ordner notenapp:  bash ci/ios-test-auf-dem-mac.sh
set -euo pipefail
cd "$(dirname "$0")/.."

echo "▶ Abhängigkeiten"; npm install --no-audit --no-fund >/dev/null
echo "▶ Web-Build mit Selbsttest"; VITE_SELFTEST=1 npx vite build >/dev/null
echo "▶ iOS-Projekt"; npx cap sync ios >/dev/null
PLIST=ios/App/App/Info.plist
cp "$PLIST" /tmp/notenapp-Info.plist.bak
trap 'cp /tmp/notenapp-Info.plist.bak "$PLIST"; npx vite build >/dev/null 2>&1 && npx cap sync ios >/dev/null 2>&1; echo "▶ Projekt wieder im Normalzustand (ohne Selbsttest)"' EXIT
/usr/libexec/PlistBuddy -c "Delete :CFBundleURLTypes" "$PLIST" 2>/dev/null || true
/usr/libexec/PlistBuddy -c "Add :CFBundleURLTypes array" -c "Add :CFBundleURLTypes:0 dict" \
  -c "Add :CFBundleURLTypes:0:CFBundleURLSchemes array" -c "Add :CFBundleURLTypes:0:CFBundleURLSchemes:0 string notenapp" "$PLIST"

echo "▶ Simulator"
UDID=$(xcrun simctl list devices available -j | python3 -c "
import json, sys
d = json.load(sys.stdin)['devices']
rt = sorted(k for k in d if 'iOS' in k and any(x['name'].startswith('iPhone') for x in d[k]))[-1]
print([x['udid'] for x in d[rt] if x['name'].startswith('iPhone')][0])")
xcrun simctl boot "$UDID" 2>/dev/null || true
xcrun simctl bootstatus "$UDID" -b >/dev/null
open -a Simulator --args -CurrentDeviceUDID "$UDID" || true

echo "▶ iOS-App bauen (xcodebuild, dauert beim ersten Mal einige Minuten)"
xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Debug -destination "id=$UDID" \
  -derivedDataPath build/dd CODE_SIGNING_ALLOWED=NO build 2>&1 | tail -5
xcrun simctl uninstall "$UDID" de.notenapp.ios 2>/dev/null || true
xcrun simctl install "$UDID" build/dd/Build/Products/Debug-iphonesimulator/App.app

echo "▶ Mac-App ⇄ iPhone-App synchronisieren"
npm i --no-save playwright@1.64.1 >/dev/null
SIM_UDID="$UDID" node ci/ios-sync-e2e.cjs
