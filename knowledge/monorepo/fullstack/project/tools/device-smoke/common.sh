#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$PROJECT_ROOT"
export KV_SMOKE_DIR="${KV_SMOKE_DIR:-${RUNNER_TEMP:-/tmp}/knowverse-device-smoke}"
export KV_DEVICE_HITS_FILE="$KV_SMOKE_DIR/api-hits.log"
mkdir -p "$KV_SMOKE_DIR"
: > "$KV_DEVICE_HITS_FILE"

wait_http() {
  local url="$1" name="$2" attempt
  for attempt in $(seq 1 100); do
    if curl --fail --silent --max-time 2 "$url" >/dev/null; then
      echo "Ready: $name at $url"
      return 0
    fi
    sleep 2
  done
  echo "FAIL: $name did not start. See $KV_SMOKE_DIR logs" >&2
  return 1
}

start_services() {
  echo 'Starting NestJS API, device telemetry proxy and Expo Metro...'
  node apps/api/dist/main.js > "$KV_SMOKE_DIR/api.log" 2>&1 &
  API_PID=$!
  node tools/device-smoke/api-proxy.mjs > "$KV_SMOKE_DIR/proxy.log" 2>&1 &
  PROXY_PID=$!
  # The debug app requests the Metro JS bundle at localhost:8081.
  # Android uses adb reverse; iOS Simulator resolves localhost to the Mac host.
  EXPO_PUBLIC_API_URL=http://localhost:3001 \
    pnpm --filter @kv/mobile exec expo start --dev-client --localhost --port 8081 \
    > "$KV_SMOKE_DIR/metro.log" 2>&1 &
  METRO_PID=$!
  wait_http 'http://127.0.0.1:3000/api/lessons' 'NestJS'
  wait_http 'http://127.0.0.1:3001/__ready' 'device HTTP proxy'
  wait_http 'http://127.0.0.1:8081/status' 'Expo Metro'
  # Clear the proxy log after initial readiness checks, so every counted hit belongs to an app launch.
  : > "$KV_DEVICE_HITS_FILE"
}

wait_client_api_hit() {
  local attempt
  for attempt in $(seq 1 75); do
    if grep -q 'valid-api-hit' "$KV_DEVICE_HITS_FILE"; then
      echo 'PASS: mobile client requested NestJS /api/lessons with valid revision and 3 lessons'
      return 0
    fi
    sleep 2
  done
  echo 'FAIL: no API request from mobile client observed' >&2
  return 1
}

cleanup_services() {
  for pid in "${METRO_PID:-}" "${PROXY_PID:-}" "${API_PID:-}"; do
    if [[ -n "$pid" ]]; then kill "$pid" 2>/dev/null || true; fi
  done
}
