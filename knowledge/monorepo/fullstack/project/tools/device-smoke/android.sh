#!/usr/bin/env bash
set -Eeuo pipefail
source "$(dirname "$0")/common.sh"
finish() {
  local rc=$?
  adb logcat -d -t 2800 > "$KV_SMOKE_DIR/android-logcat.txt" 2>&1 || true
  adb shell uiautomator dump /sdcard/kv-ui.xml >/dev/null 2>&1 || true
  adb pull /sdcard/kv-ui.xml "$KV_SMOKE_DIR/android-ui.xml" >/dev/null 2>&1 || true
  adb shell screencap -p /sdcard/kv-final.png >/dev/null 2>&1 || true
  adb pull /sdcard/kv-final.png "$KV_SMOKE_DIR/android-final.png" >/dev/null 2>&1 || true
  cleanup_services
  exit "$rc"
}
trap finish EXIT
APK=apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk
test -s "$APK" || { echo "Missing debug APK: $APK" >&2; exit 1; }
start_services
adb reverse tcp:8081 tcp:8081
adb reverse tcp:3001 tcp:3001
adb install -r "$APK"
adb shell am force-stop com.knowverse.learninglab || true
adb shell am start -W -n com.knowverse.learninglab/.MainActivity
wait_client_api_hit

ui_contains() {
  local needle="$1" attempt
  for attempt in $(seq 1 22); do
    adb shell uiautomator dump /sdcard/kv-ui.xml >/dev/null 2>&1 || true
    adb pull /sdcard/kv-ui.xml "$KV_SMOKE_DIR/android-ui.xml" >/dev/null 2>&1 || true
    if [[ -f "$KV_SMOKE_DIR/android-ui.xml" ]] && grep -q "$needle" "$KV_SMOKE_DIR/android-ui.xml"; then
      echo "PASS: Android displayed $needle"
      return 0
    fi
    sleep 2
  done
  echo "FAIL: Android did not show $needle" >&2
  return 1
}
tap_refresh() {
  # Parse actual accessibility bounds; refuse to invent touchscreen coordinates.
  ui_contains '重新验证 API'
  local coords tx ty
  coords="$(python3 tools/device-smoke/tap-android.py "$KV_SMOKE_DIR/android-ui.xml" '重新验证 API')"
  read -r tx ty <<< "$coords"
  adb shell input tap "$tx" "$ty"
}
snapshot() {
  local label="$1"
  adb shell screencap -p "/sdcard/kv-$label.png"
  adb pull "/sdcard/kv-$label.png" "$KV_SMOKE_DIR/android-$label.png" >/dev/null
}

ui_contains 'KNOWVERSE / NATIVE RUNTIME'
ui_contains 'NestJS API 连通'
snapshot initial
# Normal interactive retry, then deterministic failure injection and recovery.
tap_refresh
wait_event valid-api-hit 2
ui_contains 'NestJS API 连通'
scenario http-503
tap_refresh
wait_event injected-http-503 1
ui_contains 'API 不可用'
ui_contains 'HTTP 503'
snapshot unavailable
# Contract parsing failure must retain offline data rather than displaying bogus courses.
scenario malformed-json
tap_refresh
wait_event injected-malformed-json 1
ui_contains 'API 不可用'
ui_contains 'SyntaxError'
snapshot malformed
scenario ok
tap_refresh
wait_event valid-api-hit 3
ui_contains 'NestJS API 连通'
ui_contains '3 节课程'
snapshot recovered
printf '%s\n' 'PASS: Android E2E UI retry -> HTTP 503 -> invalid JSON -> recovery -> three valid NestJS hits' \
  | tee "$KV_SMOKE_DIR/android-result.txt"
