#!/usr/bin/env bash
set -euo pipefail

# Replay every committed Supabase migration against PostgreSQL 17 in isolation.
# This is a database-level migration regression test, not a hosted-Supabase
# integration test. The minimal auth schema below models only the interfaces
# referenced by the repository migrations.
#
# Usage:
#   bash scripts/verify-supabase-migration-replay.sh
#
# Requires Docker. No production URL, credentials, or data are used.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE="${POSTGRES_TEST_IMAGE:-postgres:17-alpine}"
CONTAINER="knowverse-migration-replay-$$"
PASSWORD="local-migration-test-only"
TEST_USER_ID="79256d8a-d64d-4af6-ae0b-87f764037956"

cleanup() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

command -v docker >/dev/null 2>&1 || {
  echo "ERROR: Docker is required for the migration replay test." >&2
  exit 1
}

echo "Starting isolated PostgreSQL 17: $IMAGE"
docker run --rm --detach --name "$CONTAINER" \
  --env "POSTGRES_PASSWORD=$PASSWORD" \
  "$IMAGE" >/dev/null

ready=0
for _ in $(seq 1 60); do
  if docker exec "$CONTAINER" pg_isready -U postgres >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 1
done
if [[ "$ready" != "1" ]]; then
  echo "ERROR: PostgreSQL test container did not become ready." >&2
  docker logs "$CONTAINER" || true
  exit 1
fi

# The official image briefly starts a temporary bootstrap server before the
# final postmaster. Do not mistake that short-lived socket for readiness.
sleep 3
docker exec "$CONTAINER" psql -h 127.0.0.1 -U postgres -Atqc "select 1" >/dev/null

docker exec -i "$CONTAINER" psql -h 127.0.0.1 -U postgres -v ON_ERROR_STOP=1 <<'SQL'
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create database knowverse_empty;
create database knowverse_seeded;
SQL

bootstrap_auth() {
  local database="$1"
  docker exec -i "$CONTAINER" psql -U postgres -d "$database" -v ON_ERROR_STOP=1 <<'SQL'
create schema auth;
create table auth.users (
  id uuid primary key,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  raw_app_meta_data jsonb not null default '{}'::jsonb,
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create function auth.uid()
returns uuid
language sql
stable
as 'select nullif(current_setting(''request.jwt.claim.sub'', true), '''')::uuid';
SQL
}

bootstrap_auth knowverse_empty
bootstrap_auth knowverse_seeded

docker exec "$CONTAINER" psql -U postgres -d knowverse_seeded -v ON_ERROR_STOP=1 \
  -c "insert into auth.users(id, raw_user_meta_data) values ('$TEST_USER_ID'::uuid, '{\"user_name\":\"synthetic migration test\"}'::jsonb)" \
  >/dev/null

apply_all_migrations() {
  local database="$1"
  local count=0
  shopt -s nullglob
  local migrations=("$ROOT_DIR"/supabase/migrations/*.sql)
  shopt -u nullglob

  if [[ "${#migrations[@]}" -eq 0 ]]; then
    echo "ERROR: no migration files found." >&2
    return 1
  fi

  for migration in "${migrations[@]}"; do
    echo "[$database] $(basename "$migration")"
    docker exec -i "$CONTAINER" psql -U postgres -d "$database" \
      -v ON_ERROR_STOP=1 -f - < "$migration" >/dev/null
    count=$((count + 1))
  done
  echo "[$database] applied $count / ${#migrations[@]} migrations"
}

apply_all_migrations knowverse_empty
apply_all_migrations knowverse_seeded

empty_counts="$(docker exec "$CONTAINER" psql -U postgres -d knowverse_empty -Atc \
  "select (select count(*) from auth.users), (select count(*) from private.practice_content_reviewers)")"
[[ "$empty_counts" == "0|0" ]] || {
  echo "ERROR: empty Auth replay unexpectedly created user/reviewer rows: $empty_counts" >&2
  exit 1
}
echo "PASS: empty Auth database replays without manufacturing a reviewer."

seeded_counts="$(docker exec "$CONTAINER" psql -U postgres -d knowverse_seeded -Atc \
  "select (select count(*) from auth.users), (select count(*) from private.practice_content_reviewers), (select count(*) from private.practice_content_reviewers where enabled and role='content_admin')")"
[[ "$seeded_counts" == "1|1|1" ]] || {
  echo "ERROR: seeded Auth replay produced unexpected reviewer state: $seeded_counts" >&2
  exit 1
}
echo "PASS: seeded Auth identity receives exactly one active content_admin row."

# Prove that a replay of the data-provisioning migration cannot re-enable or
# overwrite an existing reviewer row. This intentionally uses test-only data.
docker exec "$CONTAINER" psql -U postgres -d knowverse_seeded -v ON_ERROR_STOP=1 \
  -c "update private.practice_content_reviewers set enabled=false, note='REPLAY_SENTINEL_MUST_REMAIN' where user_id='$TEST_USER_ID'::uuid" \
  >/dev/null
docker exec -i "$CONTAINER" psql -U postgres -d knowverse_seeded -v ON_ERROR_STOP=1 -f - \
  < "$ROOT_DIR/supabase/migrations/20261103224708_phase_m_authorize_initial_content_admin.sql" \
  >/dev/null

preserved="$(docker exec "$CONTAINER" psql -U postgres -d knowverse_seeded -Atc \
  "select enabled::text || '|' || note from private.practice_content_reviewers where user_id='$TEST_USER_ID'::uuid")"
[[ "$preserved" == "false|REPLAY_SENTINEL_MUST_REMAIN" ]] || {
  echo "ERROR: migration replay overwrote existing reviewer state: $preserved" >&2
  exit 1
}
echo "PASS: replay preserves an existing reviewer row byte-for-byte at the tested fields."

echo "SUCCESS: PostgreSQL 17 Supabase migration replay checks passed."
