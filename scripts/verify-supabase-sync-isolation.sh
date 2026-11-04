#!/usr/bin/env bash
set -euo pipefail

# Exercise the real repository migrations and authenticated sync RPCs against
# isolated PostgreSQL 17. This is not a hosted Supabase / physical-device test.
# No production credentials, URLs, or data are used.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE="${POSTGRES_TEST_IMAGE:-postgres:17-alpine}"
CONTAINER="knowverse-sync-isolation-$$"
PASSWORD="local-sync-test-only"
USER_A="11111111-1111-4111-8111-111111111111"
USER_B="22222222-2222-4222-8222-222222222222"
DEVICE_A="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
DEVICE_A2="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"

cleanup() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

command -v docker >/dev/null 2>&1 || {
  echo "ERROR: Docker is required for the sync isolation test." >&2
  exit 1
}

echo "Starting isolated PostgreSQL 17: $IMAGE"
docker run --rm --detach --name "$CONTAINER" \
  --env "POSTGRES_PASSWORD=$PASSWORD" "$IMAGE" >/dev/null

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
sleep 3
docker exec "$CONTAINER" psql -h 127.0.0.1 -U postgres -Atqc "select 1" >/dev/null

docker exec -i "$CONTAINER" psql -h 127.0.0.1 -U postgres -v ON_ERROR_STOP=1 <<'SQL'
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create database knowverse_sync_test;
SQL

docker exec -i "$CONTAINER" psql -U postgres -d knowverse_sync_test -v ON_ERROR_STOP=1 <<'SQL'
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
grant usage on schema auth to authenticated;
grant execute on function auth.uid() to authenticated;
SQL

shopt -s nullglob
migrations=("$ROOT_DIR"/supabase/migrations/*.sql)
shopt -u nullglob
[[ "${#migrations[@]}" -gt 0 ]] || { echo "ERROR: no migrations found." >&2; exit 1; }

for migration in "${migrations[@]}"; do
  echo "[migration] $(basename "$migration")"
  docker exec -i "$CONTAINER" psql -U postgres -d knowverse_sync_test \
    -v ON_ERROR_STOP=1 -f - < "$migration" >/dev/null
done

# Supabase grants authenticated clients usage on the extensions schema; the
# pgcrypto digest calls are part of the real sync RPC implementation.
docker exec "$CONTAINER" psql -U postgres -d knowverse_sync_test -v ON_ERROR_STOP=1 \
  -c "grant usage on schema extensions to authenticated" >/dev/null

# Synthetic Auth identities are provisioned only after the schema is built.
# The trigger creates their profiles; the test-only allowlist simulates the
# explicit staging authorization step needed before a learner may sync.
docker exec -i "$CONTAINER" psql -U postgres -d knowverse_sync_test \
  -v ON_ERROR_STOP=1 <<SQL
insert into auth.users(id, email) values
  ('$USER_A'::uuid, 'learner-a@example.invalid'),
  ('$USER_B'::uuid, 'learner-b@example.invalid');
insert into private.authorized_users(user_id, note) values
  ('$USER_A'::uuid, 'synthetic sync isolation test A'),
  ('$USER_B'::uuid, 'synthetic sync isolation test B');
SQL

# Account A registers two devices and atomically commits its first event +
# document. A second device then attempts a stale document write in a batch
# with a new event; the returned CAS conflict must roll back that event.
docker exec -i "$CONTAINER" psql -U postgres -d knowverse_sync_test \
  -v ON_ERROR_STOP=1 <<SQL
set role authenticated;
select set_config('request.jwt.claim.sub', '$USER_A', false);
select public.register_device('$DEVICE_A'::uuid, 'Test desktop', 'desktop-web');
select public.register_device('$DEVICE_A2'::uuid, 'Test mobile', 'mobile-web');

do \$\$
declare
  v_result jsonb;
begin
  v_result := public.sync_commit_learning_batch(
    '$DEVICE_A'::uuid,
    '$USER_A'::uuid,
    '[{"event_id":"evt-a1","device_seq":1,"event_payload":{"id":"evt-a1","type":"attempt","at":"2026-11-04T01:00:00Z","topicId":"promise","competencyIds":["thenable-adoption"],"eventSchemaVersion":3,"correct":false,"gapId":"thenable-get-vs-call"}}]'::jsonb,
    '[{"document_id":"challenge_progress:promise","document_type":"challenge_progress","document_key":"promise","base_revision":0,"local_revision":1,"document_payload":{"currentStep":"thenable-adoption","status":"in-progress"}}]'::jsonb
  );
  if v_result ->> 'status' <> 'committed'
     or jsonb_array_length(v_result #> '{events,confirmed}') <> 1
     or jsonb_array_length(v_result #> '{documents,confirmed}') <> 1 then
    raise exception 'initial atomic event/document commit failed: %', v_result;
  end if;

  -- Retry the same immutable event with the same device sequence. It must
  -- acknowledge the existing event without allocating another user sequence.
  v_result := public.sync_commit_learning_batch(
    '$DEVICE_A'::uuid,
    '$USER_A'::uuid,
    '[{"event_id":"evt-a1","device_seq":1,"event_payload":{"id":"evt-a1","type":"attempt","at":"2026-11-04T01:00:00Z","topicId":"promise","competencyIds":["thenable-adoption"],"eventSchemaVersion":3,"correct":false,"gapId":"thenable-get-vs-call"}}]'::jsonb,
    '[]'::jsonb
  );
  if v_result ->> 'status' <> 'committed'
     or (v_result #>> '{events,confirmed,0,duplicate}')::boolean is not true then
    raise exception 'idempotent event retry failed: %', v_result;
  end if;

  -- A stale write from the second device is a CAS conflict. The earlier
  -- valid new document in this same batch must also roll back, along with
  -- evt-a2, proving all-or-nothing batch semantics.
  v_result := public.sync_commit_learning_batch(
    '$DEVICE_A2'::uuid,
    '$USER_A'::uuid,
    '[{"event_id":"evt-a2","device_seq":1,"event_payload":{"id":"evt-a2","type":"attempt","at":"2026-11-04T01:01:00Z","topicId":"promise","competencyIds":["thenable-adoption"],"eventSchemaVersion":3,"correct":false,"gapId":"thenable-get-vs-call","attemptNumber":2}}]'::jsonb,
    '[{"document_id":"challenge_progress:must-rollback","document_type":"challenge_progress","document_key":"must-rollback","base_revision":0,"local_revision":1,"document_payload":{"status":"must-rollback"}},{"document_id":"challenge_progress:promise","document_type":"challenge_progress","document_key":"promise","base_revision":0,"local_revision":2,"document_payload":{"currentStep":"stale-phone-step","status":"in-progress"}}]'::jsonb
  );
  if v_result ->> 'status' <> 'conflict'
     or jsonb_array_length(v_result #> '{documents,conflicts}') <> 1 then
    raise exception 'expected document CAS conflict: %', v_result;
  end if;

  -- A fresh revision from the second device commits both the event and doc.
  v_result := public.sync_commit_learning_batch(
    '$DEVICE_A2'::uuid,
    '$USER_A'::uuid,
    '[{"event_id":"evt-a2","device_seq":1,"event_payload":{"id":"evt-a2","type":"attempt","at":"2026-11-04T01:01:00Z","topicId":"promise","competencyIds":["thenable-adoption"],"eventSchemaVersion":3,"correct":false,"gapId":"thenable-get-vs-call","attemptNumber":2}}]'::jsonb,
    '[{"document_id":"challenge_progress:promise","document_type":"challenge_progress","document_key":"promise","base_revision":1,"local_revision":2,"document_payload":{"currentStep":"phone-step","status":"in-progress"}}]'::jsonb
  );
  if v_result ->> 'status' <> 'committed'
     or jsonb_array_length(v_result #> '{events,confirmed}') <> 1
     or jsonb_array_length(v_result #> '{documents,confirmed}') <> 1 then
    raise exception 'fresh CAS revision did not commit atomically: %', v_result;
  end if;
end;
\$\$;

do \$\$
declare
  v_page jsonb;
begin
  v_page := public.sync_pull_learning_events_for_account('$USER_A'::uuid, 0, 1);
  if jsonb_array_length(v_page -> 'events') <> 1
     or (v_page ->> 'has_more')::boolean is not true
     or (v_page ->> 'next_cursor')::bigint <> 1 then
    raise exception 'event pagination cursor contract failed: %', v_page;
  end if;
end;
\$\$;
reset role;
SQL

# The failed CAS batch must leave only evt-a1 and evt-a2, and the document
# must be revision 2. The conflicting stale event must never be committed.
state="$(docker exec "$CONTAINER" psql -U postgres -d knowverse_sync_test -Atc \
  "select (select count(*) from public.learning_events where user_id='$USER_A'::uuid), (select revision from public.learning_archive_documents where user_id='$USER_A'::uuid and document_id='challenge_progress:promise'), (select document_payload->>'currentStep' from public.learning_archive_documents where user_id='$USER_A'::uuid and document_id='challenge_progress:promise'), (select count(*) from public.learning_archive_documents where user_id='$USER_A'::uuid and document_id='challenge_progress:must-rollback')")"
[[ "$state" == "2|2|phone-step|0" ]] || {
  echo "ERROR: event/document state after CAS checks is unexpected: $state" >&2
  exit 1
}
echo "PASS: atomic sync commit, immutable event idempotency, CAS rollback and pagination."

# Account B must see no rows from A, must be unable to call an RPC for A by
# spoofing expected_user_id, and cannot use A's registered device to write.
docker exec -i "$CONTAINER" psql -U postgres -d knowverse_sync_test \
  -v ON_ERROR_STOP=1 <<SQL
set role authenticated;
select set_config('request.jwt.claim.sub', '$USER_B', false);

do \$\$
declare
  v_count bigint;
  v_page jsonb;
begin
  select count(*) into v_count
  from public.learning_events
  where user_id = '$USER_A'::uuid;
  if v_count <> 0 then
    raise exception 'RLS leaked another account events to account B: %', v_count;
  end if;

  select count(*) into v_count
  from public.learning_archive_documents
  where user_id = '$USER_A'::uuid;
  if v_count <> 0 then
    raise exception 'RLS leaked another account documents to account B: %', v_count;
  end if;

  v_page := public.sync_pull_learning_events_for_account('$USER_B'::uuid, 0, 100);
  if jsonb_array_length(v_page -> 'events') <> 0 then
    raise exception 'account B unexpectedly received event rows: %', v_page;
  end if;

  begin
    perform public.sync_pull_learning_events_for_account('$USER_A'::uuid, 0, 100);
    raise exception 'cross-account pull was unexpectedly accepted' using errcode = 'P0001';
  exception when sqlstate '42501' then
    null;
  end;

  begin
    perform public.sync_commit_learning_batch(
      '$DEVICE_A'::uuid,
      '$USER_B'::uuid,
      '[{"event_id":"evt-b-spoof","device_seq":1,"event_payload":{"id":"evt-b-spoof","type":"attempt","at":"2026-11-04T02:00:00Z","topicId":"promise","competencyIds":["thenable-adoption"],"eventSchemaVersion":3}}]'::jsonb,
      '[]'::jsonb
    );
    raise exception 'account B unexpectedly wrote using account A device' using errcode = 'P0001';
  exception when insufficient_privilege then
    null;
  end;
end;
\$\$;
reset role;
SQL

echo "PASS: RLS and authenticated sync RPCs prevent cross-account reads and device spoofing."
echo "SUCCESS: PostgreSQL 17 Supabase sync isolation checks passed."
