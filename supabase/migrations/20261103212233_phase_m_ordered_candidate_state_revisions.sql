-- Phase M hardening: monotonic per-candidate state revisions.
-- Timestamps are not a safe ordering key when multiple RPC calls happen in one transaction.
create or replace function public.append_practice_candidate_quality_record(
  p_user_id uuid,
  p_candidate_id text,
  p_record_type text,
  p_record_id text,
  p_candidate_hash text,
  p_payload jsonb,
  p_expected_status text default null,
  p_next_status text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_state_revision bigint := 0;
  v_allowed boolean := false;
  v_latest_review jsonb;
  v_pending jsonb;
  v_state_id text;
  v_record_payload jsonb;
  v_now timestamptz := clock_timestamp();
begin
  if p_user_id is null
    or p_candidate_id is null
    or p_candidate_id !~ '^[A-Za-z0-9_-]{8,120}$'
    or p_record_type not in (
      'state', 'validation', 'review', 'review_error', 'approval',
      'rejection', 'registration_pending', 'publication_pr', 'registered'
    )
    or p_record_id is null
    or length(p_record_id) not between 8 and 240
    or p_candidate_hash is null
    or p_candidate_hash !~ '^[a-f0-9]{64}$'
    or p_payload is null
    or jsonb_typeof(p_payload) <> 'object'
    or octet_length(p_payload::text) > 65536
  then
    raise exception 'invalid_practice_quality_record' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_user_id::text || ':' || p_candidate_id, 0)
  );

  select
    coalesce((record.payload ->> 'to'), 'draft'),
    coalesce((record.payload ->> 'revision')::bigint, 0)
  into v_status, v_state_revision
  from public.practice_candidate_quality_records record
  where record.user_id = p_user_id
    and record.candidate_id = p_candidate_id
    and record.record_type = 'state'
  order by
    coalesce((record.payload ->> 'revision')::bigint, 0) desc,
    record.created_at desc,
    record.id desc
  limit 1;

  if not found then
    v_status := 'draft';
    v_state_revision := 0;
  end if;

  if p_expected_status is not null and p_expected_status <> v_status then
    raise exception 'practice_candidate_state_conflict:%:%', p_expected_status, v_status
      using errcode = '40001';
  end if;

  if p_next_status is not null then
    v_allowed := case v_status
      when 'draft' then p_next_status in ('validation', 'rejected', 'deleted')
      when 'validation' then p_next_status in ('validation', 'machine_review', 'needs_revision', 'rejected', 'deleted')
      when 'machine_review' then p_next_status in ('validation', 'machine_reviewed', 'needs_revision', 'rejected')
      when 'needs_revision' then p_next_status in ('validation', 'rejected', 'deleted')
      when 'machine_reviewed' then p_next_status in ('machine_review', 'approved', 'rejected')
      when 'approved' then p_next_status = 'registration_pending'
      when 'registration_pending' then p_next_status = 'registered'
      else false
    end;
    if not v_allowed then
      raise exception 'invalid_practice_candidate_transition:%:%', v_status, p_next_status
        using errcode = '42501';
    end if;
  end if;

  if p_record_type = 'approval' then
    if not private.is_practice_content_reviewer(p_user_id) then
      raise exception 'practice_content_reviewer_required' using errcode = '42501';
    end if;
    select record.payload into v_latest_review
    from public.practice_candidate_quality_records record
    where record.user_id = p_user_id
      and record.candidate_id = p_candidate_id
      and record.record_type = 'review'
      and record.candidate_hash = p_candidate_hash
    order by record.created_at desc, record.id desc
    limit 1;
    if v_latest_review is null
      or v_latest_review ->> 'verdict' <> 'pass'
      or v_latest_review ->> 'reviewId' is distinct from p_payload ->> 'reviewId'
    then
      raise exception 'matching_pass_review_required' using errcode = '42501';
    end if;
  end if;

  if p_record_type = 'registration_pending' then
    if v_status <> 'approved' then
      raise exception 'human_approval_required' using errcode = '42501';
    end if;
    if not exists (
      select 1
      from public.practice_candidate_quality_records approval
      where approval.user_id = p_user_id
        and approval.candidate_id = p_candidate_id
        and approval.record_type = 'approval'
        and approval.candidate_hash = p_candidate_hash
        and approval.record_id = p_payload ->> 'approvalRecordId'
        and approval.payload ->> 'reviewId' = p_payload ->> 'reviewId'
    ) then
      raise exception 'matching_human_approval_required' using errcode = '42501';
    end if;
  end if;

  if p_record_type = 'registered' then
    select record.payload into v_pending
    from public.practice_candidate_quality_records record
    where record.user_id = p_user_id
      and record.candidate_id = p_candidate_id
      and record.record_type = 'registration_pending'
      and record.candidate_hash = p_candidate_hash
      and record.record_id = p_payload ->> 'registrationPendingRecordId'
    order by record.created_at desc, record.id desc
    limit 1;
    if v_pending is null
      or v_pending ->> 'assessmentId' is distinct from p_payload ->> 'assessmentId'
      or p_payload ->> 'pagesUrl' not like 'https://liucaidong.github.io/knowverse/%'
      or coalesce(p_payload ->> 'deploymentSha', '') = ''
    then
      raise exception 'verified_pages_publication_required' using errcode = '42501';
    end if;
  end if;

  if p_record_type = 'state' and p_next_status is not null then
    v_record_payload := p_payload || jsonb_build_object(
      'from', v_status,
      'to', p_next_status,
      'revision', v_state_revision + 1
    );
  else
    v_record_payload := p_payload;
  end if;

  insert into public.practice_candidate_quality_records(
    user_id, candidate_id, record_type, record_id, candidate_hash, payload, created_at
  ) values (
    p_user_id, p_candidate_id, p_record_type, p_record_id, p_candidate_hash, v_record_payload, v_now
  );

  if p_next_status is not null and p_record_type <> 'state' then
    v_state_id := 'state:' || p_record_id;
    if length(v_state_id) > 240 then
      raise exception 'practice_candidate_state_record_id_too_long' using errcode = '22023';
    end if;
    insert into public.practice_candidate_quality_records(
      user_id, candidate_id, record_type, record_id, candidate_hash, payload, created_at
    ) values (
      p_user_id, p_candidate_id, 'state', v_state_id, p_candidate_hash,
      jsonb_build_object(
        'from', v_status,
        'to', p_next_status,
        'revision', v_state_revision + 1,
        'causedBy', p_record_id,
        'at', v_now
      ),
      v_now
    );
  end if;

  return jsonb_build_object(
    'recordId', p_record_id,
    'previousStatus', v_status,
    'status', coalesce(p_next_status, v_status),
    'stateRevision', case when p_next_status is not null then v_state_revision + 1 else v_state_revision end,
    'createdAt', v_now
  );
end;
$$;

revoke all on function public.append_practice_candidate_quality_record(
  uuid, text, text, text, text, jsonb, text, text
) from public, anon, authenticated;
grant execute on function public.append_practice_candidate_quality_record(
  uuid, text, text, text, text, jsonb, text, text
) to service_role;
