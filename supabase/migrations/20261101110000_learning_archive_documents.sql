-- KNOWVERSE Phase 2: versioned archive documents and explicit event envelopes.
-- Requires 20261101070000_learning_cloud_sync.sql to have been applied first.
-- The RPCs are append/compare-and-swap operations; client-supplied user_id is never accepted.

alter table public.learning_events
  add column if not exists schema_version smallint not null default 2,
  add column if not exists causation_event_ids jsonb not null default '[]'::jsonb;

update public.learning_events
set schema_version = case
      when coalesce(nullif(event_payload ->> 'eventSchemaVersion', ''), '2') in ('2', '3')
        then coalesce(nullif(event_payload ->> 'eventSchemaVersion', ''), '2')::smallint
      else 2
    end,
    causation_event_ids = case
      when jsonb_typeof(event_payload -> 'causationEventIds') = 'array' then
        case
          when jsonb_array_length(event_payload -> 'causationEventIds') <= 20
            then event_payload -> 'causationEventIds'
          else '[]'::jsonb
        end
      else '[]'::jsonb
    end;
alter table public.learning_events
  drop constraint if exists learning_events_schema_version_check;
alter table public.learning_events
  add constraint learning_events_schema_version_check
  check (schema_version in (2, 3));

alter table public.learning_events
  drop constraint if exists learning_events_causation_event_ids_check;
alter table public.learning_events
  add constraint learning_events_causation_event_ids_check
  check (
    case
      when jsonb_typeof(causation_event_ids) = 'array'
        then jsonb_array_length(causation_event_ids) <= 20
      else false
    end
  );
create or replace function private.normalize_learning_event_envelope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_schema_version integer;
  v_schema_text text;
  v_causation jsonb;
begin
  v_schema_text := coalesce(nullif(NEW.event_payload ->> 'eventSchemaVersion', ''), '2');
  if v_schema_text not in ('2', '3') then
    raise exception 'unsupported_event_schema_version' using errcode = '22023';
  end if;
  v_schema_version := v_schema_text::integer;

  v_causation := NEW.event_payload -> 'causationEventIds';
  if v_causation is null or jsonb_typeof(v_causation) <> 'array' then
    v_causation := '[]'::jsonb;
  end if;
  if jsonb_array_length(v_causation) > 20 then
    raise exception 'too_many_causation_events' using errcode = '22023';
  end if;

  NEW.schema_version := v_schema_version;
  NEW.causation_event_ids := v_causation;
  NEW.received_at := coalesce(NEW.received_at, now());
  return NEW;
end;
$$;
revoke all on function private.normalize_learning_event_envelope() from public, anon, authenticated;
drop trigger if exists normalize_learning_event_envelope on public.learning_events;
create trigger normalize_learning_event_envelope
before insert or update of event_payload on public.learning_events
for each row execute function private.normalize_learning_event_envelope();

create table if not exists public.user_document_sync_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  last_document_seq bigint not null default 0 check (last_document_seq >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.learning_archive_documents (
  user_id uuid not null references auth.users(id) on delete cascade,
  document_id text not null,
  document_type text not null check (document_type in ('challenge_progress', 'review_session', 'plan_preferences')),
  document_key text not null,
  revision bigint not null check (revision > 0),
  document_seq bigint not null check (document_seq > 0),
  device_id uuid not null,
  updated_at timestamptz not null default now(),
  payload_hash text not null,
  document_payload jsonb not null,
  primary key (user_id, document_id),
  unique (user_id, document_seq),
  check (length(document_id) between 1 and 320),
  check (length(document_key) between 1 and 240),
  check (octet_length(document_payload::text) <= 65536),
  check (jsonb_typeof(document_payload) = 'object')
);

create index if not exists learning_archive_documents_user_seq_idx
  on public.learning_archive_documents(user_id, document_seq);
create index if not exists learning_archive_documents_user_type_idx
  on public.learning_archive_documents(user_id, document_type, document_key);

alter table public.user_document_sync_state enable row level security;
alter table public.learning_archive_documents enable row level security;

drop policy if exists "read own authorized archive documents" on public.learning_archive_documents;
create policy "read own authorized archive documents"
  on public.learning_archive_documents for select to authenticated
  using (user_id = (select auth.uid()) and private.is_authorized_user((select auth.uid())));

revoke all on public.user_document_sync_state, public.learning_archive_documents from anon, authenticated;
grant select on public.learning_archive_documents to authenticated;

create or replace function public.sync_push_learning_documents(
  p_device_id uuid,
  p_documents jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_item jsonb;
  v_document_id text;
  v_document_type text;
  v_document_key text;
  v_base_revision bigint;
  v_local_revision bigint;
  v_payload jsonb;
  v_payload_hash text;
  v_current public.learning_archive_documents%rowtype;
  v_document_seq bigint;
  v_confirmed jsonb := '[]'::jsonb;
  v_conflicts jsonb := '[]'::jsonb;
  v_inserted integer := 0;
begin
  if v_user_id is null then
    raise exception 'authentication_required' using errcode = '28000';
  end if;
  if not private.is_authorized_user(v_user_id) then
    raise exception 'account_not_allowlisted' using errcode = '42501';
  end if;
  if p_device_id is null or p_documents is null or jsonb_typeof(p_documents) <> 'array' then
    raise exception 'invalid_archive_payload' using errcode = '22023';
  end if;
  if jsonb_array_length(p_documents) > 50 then
    raise exception 'archive_batch_limit_exceeded' using errcode = '22023';
  end if;

  perform 1
  from public.user_devices
  where user_id = v_user_id
    and device_id = p_device_id
    and revoked_at is null
  for update;
  if not found then
    raise exception 'device_not_registered_or_revoked' using errcode = '42501';
  end if;

  insert into public.user_document_sync_state(user_id, last_document_seq)
  values (v_user_id, 0)
  on conflict (user_id) do nothing;

  perform 1
  from public.user_document_sync_state
  where user_id = v_user_id
  for update;

  for v_item in select value from jsonb_array_elements(p_documents)
  loop
    v_document_id := v_item ->> 'document_id';
    v_document_type := v_item ->> 'document_type';
    v_document_key := v_item ->> 'document_key';
    v_base_revision := nullif(v_item ->> 'base_revision', '')::bigint;
    v_local_revision := nullif(v_item ->> 'local_revision', '')::bigint;
    v_payload := v_item -> 'document_payload';

    if v_document_id is null
      or v_document_type is null
      or v_payload is null
      or length(v_document_id) not between 1 and 320
      or v_document_key is null
      or length(v_document_key) not between 1 and 240
      or v_document_type not in ('challenge_progress', 'review_session', 'plan_preferences')
      or v_base_revision is null or v_base_revision < 0
      or v_local_revision is null or v_local_revision < 1
      or jsonb_typeof(v_payload) <> 'object'
      or octet_length(v_payload::text) > 65536
    then
      raise exception 'invalid_archive_document:%', coalesce(v_document_id, 'unknown') using errcode = '22023';
    end if;

    v_payload_hash := encode(extensions.digest(convert_to(v_payload::text, 'UTF8'), 'sha256'), 'hex');

    select * into v_current
    from public.learning_archive_documents
    where user_id = v_user_id and document_id = v_document_id
    for update;

    if not found then
      if v_base_revision <> 0 then
        raise exception 'archive_document_revision_missing:%', v_document_id using errcode = '40001';
      end if;
      update public.user_document_sync_state
        set last_document_seq = last_document_seq + 1,
            updated_at = now()
        where user_id = v_user_id
        returning last_document_seq into v_document_seq;
      insert into public.learning_archive_documents(
        user_id, document_id, document_type, document_key, revision,
        document_seq, device_id, updated_at, payload_hash, document_payload
      ) values (
        v_user_id, v_document_id, v_document_type, v_document_key, 1,
        v_document_seq, p_device_id, now(), v_payload_hash, v_payload
      );
      v_inserted := v_inserted + 1;
      v_confirmed := v_confirmed || jsonb_build_array(jsonb_build_object(
        'document_id', v_document_id,
        'local_revision', v_local_revision,
        'revision', 1,
        'document_seq', v_document_seq
      ));
      continue;
    end if;

    -- Idempotent retry: the server may have committed the write while
    -- the browser lost its response. Identical payloads acknowledge the
    -- current revision instead of producing a false compare-and-swap conflict.
    if v_current.payload_hash = v_payload_hash then
      v_confirmed := v_confirmed || jsonb_build_array(jsonb_build_object(
        'document_id', v_document_id,
        'local_revision', v_local_revision,
        'revision', v_current.revision,
        'document_seq', v_current.document_seq
      ));
      continue;
    end if;

    if v_current.revision <> v_base_revision then
      v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object(
        'document_id', v_current.document_id,
        'document_type', v_current.document_type,
        'document_key', v_current.document_key,
        'revision', v_current.revision,
        'document_seq', v_current.document_seq,
        'device_id', v_current.device_id,
        'updated_at', v_current.updated_at,
        'document_payload', v_current.document_payload
      ));
      continue;
    end if;

    update public.user_document_sync_state
      set last_document_seq = last_document_seq + 1,
          updated_at = now()
      where user_id = v_user_id
      returning last_document_seq into v_document_seq;

    update public.learning_archive_documents
      set document_type = v_document_type,
          document_key = v_document_key,
          revision = v_current.revision + 1,
          document_seq = v_document_seq,
          device_id = p_device_id,
          updated_at = now(),
          payload_hash = v_payload_hash,
          document_payload = v_payload
      where user_id = v_user_id and document_id = v_document_id;

    v_inserted := v_inserted + 1;
    v_confirmed := v_confirmed || jsonb_build_array(jsonb_build_object(
      'document_id', v_document_id,
      'local_revision', v_local_revision,
      'revision', v_current.revision + 1,
      'document_seq', v_document_seq
    ));
  end loop;

  return jsonb_build_object(
    'confirmed', v_confirmed,
    'conflicts', v_conflicts,
    'written', v_inserted
  );
end;
$$;

create or replace function public.sync_pull_learning_documents(
  p_after_document_seq bigint default 0,
  p_page_size integer default 100
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_documents jsonb;
  v_next_cursor bigint;
  v_has_more boolean;
  v_page_size integer := greatest(1, least(coalesce(p_page_size, 100), 100));
  v_after bigint := greatest(0, coalesce(p_after_document_seq, 0));
begin
  if v_user_id is null then
    raise exception 'authentication_required' using errcode = '28000';
  end if;
  if not private.is_authorized_user(v_user_id) then
    raise exception 'account_not_allowlisted' using errcode = '42501';
  end if;

  with page as (
    select document_id, document_type, document_key, revision, document_seq,
      device_id, updated_at, document_payload
    from public.learning_archive_documents
    where user_id = v_user_id and document_seq > v_after
    order by document_seq
    limit v_page_size
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'document_id', document_id,
      'document_type', document_type,
      'document_key', document_key,
      'revision', revision,
      'document_seq', document_seq,
      'device_id', device_id,
      'updated_at', updated_at,
      'document_payload', document_payload
    ) order by document_seq), '[]'::jsonb),
    coalesce(max(document_seq), v_after)
  into v_documents, v_next_cursor
  from page;

  select exists (
    select 1 from public.learning_archive_documents
    where user_id = v_user_id and document_seq > v_next_cursor
  ) into v_has_more;

  return jsonb_build_object(
    'documents', v_documents,
    'next_cursor', v_next_cursor,
    'has_more', v_has_more
  );
end;
$$;

revoke all on function public.sync_push_learning_documents(uuid, jsonb) from public, anon;
revoke all on function public.sync_pull_learning_documents(bigint, integer) from public, anon;
grant execute on function public.sync_push_learning_documents(uuid, jsonb) to authenticated;
grant execute on function public.sync_pull_learning_documents(bigint, integer) to authenticated;

comment on column public.learning_events.schema_version is
  'Normalized event envelope schema version; payload eventSchemaVersion is retained for backwards compatibility.';
comment on column public.learning_events.causation_event_ids is
  'Optional causal references; never inferred from cross-device wall-clock timestamps.';
comment on table public.learning_archive_documents is
  'Versioned optimistic-concurrency documents for resumable challenge/review state and preferences. Mastery state remains event-derived.';