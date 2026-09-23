create or replace function private.list_blocked_accounts()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', p.id,
        'username', p.username,
        'display_name', p.display_name,
        'avatar_path', p.avatar_path,
        'blocked_at', b.created_at
      )
      order by b.created_at desc
    ),
    '[]'::jsonb
  )
  from public.blocks b
  join public.profiles p on p.id = b.blocked_id
  where (select auth.uid()) is not null
    and b.blocker_id = (select auth.uid());
$$;

create or replace function private.unblock_user(p_blocked uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_deleted integer;
begin
  if v_user is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if p_blocked is null then
    raise exception 'Blocked user is required' using errcode = '22004';
  end if;

  delete from public.blocks
  where blocker_id = v_user
    and blocked_id = p_blocked;

  get diagnostics v_deleted = row_count;
  return v_deleted > 0;
end;
$$;

create or replace function public.list_blocked_accounts()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$ select private.list_blocked_accounts(); $$;

create or replace function public.unblock_user(p_blocked uuid)
returns boolean
language sql
volatile
security invoker
set search_path = ''
as $$ select private.unblock_user(p_blocked); $$;

revoke all on function private.list_blocked_accounts(), private.unblock_user(uuid) from public, anon;
grant execute on function private.list_blocked_accounts(), private.unblock_user(uuid) to authenticated;
revoke all on function public.list_blocked_accounts(), public.unblock_user(uuid) from public, anon;
grant execute on function public.list_blocked_accounts(), public.unblock_user(uuid) to authenticated;
