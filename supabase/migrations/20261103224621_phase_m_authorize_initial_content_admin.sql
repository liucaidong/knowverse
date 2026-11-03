-- Phase M: explicitly provision the owner-designated initial content reviewer.
-- The target Auth UUID was supplied by the project owner and verified against auth.users.
-- The reviewer row's created_at and note preserve the authorization provenance.

insert into private.practice_content_reviewers (
  user_id,
  role,
  enabled,
  note
)
values (
  '79256d8a-d64d-4af6-ae0b-87f764037956'::uuid,
  'content_admin',
  true,
  'Initial content_admin explicitly designated by the project owner on 2026-11-04; Auth UUID verified against auth.users.'
)
on conflict (user_id) do update
set
  role = excluded.role,
  enabled = true,
  note = excluded.note;
