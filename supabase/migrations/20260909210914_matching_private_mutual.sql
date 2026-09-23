-- Keep old notifications for audit, but no longer expose one-sided likes.
create or replace function private.social_notifications(p_limit integer default 50) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('unread',(select count(*) from public.notifications n join public.profiles p on p.id=n.actor_id where n.user_id=auth.uid() and n.type<>'matching_like' and n.read_at is null and p.deactivated_at is null and not private.users_are_blocked(auth.uid(),p.id)),
 'items',coalesce((select jsonb_agg(jsonb_build_object('id',n.id,'type',n.type,'entity_id',n.entity_id,'read_at',n.read_at,'created_at',n.created_at,'actor_id',p.id,'actor_username',p.username,'actor_name',p.display_name,'actor_avatar',p.avatar_path,'actionable',
 case when n.type='follow_request' then exists(select 1 from public.follow_requests r where r.requester_id=n.actor_id and r.target_id=auth.uid() and r.expires_at>now())
 when n.type='connection_request' then exists(select 1 from public.connection_requests r where r.requester_id=n.actor_id and r.target_id=auth.uid() and r.expires_at>now()) else false end) order by n.created_at desc)
 from (select * from public.notifications where user_id=auth.uid() and type<>'matching_like' order by created_at desc limit least(greatest(p_limit,1),100)) n
 join public.profiles p on p.id=n.actor_id where p.deactivated_at is null and not private.users_are_blocked(auth.uid(),p.id)),'[]'::jsonb));
$$;
create policy matching_likes_private on public.notifications as restrictive for select to authenticated using(type<>'matching_like');
create or replace function private.handle_mutual_like() returns trigger language plpgsql security definer set search_path='' as $$
declare match_id uuid;
begin
 if private.users_are_blocked(new.from_user_id,new.to_user_id) then raise exception 'This action is not allowed'; end if;
 if exists(select 1 from public.profile_likes where from_user_id=new.to_user_id and to_user_id=new.from_user_id) then
  insert into public.matches(user1_id,user2_id) values(least(new.from_user_id,new.to_user_id),greatest(new.from_user_id,new.to_user_id)) on conflict do nothing returning id into match_id;
  if match_id is not null then
   insert into public.notifications(user_id,actor_id,type,entity_id) values(new.from_user_id,new.to_user_id,'match',match_id),(new.to_user_id,new.from_user_id,'match',match_id);
  end if;
 end if;
 return new;
end $$;
revoke all on function private.handle_mutual_like() from public,anon,authenticated;
-- Serialize opposite swipes so simultaneous likes cannot miss each other.
create or replace function private.matching_decide(p_target uuid,p_like boolean) returns text language plpgsql security definer set search_path='' as $$
declare me uuid:=auth.uid();
begin
 if me is null or p_target is null or me=p_target or p_like is null then raise exception 'Invalid matching decision'; end if;
 perform pg_advisory_xact_lock(hashtextextended(least(me,p_target)::text||greatest(me,p_target)::text,0));
 if private.users_are_blocked(me,p_target) or private.account_is_banned(me) or private.account_is_banned(p_target)
  or not exists(select 1 from public.profiles p join public.matching_profiles mp on mp.user_id=p.id where p.id=p_target and p.deactivated_at is null and p.discoverable and mp.matching_enabled)
  or not exists(select 1 from public.profiles p join public.matching_profiles mp on mp.user_id=p.id where p.id=me and p.deactivated_at is null and mp.matching_enabled) then
  raise exception 'Matching is not available';
 end if;
 if p_like then
  delete from public.matching_passes where user_id=me and target_user_id=p_target;
  insert into public.profile_likes(from_user_id,to_user_id) values(me,p_target) on conflict do nothing;
  if exists(select 1 from public.matches where user1_id=least(me,p_target) and user2_id=greatest(me,p_target)) then return 'match'; end if;
  return 'liked';
 end if;
 insert into public.matching_passes(user_id,target_user_id) values(me,p_target) on conflict do nothing;
 return 'passed';
end $$;
revoke insert on public.profile_likes from authenticated;
-- Legacy clients can still like a profile, without probing for inbound likes.
create or replace function private.respond_matching_like(p_actor uuid,p_accept boolean) returns void language plpgsql security definer set search_path='' as $$
begin perform private.matching_decide(p_actor,p_accept); end $$;
create or replace function private.matching_updates(p_limit integer default 30) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('unread',(select count(*) from public.notifications where user_id=auth.uid() and type='match' and read_at is null),
 'items',coalesce((select jsonb_agg(jsonb_build_object('id',n.id,'actor_id',p.id,'type','match','entity_id',n.entity_id,'created_at',n.created_at,'read_at',n.read_at,'actor_username',p.username,'actor_name',p.display_name,'actor_avatar',p.avatar_path) order by n.created_at desc)
 from (select * from public.notifications where user_id=auth.uid() and type='match' order by created_at desc limit least(greatest(p_limit,1),50)) n join public.profiles p on p.id=n.actor_id
 where p.deactivated_at is null and not private.users_are_blocked(auth.uid(),p.id)),'[]'::jsonb));
$$;
create or replace function private.matching_feed(p_limit integer default 12) returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'username',p.username,'display_name',p.display_name,
 'age',extract(year from age(current_date,p.birth_date))::integer,'intro',mp.intro,'is_verified',p.is_verified,
 'online',p.show_online and p.last_active_at>now()-interval '3 minutes',
 'photos',coalesce((select jsonb_agg(storage_path order by position) from public.matching_photos where user_id=p.id),'[]'::jsonb),
 'interests',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'name',i.display_name)) from public.matching_profile_interests mpi join public.interests i on i.id=mpi.interest_id where mpi.user_id=p.id),'[]'::jsonb))),'[]'::jsonb)
 from (select p.* from public.profiles p join public.matching_profiles mp on mp.user_id=p.id
 where auth.uid() is not null and p.id<>auth.uid() and p.deactivated_at is null and p.discoverable and mp.matching_enabled
 and not private.account_is_banned(p.id) and not private.account_is_banned(auth.uid())
 and exists(select 1 from public.matching_profiles where user_id=auth.uid() and matching_enabled)
 and not private.users_are_blocked(auth.uid(),p.id)
 and not exists(select 1 from public.profile_likes where from_user_id=auth.uid() and to_user_id=p.id)
 and not exists(select 1 from public.matching_passes where user_id=auth.uid() and target_user_id=p.id)
 order by p.last_active_at desc nulls last,p.id limit least(greatest(p_limit,1),20)) p join public.matching_profiles mp on mp.user_id=p.id;
$$;
