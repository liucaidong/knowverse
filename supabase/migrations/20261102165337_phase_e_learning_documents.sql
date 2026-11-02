-- KNOWVERSE Phase E: extend the existing versioned archive-document contract.
-- No tables, user rows, event history, or local databases are dropped or reset.
-- Each document is still user-scoped, device-authenticated and revision/CAS protected.

alter table public.learning_archive_documents
  drop constraint learning_archive_documents_document_type_check;

alter table public.learning_archive_documents
  add constraint learning_archive_documents_document_type_check
  check (document_type in (
    'challenge_progress',
    'review_session',
    'plan_preferences',
    'learner_profile',
    'learning_goal',
    'learning_plan',
    'learning_plan_head',
    'learning_task',
    'learning_agent_session',
    'learning_agent_message'
  ));

create or replace function public.sync_push_learning_documents(
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
      or v_document_type not in ('challenge_progress', 'review_session', 'plan_preferences', 'learner_profile', 'learning_goal', 'learning_plan', 'learning_plan_head', 'learning_task', 'learning_agent_session', 'learning_agent_message')
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

revoke all on function public.sync_push_learning_documents(uuid, jsonb) from public, anon;
grant execute on function public.sync_push_learning_documents(uuid, jsonb) to authenticated;

comment on table public.learning_archive_documents is
  'Versioned optimistic-concurrency documents for challenge/review state, learner preferences, goals, immutable plan revisions, task execution and append-only Agent messages. Mastery remains event-derived.';
