-- Phase M: private, immutable practice-candidate quality audit and reviewer authorization.
-- Learning Events V3 remains the sole source of formal mastery evidence.

create table private.practice_content_reviewers (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role = 'content_admin'),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  note text
);
alter table private.practice_content_reviewers enable row level security;
revoke all on private.practice_content_reviewers from public, anon, authenticated, service_role;

create table public.practice_candidate_quality_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  candidate_id text not null check (candidate_id ~ '^[A-Za-z0-9_-]{8,120}$'),
  record_type text not null check (record_type in (
    'state', 'validation', 'review', 'review_error', 'approval',
    'rejection', 'registration_pending', 'publication_pr', 'registered'
  )),
  record_id text not null check (length(record_id) between 8 and 240),
  candidate_hash text not null check (candidate_hash ~ '^[a-f0-9]{64}$'),
  payload jsonb not null check (
    jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 65536
  ),
  created_at timestamptz not null default now(),
  unique (user_id, candidate_id, record_id)
);
create index practice_candidate_quality_owner_idx
  on public.practice_candidate_quality_records(user_id, candidate_id, created_at, id);
create index practice_candidate_quality_type_idx
  on public.practice_candidate_quality_records(user_id, candidate_id, record_type, created_at);

alter table public.practice_candidate_quality_records enable row level security;
create policy "read own authorized practice quality history"
  on public.practice_candidate_quality_records
  for select to authenticated
  using (
    user_id = (select auth.uid())
    and private.is_authorized_user((select auth.uid()))
  );
revoke all on public.practice_candidate_quality_records from public, anon;
revoke insert, update, delete, truncate, references, trigger
  on public.practice_candidate_quality_records from authenticated;
grant select on public.practice_candidate_quality_records to authenticated;
revoke update, delete, truncate, references, trigger
  on public.practice_candidate_quality_records from service_role;
grant select, insert on public.practice_candidate_quality_records to service_role;

create or replace function private.is_practice_content_reviewer(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from private.practice_content_reviewers reviewer
    where reviewer.user_id = p_user_id
      and reviewer.role = 'content_admin'
      and reviewer.enabled = true
  );
$$;
revoke all on function private.is_practice_content_reviewer(uuid) from public, anon, authenticated;
grant usage on schema private to service_role;
grant execute on function private.is_practice_content_reviewer(uuid) to service_role;

create or replace function private.reject_practice_quality_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'practice_candidate_quality_records_are_append_only'
    using errcode = '55000';
end;
$$;
revoke all on function private.reject_practice_quality_mutation() from public, anon, authenticated, service_role;

create trigger practice_candidate_quality_records_immutable
  before update or delete on public.practice_candidate_quality_records
  for each row execute function private.reject_practice_quality_mutation();

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
  v_allowed boolean := false;
  v_latest_review jsonb;
  v_pending jsonb;
  v_state_id text;
  v_now timestamptz := now();
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

  select coalesce(
    (
      select record.payload ->> 'to'
      from public.practice_candidate_quality_records record
      where record.user_id = p_user_id
        and record.candidate_id = p_candidate_id
        and record.record_type = 'state'
      order by record.created_at desc, record.id desc
      limit 1
    ),
    'draft'
  ) into v_status;

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

  insert into public.practice_candidate_quality_records(
    user_id, candidate_id, record_type, record_id, candidate_hash, payload, created_at
  ) values (
    p_user_id, p_candidate_id, p_record_type, p_record_id, p_candidate_hash, p_payload, v_now
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

comment on table public.practice_candidate_quality_records is
  'Append-only per-user quality validation, independent AI reviews, human approvals and verified publication audit. It never writes Learning Events or mastery.';
comment on table private.practice_content_reviewers is
  'Privileged human content reviewers. Roles are provisioned out-of-band by a trusted database administrator; never via browser self-identification.';
