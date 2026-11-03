-- Phase M defense in depth: approval, rejection, PR and registration facts
-- must form one immutable and state-checked provenance chain.
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
  v_validation jsonb;
  v_pending jsonb;
  v_publication_pr jsonb;
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

  if p_record_type in ('approval', 'rejection') then
    if not private.is_practice_content_reviewer(p_user_id) then
      raise exception 'practice_content_reviewer_required' using errcode = '42501';
    end if;
  end if;

  if p_record_type = 'approval' then
    if p_expected_status is distinct from 'machine_reviewed'
      or p_next_status is distinct from 'approved'
      or p_payload ->> 'explicitConfirmation' is distinct from 'true'
      or p_payload ->> 'candidateHash' is distinct from p_candidate_hash
    then
      raise exception 'explicit_human_approval_required' using errcode = '42501';
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

    select record.payload into v_validation
    from public.practice_candidate_quality_records record
    where record.user_id = p_user_id
      and record.candidate_id = p_candidate_id
      and record.record_type = 'validation'
      and record.record_id = v_latest_review ->> 'validationRecordId'
      and record.candidate_hash = p_candidate_hash
    order by record.created_at desc, record.id desc
    limit 1;

    if v_validation is null
      or v_validation ->> 'validationStatus' <> 'passed'
      or v_validation ->> 'sourceSnapshotHash' is distinct from v_latest_review ->> 'sourceSnapshotHash'
    then
      raise exception 'matching_deterministic_validation_required' using errcode = '42501';
    end if;
  end if;

  if p_record_type = 'rejection' then
    if p_expected_status is null
      or p_next_status is distinct from 'rejected'
      or length(trim(coalesce(p_payload ->> 'reason', ''))) < 8
    then
      raise exception 'reviewer_rejection_reason_required' using errcode = '42501';
    end if;
  end if;

  if p_record_type = 'registration_pending' then
    if v_status <> 'approved'
      or p_expected_status is distinct from 'approved'
      or p_next_status is distinct from 'registration_pending'
      or p_payload ->> 'candidateId' is distinct from p_candidate_id
      or p_payload ->> 'candidateHash' is distinct from p_candidate_hash
    then
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
        and approval.payload ->> 'explicitConfirmation' = 'true'
    ) then
      raise exception 'matching_human_approval_required' using errcode = '42501';
    end if;
  end if;

  if p_record_type = 'publication_pr' then
    if v_status <> 'registration_pending'
      or p_expected_status is distinct from 'registration_pending'
      or p_next_status is not null
    then
      raise exception 'publication_requires_registration_pending' using errcode = '42501';
    end if;

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
      or v_pending ->> 'approvalRecordId' is distinct from p_payload ->> 'approvalRecordId'
      or v_pending ->> 'reviewId' is distinct from p_payload ->> 'reviewId'
      or coalesce(p_payload ->> 'prUrl', '') !~ '^https://github[.]com/liucaidong/knowverse/pull/[0-9]+$'
      or coalesce(p_payload ->> 'prNumber', '') !~ '^[1-9][0-9]*$'
      or p_payload ->> 'branch' is distinct from 'practice-candidate/' || p_candidate_id
    then
      raise exception 'matching_publication_pr_proof_required' using errcode = '42501';
    end if;
  end if;

  if p_record_type = 'registered' then
    if v_status <> 'registration_pending'
      or p_expected_status is distinct from 'registration_pending'
      or p_next_status is distinct from 'registered'
    then
      raise exception 'registration_pending_state_required' using errcode = '42501';
    end if;

    select record.payload into v_pending
    from public.practice_candidate_quality_records record
    where record.user_id = p_user_id
      and record.candidate_id = p_candidate_id
      and record.record_type = 'registration_pending'
      and record.candidate_hash = p_candidate_hash
      and record.record_id = p_payload ->> 'registrationPendingRecordId'
    order by record.created_at desc, record.id desc
    limit 1;

    select record.payload into v_publication_pr
    from public.practice_candidate_quality_records record
    where record.user_id = p_user_id
      and record.candidate_id = p_candidate_id
      and record.record_type = 'publication_pr'
      and record.candidate_hash = p_candidate_hash
      and record.payload ->> 'registrationPendingRecordId' = p_payload ->> 'registrationPendingRecordId'
      and record.payload ->> 'assessmentId' = p_payload ->> 'assessmentId'
    order by record.created_at desc, record.id desc
    limit 1;

    if v_pending is null
      or v_pending ->> 'assessmentId' is distinct from p_payload ->> 'assessmentId'
      or v_publication_pr is null
      or v_publication_pr ->> 'prUrl' is distinct from p_payload ->> 'prUrl'
      or p_payload ->> 'pagesUrl' is distinct from 'https://liucaidong.github.io/knowverse/content/review-assessments.json'
      or coalesce(p_payload ->> 'deploymentSha', '') !~ '^[a-f0-9]{40}$'
      or coalesce(p_payload ->> 'pagesWorkflowRunId', '') !~ '^[0-9]+$'
      or coalesce(p_payload ->> 'prUrl', '') !~ '^https://github[.]com/liucaidong/knowverse/pull/[0-9]+$'
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

create or replace function public.finalize_practice_candidate_registration(
  p_user_id uuid,
  p_candidate_id text,
  p_record_id text,
  p_candidate_hash text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.practice_candidate_quality_records%rowtype;
  v_registered public.practice_candidate_quality_records%rowtype;
  v_result jsonb;
begin
  if p_user_id is null or p_candidate_id is null
    or p_candidate_id !~ '^[A-Za-z0-9_-]{8,120}$'
    or p_record_id is null or length(p_record_id) not between 8 and 240
    or p_candidate_hash is null or p_candidate_hash !~ '^[a-f0-9]{64}$'
    or p_payload is null or jsonb_typeof(p_payload) <> 'object'
    or p_payload ->> 'assessmentId' is null
    or p_payload ->> 'registrationPendingRecordId' is null
    or coalesce(p_payload ->> 'deploymentSha', '') !~ '^[a-f0-9]{40}$'
    or p_payload ->> 'pagesUrl' is distinct from 'https://liucaidong.github.io/knowverse/content/review-assessments.json'
    or coalesce(p_payload ->> 'pagesWorkflowRunId', '') !~ '^[0-9]+$'
    or coalesce(p_payload ->> 'prUrl', '') !~ '^https://github[.]com/liucaidong/knowverse/pull/[0-9]+$'
  then
    raise exception 'invalid_practice_publication_proof' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text || ':' || p_candidate_id, 0));

  select * into v_existing
  from public.practice_candidate_quality_records
  where user_id = p_user_id
    and candidate_id = p_candidate_id
    and record_id = p_record_id
  limit 1;

  if found then
    if v_existing.record_type <> 'registered'
      or v_existing.candidate_hash <> p_candidate_hash
      or v_existing.payload ->> 'assessmentId' is distinct from p_payload ->> 'assessmentId'
      or v_existing.payload ->> 'registrationPendingRecordId' is distinct from p_payload ->> 'registrationPendingRecordId'
      or v_existing.payload ->> 'pagesUrl' is distinct from p_payload ->> 'pagesUrl'
      or v_existing.payload ->> 'prUrl' is distinct from p_payload ->> 'prUrl'
      or coalesce(v_existing.payload ->> 'deploymentSha', '') !~ '^[a-f0-9]{40}$'
    then
      raise exception 'practice_registration_record_id_conflict' using errcode = '23505';
    end if;
    return jsonb_build_object(
      'ok', true, 'idempotent', true,
      'recordId', v_existing.record_id,
      'assessmentId', v_existing.payload ->> 'assessmentId',
      'status', 'registered', 'registeredAt', v_existing.created_at
    );
  end if;

  select * into v_registered
  from public.practice_candidate_quality_records
  where user_id = p_user_id
    and candidate_id = p_candidate_id
    and record_type = 'registered'
  order by created_at desc, id desc
  limit 1;

  if found then
    if v_registered.candidate_hash <> p_candidate_hash
      or v_registered.payload ->> 'assessmentId' is distinct from p_payload ->> 'assessmentId'
      or v_registered.payload ->> 'registrationPendingRecordId' is distinct from p_payload ->> 'registrationPendingRecordId'
      or v_registered.payload ->> 'pagesUrl' is distinct from p_payload ->> 'pagesUrl'
      or v_registered.payload ->> 'prUrl' is distinct from p_payload ->> 'prUrl'
      or coalesce(v_registered.payload ->> 'deploymentSha', '') !~ '^[a-f0-9]{40}$'
    then
      raise exception 'practice_candidate_already_registered_differently' using errcode = '23505';
    end if;
    return jsonb_build_object(
      'ok', true, 'idempotent', true,
      'recordId', v_registered.record_id,
      'assessmentId', v_registered.payload ->> 'assessmentId',
      'status', 'registered', 'registeredAt', v_registered.created_at
    );
  end if;

  v_result := public.append_practice_candidate_quality_record(
    p_user_id,
    p_candidate_id,
    'registered',
    p_record_id,
    p_candidate_hash,
    p_payload,
    'registration_pending',
    'registered'
  );
  return v_result || jsonb_build_object('ok', true, 'idempotent', false);
end;
$$;

revoke all on function public.finalize_practice_candidate_registration(
  uuid, text, text, text, jsonb
) from public, anon, authenticated;
grant execute on function public.finalize_practice_candidate_registration(
  uuid, text, text, text, jsonb
) to service_role;

revoke insert on table public.practice_candidate_quality_records from service_role;
