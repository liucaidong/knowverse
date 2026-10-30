#!/usr/bin/env bash
set -Eeuo pipefail
source "$(dirname "$0")/common.sh"
finish() {
  local rc=$?
  adb logcat -d -t 2500 > "$KV_SMOKE_DIR/android-logcat.txt" 2>&1 || true
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

# Android UIAutomator exposes real rendered TextView strings, not a mocked JS DOM.
# Require both a successful HTTP status and a lesson card to avoid false positives.
for attempt in $(seq 1 22); do
  adb shell uiautomator dump /sdcard/kv-ui.xml >/dev/null 2>&1 || true
  adb pull /sdcard/kv-ui.xml "$KV_SMOKE_DIR/android-ui.xml" >/dev/null 2>&1 || true
  if [[ -f "$KV_SMOKE_DIR/android-ui.xml" ]] \
    && grep -q 'NestJS API 连通' "$KV_SMOKE_DIR/android-ui.xml" \
    && grep -q 'KNOWVERSE / NATIVE RUNTIME' "$KV_SMOKE_DIR/android-ui.xml"; then
    echo 'PASS: Android native React Text renders title + validated API connection'
    # Prove real interaction: tap an accessible React Native Pressable, not just display initial screen.
    coords="$(python3 tools/device-smoke/tap-android.py "$KV_SMOKE_DIR/android-ui.xml" '重新验证 API')"
    read -r tx ty <<< "$coords"
    adb shell input tap "$tx" "$ty"
    for retry in $(seq 1 45); do
      if [[ "$(grep -c 'valid-api-hit' "$KV_DEVICE_HITS_FILE")" -ge 2 ]]; then
        echo 'PASS: Android accessible button tap triggered a second validated NestJS API request'
        exit 0
      fi
      sleep 2
    done
    echo 'FAIL: refresh button did not trigger a second validated API request' >&2
    exit 1
  fi
  sleep 3
done
echo 'FAIL: Android UI hierarchy did not show validated API status and title' >&2
exit 1
