-- KNOWVERSE: personal learning archive and Local-first event synchronization.
-- This migration deliberately stores facts (learning events), not trusted mastery scores.
-- Apply with Supabase CLI after reviewing the target project and backup.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.authorized_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  note text
);
alter table private.authorized_users enable row level security;
revoke all on private.authorized_users from public, anon, authenticated;

create or replace function private.is_authorized_user(p_user_id uuid)
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

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function private.handle_new_auth_user()
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

drop trigger if exists on_auth_user_created_knowverse on auth.users;
create trigger on_auth_user_created_knowverse
after insert on auth.users
for each row execute function private.handle_new_auth_user();

create table if not exists public.user_devices (
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id uuid not null,
  label text not null default 'KNOWVERSE browser',
  platform text not null default 'web',
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  primary key (user_id, device_id)
);

create table if not exists public.user_sync_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  last_user_seq bigint not null default 0 check (last_user_seq >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.learning_events (
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
  primary key (user_id, event_id),
  unique (user_id, device_id, device_seq),
  unique (user_id, user_seq),
  check (length(event_id) between 1 and 240),
  check (octet_length(event_payload::text) <= 16384)
);

create index if not exists learning_events_user_seq_idx
  on public.learning_events(user_id, user_seq);
create index if not exists learning_events_user_occurred_idx
  on public.learning_events(user_id, occurred_at desc);
create index if not exists learning_events_user_topic_idx
  on public.learning_events(user_id, topic_id, occurred_at desc);
create index if not exists user_devices_last_seen_idx
  on public.user_devices(user_id, last_seen_at desc);

alter table public.profiles enable row level security;
alter table public.user_devices enable row level security;
alter table public.user_sync_state enable row level security;
alter table public.learning_events enable row level security;

drop policy if exists "read own authorized profile" on public.profiles;
create policy "read own authorized profile"
  on public.profiles for select to authenticated
  using (user_id = (select auth.uid()) and private.is_authorized_user((select auth.uid())));

drop policy if exists "read own authorized devices" on public.user_devices;
create policy "read own authorized devices"
  on public.user_devices for select to authenticated
  using (user_id = (select auth.uid()) and private.is_authorized_user((select auth.uid())));

drop policy if exists "read own authorized learning events" on public.learning_events;
create policy "read own authorized learning events"
  on public.learning_events for select to authenticated
  using (user_id = (select auth.uid()) and private.is_authorized_user((select auth.uid())));

revoke all on public.profiles, public.user_devices, public.user_sync_state, public.learning_events from anon, authenticated;
grant select on public.profiles, public.user_devices, public.learning_events to authenticated;

create or replace function public.get_learning_sync_profile()
returns jsonb
language plpgsql
security definer
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

create or replace function public.register_device(
  p_device_id uuid,
  p_label text default 'KNOWVERSE browser',
  p_platform text default 'web'
)
returns jsonb
language plpgsql
security definer
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

create or replace function public.sync_push_learning_events(
  p_device_id uuid,
  p_events jsonb
)
returns jsonb
language plpgsql
security definer
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
    'review_started', 'assessment_passed', 'activity',
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

create or replace function public.sync_pull_learning_events(
  p_after_user_seq bigint default 0,
  p_page_size integer default 100
)
returns jsonb
language plpgsql
security definer
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
