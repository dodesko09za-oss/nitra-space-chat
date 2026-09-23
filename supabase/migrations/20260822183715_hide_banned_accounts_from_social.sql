alter table private.account_bans
  add column if not exists previous_deactivated_at timestamptz;

create or replace function private.admin_record_ban(p_admin uuid, p_target uuid, p_banned boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_previous_deactivated_at timestamptz;
begin
  if not private.is_admin(p_admin) then
    raise exception 'Admin access required' using errcode = '42501';
  end if;

  if p_banned then
    select deactivated_at into v_previous_deactivated_at
    from public.profiles where id = p_target;

    insert into private.account_bans(user_id, banned_at, banned_by, previous_deactivated_at)
    values (p_target, now(), p_admin, v_previous_deactivated_at)
    on conflict (user_id) do update
      set banned_at = excluded.banned_at,
          banned_by = excluded.banned_by;

    update public.profiles
    set deactivated_at = coalesce(deactivated_at, now())
    where id = p_target;
  else
    select previous_deactivated_at into v_previous_deactivated_at
    from private.account_bans where user_id = p_target;

    update public.profiles
    set deactivated_at = v_previous_deactivated_at
    where id = p_target;

    delete from private.account_bans where user_id = p_target;
  end if;

  insert into private.admin_audit_log(admin_user_id, target_user_id, action)
  values (p_admin, p_target, case when p_banned then 'ban' else 'unban' end);
end;
$$;

update public.profiles p
set deactivated_at = coalesce(p.deactivated_at, b.banned_at)
from private.account_bans b
where b.user_id = p.id;

create or replace function private.get_public_profile(p_profile_id uuid)
returns table(id uuid, username text, display_name text, bio text, age integer, city text, avatar_path text, dating_enabled boolean, is_private boolean, followers_count bigint, following_count bigint)
language sql
stable security definer
set search_path = ''
as $$
  select p.id, p.username, p.display_name, p.bio,
    extract(year from age(current_date, p.birth_date))::integer,
    p.city, p.avatar_path, p.dating_enabled, p.is_private,
    (select count(*) from public.follows f where f.following_id = p.id),
    (select count(*) from public.follows f where f.follower_id = p.id)
  from public.profiles p
  where p.id = p_profile_id
    and p.deactivated_at is null
    and auth.uid() is not null
    and not private.users_are_blocked(auth.uid(), p.id);
$$;

create or replace function private.social_home(p_post_limit integer default 10, p_suggested_limit integer default 10)
returns jsonb
language sql
stable security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'statuses',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'body',s.body,'visibility',s.visibility,'created_at',s.created_at,'expires_at',s.expires_at,'user_id',p.id,'username',p.username,'display_name',p.display_name,'avatar_path',p.avatar_path) order by s.created_at desc)
      from public.statuses s join public.profiles p on p.id=s.user_id
      where s.expires_at>now() and p.deactivated_at is null
        and not private.users_are_blocked(auth.uid(),s.user_id)
        and (s.user_id=auth.uid() or (s.visibility='public' and not p.is_private) or exists(select 1 from public.follows f where f.follower_id=auth.uid() and f.following_id=s.user_id))),'[]'::jsonb),
    'suggested',private.discover_profiles_json('suggested',p_suggested_limit),
    'posts',coalesce((select jsonb_agg(jsonb_build_object('id',po.id,'image_path',po.image_path,'caption',po.caption,'created_at',po.created_at,'user_id',p.id,'username',p.username,'display_name',p.display_name,'avatar_path',p.avatar_path,'like_count',(select count(*) from public.post_likes pl where pl.post_id=po.id),'liked',exists(select 1 from public.post_likes pl where pl.post_id=po.id and pl.user_id=auth.uid())) order by po.created_at desc)
      from (select po.* from public.posts po join public.profiles pp on pp.id=po.user_id where not pp.is_private and pp.deactivated_at is null and not private.users_are_blocked(auth.uid(),po.user_id) order by po.created_at desc limit least(greatest(coalesce(p_post_limit,10),1),20)) po
      join public.profiles p on p.id=po.user_id),'[]'::jsonb)
  );
$$;
