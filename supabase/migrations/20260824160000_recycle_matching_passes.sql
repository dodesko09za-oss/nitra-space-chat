create or replace function private.matching_recycle_passes()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_deleted integer := 0;
begin
  if v_me is null then
    raise exception 'Authentication required';
  end if;

  delete from public.matching_passes
  where user_id = v_me;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

create or replace function public.matching_recycle_passes()
returns integer
language sql
volatile
security invoker
set search_path = ''
as $$ select private.matching_recycle_passes(); $$;

revoke all on function private.matching_recycle_passes() from public, anon;
revoke all on function public.matching_recycle_passes() from public, anon;
grant execute on function private.matching_recycle_passes() to authenticated;
grant execute on function public.matching_recycle_passes() to authenticated;
