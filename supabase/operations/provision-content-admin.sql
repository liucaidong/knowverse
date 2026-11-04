-- KNOWVERSE: one-time operator action to provision a human content reviewer.
-- Run ONLY from the trusted Supabase SQL Editor / privileged operator connection.
-- Never call this from a browser, Edge Function, CI workflow, or ordinary user session.
--
-- Before execution:
--   1. Replace the all-zero UUID with the intended, verified auth.users.id.
--   2. Replace the operator attribution with the authorized human operator / ticket.
--   3. Confirm the approval was explicitly recorded outside this database.
--
-- This operation is intentionally non-destructive:
--   - It fails if the Auth identity does not exist.
--   - It inserts an enabled content_admin only when no row exists.
--   - It never updates, re-enables, or overwrites an existing reviewer row.
--   - Any existing disabled / conflicting row requires a separate, explicit
--     privileged decision and must not be silently changed by this script.

begin;

do $$
declare
  v_user_id uuid := '00000000-0000-0000-0000-000000000000'::uuid;
  v_operator text := 'REPLACE_WITH_APPROVED_OPERATOR_AND_TICKET';
  v_note text;
begin
  if v_user_id = '00000000-0000-0000-0000-000000000000'::uuid then
    raise exception 'replace the placeholder Auth UUID before provisioning';
  end if;

  if length(btrim(v_operator)) < 8
     or v_operator like 'REPLACE_WITH_%' then
    raise exception 'operator attribution / approval ticket must be supplied';
  end if;

  if not exists (select 1 from auth.users where id = v_user_id) then
    raise exception 'target Auth identity does not exist; create/verify the account first';
  end if;

  v_note := format(
    'Explicitly provisioned by %s at %s',
    btrim(v_operator),
    clock_timestamp()
  );

  insert into private.practice_content_reviewers (
    user_id, role, enabled, note
  )
  values (
    v_user_id, 'content_admin', true, v_note
  )
  on conflict (user_id) do nothing;

  if not exists (
    select 1
    from private.practice_content_reviewers
    where user_id = v_user_id
      and role = 'content_admin'
      and enabled = true
  ) then
    raise exception
      'a reviewer row already exists but is not an enabled content_admin; stop and obtain a separate explicit authorization decision';
  end if;
end;
$$;

commit;

-- Verify separately after execution:
-- select user_id, role, enabled, created_at, note
-- from private.practice_content_reviewers
-- where user_id = '<the approved Auth UUID>'::uuid;
