create table if not exists private.account_bans (
  user_id uuid primary key references auth.users(id) on delete cascade,
  banned_at timestamptz not null default now(),
  banned_by uuid references auth.users(id) on delete set null
);

revoke all on table private.account_bans from public, anon, authenticated;

insert into private.account_bans(user_id, banned_at)
select id, coalesce(updated_at, now())
from auth.users
where banned_until is not null and banned_until > now()
on conflict (user_id) do nothing;

create or replace function private.account_is_banned(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user is not null and exists (
    select 1 from private.account_bans b where b.user_id = p_user
  );
$$;

revoke all on function private.account_is_banned(uuid) from public, anon;
grant execute on function private.account_is_banned(uuid) to authenticated, service_role;

create or replace function public.account_is_banned()
returns boolean
language sql
stable
set search_path = ''
as $$
  select private.account_is_banned(auth.uid());
$$;

revoke all on function public.account_is_banned() from public, anon;
grant execute on function public.account_is_banned() to authenticated;

create or replace function private.admin_record_ban(p_admin uuid, p_target uuid, p_banned boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_admin(p_admin) then
    raise exception 'Admin access required' using errcode = '42501';
  end if;

  if p_banned then
    insert into private.account_bans(user_id, banned_at, banned_by)
    values (p_target, now(), p_admin)
    on conflict (user_id) do update
      set banned_at = excluded.banned_at,
          banned_by = excluded.banned_by;
  else
    delete from private.account_bans where user_id = p_target;
  end if;

  insert into private.admin_audit_log(admin_user_id, target_user_id, action)
  values (p_admin, p_target, case when p_banned then 'ban' else 'unban' end);
end;
$$;

create or replace function private.set_status(p_body text, p_visibility text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_user uuid := auth.uid();
  v_body text := btrim(coalesce(p_body, ''));
begin
  if v_user is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if private.account_is_banned(v_user) then
    raise exception 'Account is banned' using errcode = '42501';
  end if;
  if char_length(v_body) < 1 or char_length(v_body) > 100 then
    raise exception 'Status must contain 1 to 100 characters' using errcode = '22023';
  end if;
  if p_visibility not in ('public', 'followers') then
    raise exception 'Invalid status visibility' using errcode = '22023';
  end if;

  insert into public.statuses(user_id, body, visibility)
  values(v_user, v_body, p_visibility)
  on conflict(user_id) do update
    set body = excluded.body,
        visibility = excluded.visibility,
        created_at = now(),
        expires_at = now() + interval '24 hours'
  returning id into v_id;

  return v_id;
end;
$$;
