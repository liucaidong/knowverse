-- Finalize official registration atomically and idempotently after the Pages artifact is verified.
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
  if p_user_id is null or p_candidate_id is null or p_record_id is null
    or p_candidate_hash is null or p_payload is null
    or p_payload ->> 'assessmentId' is null
    or p_payload ->> 'registrationPendingRecordId' is null
    or p_payload ->> 'deploymentSha' is null
    or p_payload ->> 'pagesUrl' is null
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
  order by created_at desc
  limit 1;

  if found then
    if v_registered.candidate_hash <> p_candidate_hash
      or v_registered.payload ->> 'assessmentId' is distinct from p_payload ->> 'assessmentId'
      or v_registered.payload ->> 'registrationPendingRecordId' is distinct from p_payload ->> 'registrationPendingRecordId'
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
