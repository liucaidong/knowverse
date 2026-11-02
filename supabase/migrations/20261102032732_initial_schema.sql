-- KNOWVERSE initial Supabase schema. This is the single source of truth for a fresh project.
-- Apply with `supabase db push` after linking the intended project.

-- KNOWVERSE: personal learning archive and Local-first event synchronization.
-- This migration deliberately stores facts (learning events), not trusted mastery scores.
-- 

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table private.authorized_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  note text
);
alter table private.authorized_users enable row level security;
revoke all on private.authorized_users from public, anon, authenticated;

create function private.is_authorized_user(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from private.authorized_users au
    where au.user_id = p_user_id
      and au.enabled = true
  );
$$;
revoke all on function private.is_authorized_user(uuid) from public, anon;
-- This schema is not exposed by PostgREST; privileges below allow RLS to call the predicate.
grant usage on schema private to authenticated;
grant execute on function private.is_authorized_user(uuid) to authenticated;

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create function private.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles(user_id, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'user_name', new.raw_user_meta_data ->> 'name'),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (user_id) do nothing;
  return new;
end;
$$;
revoke all on function private.handle_new_auth_user() from public, anon, authenticated;

create trigger on_auth_user_created_knowverse
after insert on auth.users
for each row execute function private.handle_new_auth_user();

create table public.user_devices (
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id uuid not null,
  label text not null default 'KNOWVERSE browser',
  platform text not null default 'web',
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  primary key (user_id, device_id)
);

create table public.user_sync_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  last_user_seq bigint not null default 0 check (last_user_seq >= 0),
  updated_at timestamptz not null default now()
);

create table public.learning_events (
  user_id uuid not null references auth.users(id) on delete cascade,
  event_id text not null,
  device_id uuid not null,
  device_seq bigint not null check (device_seq > 0),
  user_seq bigint not null check (user_seq > 0),
  event_type text not null,
  topic_id text,
  occurred_at timestamptz not null,
  received_at timestamptz not null default now(),
  payload_hash text not null,
  event_payload jsonb not null,
  schema_version smallint not null default 2 check (schema_version = 2),
  causation_event_ids jsonb not null default '[]'::jsonb
    check (case when jsonb_typeof(causation_event_ids) = 'array' then jsonb_array_length(causation_event_ids) <= 20 else false end),
  primary key (user_id, event_id),
  unique (user_id, device_id, device_seq),
  unique (user_id, user_seq),
  check (length(event_id) between 1 and 240),
  check (octet_length(event_payload::text) <= 16384)
);

create index learning_events_user_seq_idx
  on public.learning_events(user_id, user_seq);
create index learning_events_user_occurred_idx
  on public.learning_events(user_id, occurred_at desc);
create index learning_events_user_topic_idx
  on public.learning_events(user_id, topic_id, occurred_at desc);
create index user_devices_last_seen_idx
  on public.user_devices(user_id, last_seen_at desc);

alter table public.profiles enable row level security;
alter table public.user_devices enable row level security;
alter table public.user_sync_state enable row level security;
alter table public.learning_events enable row level security;

create policy "read own authorized profile" on public.profiles for select to authenticated
  using (user_id = (select auth.uid()) and private.is_authorized_user((select auth.uid())));
create policy "read own authorized devices" on public.user_devices for select to authenticated
  using (user_id = (select auth.uid()) and private.is_authorized_user((select auth.uid())));
create policy "register own authorized device" on public.user_devices for insert to authenticated
  with check (user_id = (select auth.uid()) and private.is_authorized_user((select auth.uid())));
create policy "update own authorized device" on public.user_devices for update to authenticated
  using (user_id = (select auth.uid()) and private.is_authorized_user((select auth.uid())))
  with check (user_id = (select auth.uid()) and private.is_authorized_user((select auth.uid())));
create policy "read own authorized sync state" on public.user_sync_state for select to authenticated
  using (user_id = (select auth.uid()) and private.is_authorized_user((select auth.uid())));
create policy "create own authorized sync state" on public.user_sync_state for insert to authenticated
  with check (user_id = (select auth.uid()) and private.is_authorized_user((select auth.uid())));
create policy "update own authorized sync state" on public.user_sync_state for update to authenticated
  using (user_id = (select auth.uid()) and private.is_authorized_user((select auth.uid())))
  with check (user_id = (select auth.uid()) and private.is_authorized_user((select auth.uid())));
create policy "read own authorized learning events" on public.learning_events for select to authenticated
  using (user_id = (select auth.uid()) and private.is_authorized_user((select auth.uid())));
create policy "append own authorized learning events" on public.learning_events for insert to authenticated
  with check (user_id = (select auth.uid()) and private.is_authorized_user((select auth.uid())));


create function public.get_learning_sync_profile()
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_profile public.profiles%rowtype;
begin
  if v_user_id is null then
    raise exception 'authentication_required' using errcode = '28000';
  end if;

  if not private.is_authorized_user(v_user_id) then
    return jsonb_build_object('authorized', false);
  end if;

  select * into v_profile
  from public.profiles
  where user_id = v_user_id;

  return jsonb_build_object(
    'authorized', true,
    'user_id', v_user_id,
    'display_name', v_profile.display_name,
    'avatar_url', v_profile.avatar_url
  );
end;
$$;

create function public.register_device(
  p_device_id uuid,
  p_label text default 'KNOWVERSE browser',
  p_platform text default 'web'
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_revoked_at timestamptz;
begin
  if v_user_id is null then
    raise exception 'authentication_required' using errcode = '28000';
  end if;
  if not private.is_authorized_user(v_user_id) then
    raise exception 'account_not_allowlisted' using errcode = '42501';
  end if;
  if p_device_id is null then
    raise exception 'device_id_required' using errcode = '22023';
  end if;

  select revoked_at into v_revoked_at
  from public.user_devices
  where user_id = v_user_id and device_id = p_device_id;

  if found and v_revoked_at is not null then
    raise exception 'device_revoked' using errcode = '42501';
  end if;

  insert into public.user_devices(user_id, device_id, label, platform, last_seen_at)
  values (
    v_user_id,
    p_device_id,
    left(coalesce(nullif(p_label, ''), 'KNOWVERSE browser'), 80),
    left(coalesce(nullif(p_platform, ''), 'web'), 24),
    now()
  )
  on conflict (user_id, device_id) do update
    set label = excluded.label,
        platform = excluded.platform,
        last_seen_at = now();

  return jsonb_build_object('registered', true, 'device_id', p_device_id);
end;
$$;

create function public.sync_push_learning_events(
  p_device_id uuid,
  p_events jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_item jsonb;
  v_payload jsonb;
  v_event_id text;
  v_event_type text;
  v_device_seq bigint;
  v_user_seq bigint;
  v_occurred_at timestamptz;
  v_payload_hash text;
  v_existing_hash text;
  v_existing_seq bigint;
  v_confirmed jsonb := '[]'::jsonb;
  v_inserted integer := 0;
  v_allowed_types text[] := array[
    'attempt', 'hint', 'hint_revealed', 'completed',
    'checkpoint_started', 'review_started', 'assessment_passed', 'activity',
    'plan_action_started', 'plan_action_completed'
  ];
begin
  if v_user_id is null then
    raise exception 'authentication_required' using errcode = '28000';
  end if;
  if not private.is_authorized_user(v_user_id) then
    raise exception 'account_not_allowlisted' using errcode = '42501';
  end if;
  if p_device_id is null or jsonb_typeof(p_events) <> 'array' then
    raise exception 'invalid_sync_payload' using errcode = '22023';
  end if;
  if jsonb_array_length(p_events) > 100 then
    raise exception 'batch_limit_exceeded' using errcode = '22023';
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

  insert into public.user_sync_state(user_id, last_user_seq)
  values (v_user_id, 0)
  on conflict (user_id) do nothing;

  perform 1
  from public.user_sync_state
  where user_id = v_user_id
  for update;

  for v_item in select value from jsonb_array_elements(p_events)
  loop
    v_payload := v_item -> 'event_payload';
    v_event_id := coalesce(v_item ->> 'event_id', v_payload ->> 'id');
    v_event_type := v_payload ->> 'type';
    v_device_seq := nullif(v_item ->> 'device_seq', '')::bigint;

    if coalesce(jsonb_typeof(v_payload) <> 'object', true)
      or v_event_id is null
      or v_event_id <> (v_payload ->> 'id')
      or not coalesce(v_event_type = any(v_allowed_types), false)
      or v_device_seq is null
      or v_device_seq <= 0
      or coalesce(jsonb_typeof(v_payload -> 'competencyIds') <> 'array', true)
      or octet_length(v_payload::text) > 16384
      or coalesce(v_payload ->> 'eventSchemaVersion', '2') not in ('2', '3')
    then
      raise exception 'invalid_learning_event:%', coalesce(v_event_id, 'unknown') using errcode = '22023';
    end if;

    if jsonb_array_length(v_payload -> 'competencyIds') > 20 then
      raise exception 'too_many_competencies:%', v_event_id using errcode = '22023';
    end if;

    v_occurred_at := (v_payload ->> 'at')::timestamptz;
    v_payload_hash := encode(extensions.digest(convert_to(v_payload::text, 'UTF8'), 'sha256'), 'hex');

    select payload_hash, user_seq into v_existing_hash, v_existing_seq
    from public.learning_events
    where user_id = v_user_id and event_id = v_event_id;

    if found then
      if v_existing_hash <> v_payload_hash then
        raise exception 'event_id_payload_conflict:%', v_event_id using errcode = '23505';
      end if;
      v_confirmed := v_confirmed || jsonb_build_array(jsonb_build_object(
        'event_id', v_event_id, 'user_seq', v_existing_seq, 'duplicate', true
      ));
      continue;
    end if;

    if exists (
      select 1 from public.learning_events
      where user_id = v_user_id and device_id = p_device_id and device_seq = v_device_seq
    ) then
      raise exception 'device_sequence_conflict:%', v_device_seq using errcode = '23505';
    end if;

    update public.user_sync_state
      set last_user_seq = last_user_seq + 1,
          updated_at = now()
      where user_id = v_user_id
      returning last_user_seq into v_user_seq;

    insert into public.learning_events(
      user_id, event_id, device_id, device_seq, user_seq,
      event_type, topic_id, occurred_at, payload_hash, event_payload
    ) values (
      v_user_id, v_event_id, p_device_id, v_device_seq, v_user_seq,
      v_event_type, v_payload ->> 'topicId', v_occurred_at, v_payload_hash, v_payload
    );

    v_inserted := v_inserted + 1;
    v_confirmed := v_confirmed || jsonb_build_array(jsonb_build_object(
      'event_id', v_event_id, 'user_seq', v_user_seq, 'duplicate', false
    ));
  end loop;

  return jsonb_build_object('confirmed', v_confirmed, 'inserted', v_inserted);
end;
$$;

create function public.sync_pull_learning_events(
  p_after_user_seq bigint default 0,
  p_page_size integer default 100
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_events jsonb;
  v_next_cursor bigint;
  v_has_more boolean;
  v_page_size integer := greatest(1, least(coalesce(p_page_size, 100), 100));
  v_after bigint := greatest(0, coalesce(p_after_user_seq, 0));
begin
  if v_user_id is null then
    raise exception 'authentication_required' using errcode = '28000';
  end if;
  if not private.is_authorized_user(v_user_id) then
    raise exception 'account_not_allowlisted' using errcode = '42501';
  end if;

  with page as (
    select event_id, user_seq, device_id, device_seq, occurred_at, event_payload
    from public.learning_events
    where user_id = v_user_id and user_seq > v_after
    order by user_seq
    limit v_page_size
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'event_id', event_id,
      'user_seq', user_seq,
      'device_id', device_id,
      'device_seq', device_seq,
      'occurred_at', occurred_at,
      'event_payload', event_payload
    ) order by user_seq), '[]'::jsonb),
    coalesce(max(user_seq), v_after)
  into v_events, v_next_cursor
  from page;

  select exists (
    select 1 from public.learning_events
    where user_id = v_user_id and user_seq > v_next_cursor
  ) into v_has_more;

  return jsonb_build_object(
    'events', v_events,
    'next_cursor', v_next_cursor,
    'has_more', v_has_more
  );
end;
$$;

revoke all on function public.get_learning_sync_profile() from public, anon;
revoke all on function public.register_device(uuid, text, text) from public, anon;
revoke all on function public.sync_push_learning_events(uuid, jsonb) from public, anon;
revoke all on function public.sync_pull_learning_events(bigint, integer) from public, anon;

grant execute on function public.get_learning_sync_profile() to authenticated;
grant execute on function public.register_device(uuid, text, text) to authenticated;
grant execute on function public.sync_push_learning_events(uuid, jsonb) to authenticated;
grant execute on function public.sync_pull_learning_events(bigint, integer) to authenticated;

comment on table public.learning_events is
  'Append-only personal learning facts. Mastery, confidence, gap state and plans are derived by the versioned client reducer.';
comment on table private.authorized_users is
  'Administrator-maintained allowlist. Never expose this table through the Supabase Data API.';


-- Event envelope validation and current archive document tables.

create function private.normalize_learning_event_envelope()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_schema_version integer;
  v_schema_text text;
  v_causation jsonb;
begin
  v_schema_text := coalesce(nullif(NEW.event_payload ->> 'eventSchemaVersion', ''), '2');
  if v_schema_text <> '2' then
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
create trigger normalize_learning_event_envelope
before insert or update of event_payload on public.learning_events
for each row execute function private.normalize_learning_event_envelope();

create table public.user_document_sync_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  last_document_seq bigint not null default 0 check (last_document_seq >= 0),
  updated_at timestamptz not null default now()
);

create table public.learning_archive_documents (
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

create index learning_archive_documents_user_seq_idx
  on public.learning_archive_documents(user_id, document_seq);
create index learning_archive_documents_user_type_idx
  on public.learning_archive_documents(user_id, document_type, document_key);

alter table public.user_document_sync_state enable row level security;
alter table public.learning_archive_documents enable row level security;
create policy "read own authorized document sync state" on public.user_document_sync_state for select to authenticated
  using (user_id = (select auth.uid()) and private.is_authorized_user((select auth.uid())));
create policy "create own authorized document sync state" on public.user_document_sync_state for insert to authenticated
  with check (user_id = (select auth.uid()) and private.is_authorized_user((select auth.uid())));
create policy "update own authorized document sync state" on public.user_document_sync_state for update to authenticated
  using (user_id = (select auth.uid()) and private.is_authorized_user((select auth.uid())))
  with check (user_id = (select auth.uid()) and private.is_authorized_user((select auth.uid())));
create policy "read own authorized archive documents" on public.learning_archive_documents for select to authenticated
  using (user_id = (select auth.uid()) and private.is_authorized_user((select auth.uid())));
create policy "create own authorized archive documents" on public.learning_archive_documents for insert to authenticated
  with check (user_id = (select auth.uid()) and private.is_authorized_user((select auth.uid())));
create policy "update own authorized archive documents" on public.learning_archive_documents for update to authenticated
  using (user_id = (select auth.uid()) and private.is_authorized_user((select auth.uid())))
  with check (user_id = (select auth.uid()) and private.is_authorized_user((select auth.uid())));


create function public.sync_push_learning_documents(
  p_device_id uuid,
  p_documents jsonb
)
returns jsonb
language plpgsql
security invoker
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

create function public.sync_pull_learning_documents(
  p_after_document_seq bigint default 0,
  p_page_size integer default 100
)
returns jsonb
language plpgsql
security invoker
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
  'Current normalized event envelope schema version.';
comment on column public.learning_events.causation_event_ids is
  'Optional causal references; never inferred from cross-device wall-clock timestamps.';
comment on table public.learning_archive_documents is
  'Versioned optimistic-concurrency documents for resumable challenge/review state and preferences. Mastery state remains event-derived.';

revoke all on public.profiles, public.user_devices, public.user_sync_state,
  public.learning_events, public.user_document_sync_state,
  public.learning_archive_documents from public, anon, authenticated;
grant select on public.profiles to authenticated;
grant select, insert, update on public.user_devices, public.user_sync_state,
  public.user_document_sync_state, public.learning_archive_documents to authenticated;
grant select, insert on public.learning_events to authenticated;

do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    execute 'revoke all on function public.rls_auto_enable() from public, anon, authenticated';
  end if;
end;
$$;
