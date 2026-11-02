-- Phase D: one server transaction for events + resumable documents.
-- Existing rows, profiles, devices and RLS policies are deliberately preserved.

create function public.sync_commit_learning_batch(
  p_device_id uuid,
  p_expected_user_id uuid,
  p_events jsonb,
  p_documents jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_document_result jsonb := jsonb_build_object('confirmed', '[]'::jsonb, 'conflicts', '[]'::jsonb);
  v_event_result jsonb := jsonb_build_object('confirmed', '[]'::jsonb, 'inserted', 0);
begin
  if v_user_id is null then
    raise exception 'authentication_required' using errcode = '28000';
  end if;
  if p_expected_user_id is null or p_expected_user_id is distinct from v_user_id then
    raise exception 'account_changed_during_sync' using errcode = '42501';
  end if;
  if not private.is_authorized_user(v_user_id) then
    raise exception 'account_not_allowlisted' using errcode = '42501';
  end if;
  if p_device_id is null or p_events is null or jsonb_typeof(p_events) <> 'array'
      or p_documents is null or jsonb_typeof(p_documents) <> 'array' then
    raise exception 'invalid_sync_batch' using errcode = '22023';
  end if;
  if jsonb_array_length(p_events) > 100 or jsonb_array_length(p_documents) > 50 then
    raise exception 'sync_batch_limit_exceeded' using errcode = '22023';
  end if;

  -- Both existing RPCs validate the current JWT, allowlist and registered device.
  -- The nested block is a PostgreSQL subtransaction: a CAS conflict rolls back
  -- every document change in this batch before the client receives the conflict.
  begin
    v_document_result := public.sync_push_learning_documents(p_device_id, p_documents);

    if jsonb_array_length(coalesce(v_document_result -> 'conflicts', '[]'::jsonb)) > 0 then
      raise exception 'phase_d_document_cas_conflict' using errcode = 'P0001';
    end if;

    v_event_result := public.sync_push_learning_events(p_device_id, p_events);
  exception
    when raise_exception then
      if sqlerrm = 'phase_d_document_cas_conflict' then
        return jsonb_build_object(
          'status', 'conflict',
          'events', jsonb_build_object('confirmed', '[]'::jsonb, 'inserted', 0),
          'documents', jsonb_build_object(
            'confirmed', '[]'::jsonb,
            'conflicts', coalesce(v_document_result -> 'conflicts', '[]'::jsonb)
          ),
          'committed_at', clock_timestamp()
        );
      end if;
      raise;
  end;

  return jsonb_build_object(
    'status', 'committed',
    'events', v_event_result,
    'documents', v_document_result,
    'committed_at', clock_timestamp()
  );
end;
$$;

-- The current JWT must still belong to the account whose cursor the client
-- will advance. This closes an account-switch race between auth.getSession()
-- and the server-side pull request.
create function public.sync_pull_learning_events_for_account(
  p_expected_user_id uuid,
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
begin
  if v_user_id is null then
    raise exception 'authentication_required' using errcode = '28000';
  end if;
  if p_expected_user_id is null or p_expected_user_id is distinct from v_user_id then
    raise exception 'account_changed_during_sync' using errcode = '42501';
  end if;
  if not private.is_authorized_user(v_user_id) then
    raise exception 'account_not_allowlisted' using errcode = '42501';
  end if;
  return public.sync_pull_learning_events(
    greatest(0, coalesce(p_after_user_seq, 0)),
    greatest(1, least(coalesce(p_page_size, 100), 100))
  );
end;
$$;

create function public.sync_pull_learning_documents_for_account(
  p_expected_user_id uuid,
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
begin
  if v_user_id is null then
    raise exception 'authentication_required' using errcode = '28000';
  end if;
  if p_expected_user_id is null or p_expected_user_id is distinct from v_user_id then
    raise exception 'account_changed_during_sync' using errcode = '42501';
  end if;
  if not private.is_authorized_user(v_user_id) then
    raise exception 'account_not_allowlisted' using errcode = '42501';
  end if;
  return public.sync_pull_learning_documents(
    greatest(0, coalesce(p_after_document_seq, 0)),
    greatest(1, least(coalesce(p_page_size, 100), 100))
  );
end;
$$;

revoke all on function public.sync_commit_learning_batch(uuid, uuid, jsonb, jsonb) from public, anon;
revoke all on function public.sync_pull_learning_events_for_account(uuid, bigint, integer) from public, anon;
revoke all on function public.sync_pull_learning_documents_for_account(uuid, bigint, integer) from public, anon;

grant execute on function public.sync_commit_learning_batch(uuid, uuid, jsonb, jsonb) to authenticated;
grant execute on function public.sync_pull_learning_events_for_account(uuid, bigint, integer) to authenticated;
grant execute on function public.sync_pull_learning_documents_for_account(uuid, bigint, integer) to authenticated;

comment on function public.sync_commit_learning_batch(uuid, uuid, jsonb, jsonb) is
  'Atomically pushes append-only learning events and versioned learning documents; document CAS conflicts roll back the complete batch.';
comment on function public.sync_pull_learning_events_for_account(uuid, bigint, integer) is
  'Pulls event history only when the active JWT still matches the client expected account.';
comment on function public.sync_pull_learning_documents_for_account(uuid, bigint, integer) is
  'Pulls resumable learning documents only when the active JWT still matches the client expected account.';
