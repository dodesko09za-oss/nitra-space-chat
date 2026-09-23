create or replace function private.respond_matching_like(p_actor uuid, p_accept boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_me uuid := auth.uid();
begin
  if v_me is null or p_actor is null or p_actor=v_me
     or private.users_are_blocked(v_me,p_actor)
     or not exists(select 1 from public.profile_likes where from_user_id=p_actor and to_user_id=v_me) then
    raise exception 'Matching like is not available';
  end if;

  if p_accept then
    insert into public.profile_likes(from_user_id,to_user_id)
    values(v_me,p_actor) on conflict do nothing;
  end if;

  update public.notifications set read_at=coalesce(read_at,now())
  where user_id=v_me and actor_id=p_actor and type='matching_like';
end;
$$;

create or replace function private.social_notifications(p_limit integer default 50)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'unread', (select count(*) from public.notifications where user_id=auth.uid() and read_at is null),
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
        select * from public.notifications
        where user_id=auth.uid()
        order by created_at desc
        limit least(greatest(coalesce(p_limit,50),1),100)
      ) n
      left join public.profiles p on p.id=n.actor_id
    ), '[]'::jsonb)
  );
$$;

create or replace function public.respond_matching_like(p_actor uuid, p_accept boolean)
returns void language sql volatile security invoker set search_path=''
as $$ select private.respond_matching_like(p_actor,p_accept); $$;

revoke all on function private.respond_matching_like(uuid,boolean) from public,anon;
grant execute on function private.respond_matching_like(uuid,boolean) to authenticated;
revoke all on function public.respond_matching_like(uuid,boolean) from public,anon;
grant execute on function public.respond_matching_like(uuid,boolean) to authenticated;
