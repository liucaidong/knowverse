-- KNOWVERSE Phase N: permit only the event types emitted by the learning-agent domain.
-- Preserve authentication, allowlist, device ownership, sequence, idempotency, payload and causal-envelope checks.

create or replace function public.sync_push_learning_events(
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
  -- Explicit allowlist of every append-only event emitted by the current
  -- learning UI, Goal/Plan/Task managers, learner profile and strategy engine.
  -- Never accept arbitrary client-defined event types.
  v_allowed_types text[] := array[
    'attempt', 'hint', 'hint_revealed', 'completed',
    'checkpoint_started', 'review_started', 'assessment_passed', 'activity',
    'plan_action_started', 'plan_action_completed',
    'learner_preferences_updated',
    'learning_goal_created', 'learning_goal_updated', 'learning_goal_paused',
    'learning_goal_resumed', 'learning_goal_completed', 'learning_goal_cancelled',
    'learning_goal_deleted',
    'learning_plan_generated', 'learning_plan_superseded', 'learning_plan_accepted',
    'learning_plan_rejected',
    'learning_tasks_created', 'learning_task_created', 'learning_task_ready',
    'learning_task_in_progress', 'learning_task_paused', 'learning_task_completed',
    'learning_task_failed', 'learning_task_skipped', 'learning_task_cancelled',
    'learning_strategy_calibrated', 'learning_strategy_feedback'
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

revoke all on function public.sync_push_learning_events(uuid, jsonb) from public, anon;
grant execute on function public.sync_push_learning_events(uuid, jsonb) to authenticated;
