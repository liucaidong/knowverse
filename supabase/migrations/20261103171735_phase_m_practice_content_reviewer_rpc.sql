-- Public PostgREST wrapper for the Edge Function's service-role authorization check.
-- No browser role can invoke this function or supply its own role.

create or replace function public.is_practice_content_reviewer(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_practice_content_reviewer(p_user_id);
$$;

revoke all on function public.is_practice_content_reviewer(uuid)
  from public, anon, authenticated;
grant execute on function public.is_practice_content_reviewer(uuid)
  to service_role;
