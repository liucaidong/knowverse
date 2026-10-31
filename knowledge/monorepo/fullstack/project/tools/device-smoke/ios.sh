#!/usr/bin/env bash
set -Eeuo pipefail
source "$(dirname "$0")/common.sh"
SIMULATOR_ID=''
finish() {
  local rc=$?
  if [[ -n "$SIMULATOR_ID" ]]; then
    xcrun simctl io "$SIMULATOR_ID" screenshot "$KV_SMOKE_DIR/ios-final.png" >/dev/null 2>&1 || true
    xcrun simctl spawn "$SIMULATOR_ID" log show --last 4m --style compact \
      --predicate 'eventMessage CONTAINS[c] "knowverse" OR process CONTAINS[c] "Knowverse"' \
      > "$KV_SMOKE_DIR/ios-device.log" 2>&1 || true
  fi
  cleanup_services
  exit "$rc"
}
trap finish EXIT
SIMULATOR_ID="$(xcrun simctl list devices available -j | python3 -c '
import json,sys
phones=[d for v in json.load(sys.stdin)["devices"].values() for d in v if d.get("isAvailable",True) and "iPhone" in d.get("name", "")]
if not phones: sys.exit("No available iPhone Simulator runtime")
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
xcrun simctl io "$SIMULATOR_ID" screenshot "$KV_SMOKE_DIR/ios-initial.png"

# Maestro 2.11 is pinned. It operates on the real iOS accessibility layer,
# unlike the earlier simctl-only smoke test. Every tap is followed by proxy evidence.
command -v maestro >/dev/null || { echo 'FAIL: Maestro is missing on CI runner' >&2; exit 1; }
run_flow() {
  local name="$1"
  python3 tools/device-smoke/run-maestro.py "$SIMULATOR_ID" "$name" "$KV_SMOKE_DIR"
}
run_flow refresh
wait_event valid-api-hit 2
scenario http-503
run_flow unavailable
wait_event injected-http-503 1
xcrun simctl io "$SIMULATOR_ID" screenshot "$KV_SMOKE_DIR/ios-unavailable.png"
scenario malformed-json
run_flow malformed
wait_event injected-malformed-json 1
xcrun simctl io "$SIMULATOR_ID" screenshot "$KV_SMOKE_DIR/ios-malformed.png"
scenario ok
run_flow recovered
wait_event valid-api-hit 3
xcrun simctl io "$SIMULATOR_ID" screenshot "$KV_SMOKE_DIR/ios-recovered.png"
printf '%s\n' 'PASS: iOS E2E accessibility tap, injected 503, malformed JSON, successful recovery' \
  | tee "$KV_SMOKE_DIR/ios-result.txt"
