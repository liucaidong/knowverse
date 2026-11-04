-- Phase M: explicitly provision the owner-designated initial content reviewer.
-- The target Auth UUID was supplied by the project owner and verified against auth.users.
-- The reviewer row's created_at and note preserve the authorization provenance.

-- Auth identities are environment-specific data and may not exist during a clean
-- schema replay. Provision the designated reviewer only when that Auth identity exists.
-- Never overwrite an existing reviewer row during a migration replay.
insert into private.practice_content_reviewers (
  user_id,
  role,
  enabled,
  note
)
select
  auth_user.id,
  'content_admin',
  true,
  'Initial content_admin explicitly designated by the project owner on 2026-11-04; Auth UUID verified against auth.users.'
from auth.users as auth_user
where auth_user.id = '79256d8a-d64d-4af6-ae0b-87f764037956'::uuid
on conflict (user_id) do nothing;

do $$
begin
  if not exists (
    select 1
    from private.practice_content_reviewers
    where user_id = '79256d8a-d64d-4af6-ae0b-87f764037956'::uuid
      and role = 'content_admin'
      and enabled = true
  ) then
    raise notice 'Initial content_admin was not provisioned: create/verify the Auth identity and run the documented operator provisioning step.';
  end if;
end;
$$;
