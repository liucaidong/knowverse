#!/usr/bin/env bash
set -Eeuo pipefail
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$PROJECT_ROOT"
export KV_SMOKE_DIR="${KV_SMOKE_DIR:-${RUNNER_TEMP:-/tmp}/knowverse-device-smoke}"
export KV_DEVICE_HITS_FILE="$KV_SMOKE_DIR/api-hits.log"
export KV_DEVICE_TEST_MODE=1
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
  echo 'Starting NestJS API, private CI proxy, Expo Metro...'
  node apps/api/dist/main.js > "$KV_SMOKE_DIR/api.log" 2>&1 & API_PID=$!
  node tools/device-smoke/api-proxy.mjs > "$KV_SMOKE_DIR/proxy.log" 2>&1 & PROXY_PID=$!
  EXPO_PUBLIC_API_URL=http://localhost:3001 \
    pnpm --filter @kv/mobile exec expo start --dev-client --localhost --port 8081 \
    > "$KV_SMOKE_DIR/metro.log" 2>&1 & METRO_PID=$!
  wait_http 'http://127.0.0.1:3000/api/lessons' 'NestJS'
  wait_http 'http://127.0.0.1:3001/__ready' 'device proxy'
  wait_http 'http://127.0.0.1:8081/status' 'Expo Metro'
  : > "$KV_DEVICE_HITS_FILE"
}

scenario() {
  local mode="$1"
  curl --fail --show-error --silent --max-time 6 -X POST \
    -H 'Content-Type: application/json' \
    -d "{\"mode\":\"$mode\"}" 'http://127.0.0.1:3001/__control' \
    | tee -a "$KV_SMOKE_DIR/scenarios.jsonl"
  echo
}

wait_event() {
  local event="$1" target="$2" i current
  for i in $(seq 1 40); do
    current="$(grep -cF " $event" "$KV_DEVICE_HITS_FILE" || true)"
    if (( current >= target )); then
      echo "PASS: $event count $current >= $target"
      return 0
    fi
    sleep 2
  done
  echo "FAIL: $event did not reach $target; see $KV_DEVICE_HITS_FILE" >&2
  return 1
}

wait_client_api_hit() { wait_event valid-api-hit 1; }
cleanup_services() {
  for pid in "${METRO_PID:-}" "${PROXY_PID:-}" "${API_PID:-}"; do
    if [[ -n "$pid" ]]; then kill "$pid" 2>/dev/null || true; fi
  done
}
