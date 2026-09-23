create or replace function private.list_profile_relationships(p_profile_id uuid, p_kind text, p_query text default '', p_limit integer default 30)
returns table(id uuid,username text,display_name text,avatar_path text,follow_state text)
language sql stable security definer set search_path=''
as $$
  with ids as (
    select case when p_kind='followers' then f.follower_id else f.following_id end id
    from public.follows f
    where (p_kind='followers' and f.following_id=p_profile_id)
       or (p_kind='following' and f.follower_id=p_profile_id)
  )
  select p.id,p.username,p.display_name,p.avatar_path,
    case when exists(select 1 from public.follows f where f.follower_id=auth.uid() and f.following_id=p.id) then 'following'
      when exists(select 1 from public.follow_requests fr where fr.requester_id=auth.uid() and fr.target_id=p.id) then 'requested'
      else 'none' end
  from ids join public.profiles p using(id)
  where auth.uid() is not null and p.deactivated_at is null
    and not private.users_are_blocked(auth.uid(),p.id)
    and (btrim(coalesce(p_query,''))='' or p.username ilike '%'||trim(leading '@' from p_query)||'%' or p.display_name ilike '%'||p_query||'%')
  order by p.username limit least(greatest(coalesce(p_limit,30),1),50);
$$;

create or replace function private.request_inbox()
returns jsonb
language sql stable security definer set search_path=''
as $$
  select jsonb_build_object(
    'follow_requests',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'username',p.username,'display_name',p.display_name,'avatar_path',p.avatar_path,'created_at',fr.created_at) order by fr.created_at desc) from public.follow_requests fr join public.profiles p on p.id=fr.requester_id where fr.target_id=auth.uid() and fr.expires_at>now() and p.deactivated_at is null and not private.users_are_blocked(auth.uid(),fr.requester_id)),'[]'::jsonb),
    'connection_requests',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'username',p.username,'display_name',p.display_name,'avatar_path',p.avatar_path,'created_at',cr.created_at) order by cr.created_at desc) from public.connection_requests cr join public.profiles p on p.id=cr.requester_id where cr.target_id=auth.uid() and cr.expires_at>now() and p.deactivated_at is null and not private.users_are_blocked(auth.uid(),cr.requester_id)),'[]'::jsonb)
  );
$$;

create or replace function private.matching_updates(p_limit integer default 30)
returns jsonb
language sql stable security definer set search_path=''
as $$
  select jsonb_build_object(
    'unread',(select count(*) from public.notifications n join public.profiles p on p.id=n.actor_id where n.user_id=auth.uid() and n.type in ('matching_like','match') and n.read_at is null and p.deactivated_at is null),
    'items',coalesce((select jsonb_agg(jsonb_build_object('id',n.id,'actor_id',n.actor_id,'type',n.type,'entity_id',n.entity_id,'created_at',n.created_at,'read_at',n.read_at,'actor_username',p.username,'actor_name',p.display_name,'actor_avatar',p.avatar_path) order by n.created_at desc)
      from (select n.* from public.notifications n join public.profiles actor on actor.id=n.actor_id where n.user_id=auth.uid() and n.type in ('matching_like','match') and actor.deactivated_at is null order by n.created_at desc limit least(greatest(coalesce(p_limit,30),1),50)) n
      join public.profiles p on p.id=n.actor_id),'[]'::jsonb)
  );
$$;

create or replace function private.social_notifications(p_limit integer default 50)
returns jsonb
language sql stable security definer set search_path=''
as $$
  select jsonb_build_object(
    'unread', (select count(*) from public.notifications n join public.profiles p on p.id=n.actor_id where n.user_id=auth.uid() and n.read_at is null and p.deactivated_at is null),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',n.id,'type',n.type,'entity_id',n.entity_id,'read_at',n.read_at,'created_at',n.created_at,
        'actor_id',p.id,'actor_username',p.username,'actor_name',p.display_name,'actor_avatar',p.avatar_path,
        'actionable',case
          when n.type='follow_request' then exists(select 1 from public.follow_requests r where r.requester_id=n.actor_id and r.target_id=auth.uid() and r.expires_at>now())
          when n.type='connection_request' then exists(select 1 from public.connection_requests r where r.requester_id=n.actor_id and r.target_id=auth.uid() and r.expires_at>now())
          when n.type='matching_like' then n.read_at is null and exists(select 1 from public.profile_likes l where l.from_user_id=n.actor_id and l.to_user_id=auth.uid())
          else false end
      ) order by n.created_at desc)
      from (
        select n.* from public.notifications n
        join public.profiles actor on actor.id=n.actor_id
        where n.user_id=auth.uid() and actor.deactivated_at is null
        order by n.created_at desc
        limit least(greatest(coalesce(p_limit,50),1),100)
      ) n
      join public.profiles p on p.id=n.actor_id
    ), '[]'::jsonb)
  );
$$;
