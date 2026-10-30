#!/usr/bin/env bash
set -Eeuo pipefail
source "$(dirname "$0")/common.sh"
SIMULATOR_ID=''
finish() {
  local rc=$?
  if [[ -n "$SIMULATOR_ID" ]]; then
    xcrun simctl io "$SIMULATOR_ID" screenshot "$KV_SMOKE_DIR/ios-final.png" >/dev/null 2>&1 || true
    xcrun simctl spawn "$SIMULATOR_ID" log show --last 3m --style compact \
      --predicate 'eventMessage CONTAINS[c] "knowverse" OR process CONTAINS[c] "Knowverse"' \
      > "$KV_SMOKE_DIR/ios-device.log" 2>&1 || true
  fi
  cleanup_services
  exit "$rc"
}
trap finish EXIT

# Select an installed and available iPhone simulator instead of assuming a fixed runtime.
SIMULATOR_ID="$(xcrun simctl list devices available -j | python3 -c '
import json,sys
all_devices=[d for v in json.load(sys.stdin)["devices"].values() for d in v]
phones=[d for d in all_devices if d.get("isAvailable",True) and "iPhone" in d.get("name", "")]
if not phones: sys.exit("No available iPhone simulator runtime on runner")
print(phones[0]["udid"])
')"
echo "Selected iPhone Simulator: $SIMULATOR_ID"
if ! xcrun simctl list devices | grep "$SIMULATOR_ID" | grep -q '(Booted)'; then
  xcrun simctl boot "$SIMULATOR_ID"
fi
xcrun simctl bootstatus "$SIMULATOR_ID" -b

cd apps/mobile/ios
APP="$(find build/DerivedData/Build/Products/Debug-iphonesimulator -maxdepth 1 -name '*.app' -print -quit)"
test -d "$APP" || { echo 'iOS Simulator .app missing' >&2; exit 1; }
APP="$(cd "$(dirname "$APP")" && pwd)/$(basename "$APP")"
cd "$PROJECT_ROOT"
start_services
xcrun simctl install "$SIMULATOR_ID" "$APP"
xcrun simctl launch "$SIMULATOR_ID" com.knowverse.learninglab | tee "$KV_SMOKE_DIR/ios-launch.txt"
wait_client_api_hit
sleep 5
xcrun simctl io "$SIMULATOR_ID" screenshot "$KV_SMOKE_DIR/ios-final.png"
test -s "$KV_SMOKE_DIR/ios-final.png"
echo 'PASS: iOS Simulator installed and launched the app, requested valid NestJS JSON and captured screenshot'
# This is a smoke test. It does not claim XCTest view-tree assertions or physical iPhone coverage.
