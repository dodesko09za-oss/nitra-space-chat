-- Keep privileged social implementations out of the exposed public schema.

create or replace function private.discover_profiles(p_limit integer default 20)
returns table (
  id uuid, username text, display_name text, bio text, age integer,
  city text, avatar_path text, dating_enabled boolean, is_private boolean,
  is_following boolean, is_liked boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.username, p.display_name, p.bio,
    extract(year from age(current_date, p.birth_date))::integer,
    p.city, p.avatar_path, p.dating_enabled, p.is_private,
    exists(select 1 from public.follows f where f.follower_id = auth.uid() and f.following_id = p.id),
    exists(select 1 from public.profile_likes l where l.from_user_id = auth.uid() and l.to_user_id = p.id)
  from public.profiles p
  where auth.uid() is not null
    and p.id <> auth.uid()
    and not private.users_are_blocked(auth.uid(), p.id)
  order by p.last_active_at desc nulls last, p.created_at desc
  limit least(greatest(coalesce(p_limit, 20), 1), 50);
$$;

create or replace function private.get_public_profile(p_profile_id uuid)
returns table (
  id uuid, username text, display_name text, bio text, age integer,
  city text, avatar_path text, dating_enabled boolean, is_private boolean,
  followers_count bigint, following_count bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.username, p.display_name, p.bio,
    extract(year from age(current_date, p.birth_date))::integer,
    p.city, p.avatar_path, p.dating_enabled, p.is_private,
    (select count(*) from public.follows f where f.following_id = p.id),
    (select count(*) from public.follows f where f.follower_id = p.id)
  from public.profiles p
  where p.id = p_profile_id
    and auth.uid() is not null
    and not private.users_are_blocked(auth.uid(), p.id);
$$;

create or replace function private.get_or_create_dm(p_other_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_user1 uuid;
  v_user2 uuid;
  v_conversation_id uuid;
begin
  if v_me is null or p_other_user_id is null or v_me = p_other_user_id then
    raise exception 'Invalid conversation participant';
  end if;
  if private.users_are_blocked(v_me, p_other_user_id) then
    raise exception 'This conversation is blocked';
  end if;
  v_user1 := least(v_me, p_other_user_id);
  v_user2 := greatest(v_me, p_other_user_id);
  if not exists (
    select 1 from public.matches m where m.user1_id = v_user1 and m.user2_id = v_user2
  ) then
    raise exception 'A mutual match is required before messaging';
  end if;

  insert into public.conversations(user1_id, user2_id)
  values (v_user1, v_user2)
  on conflict (user1_id, user2_id) do update set user1_id = excluded.user1_id
  returning id into v_conversation_id;
  insert into public.conversation_members(conversation_id, user_id)
  values (v_conversation_id, v_user1), (v_conversation_id, v_user2)
  on conflict do nothing;
  return v_conversation_id;
end;
$$;

revoke all on function private.discover_profiles(integer) from public, anon;
revoke all on function private.get_public_profile(uuid) from public, anon;
revoke all on function private.get_or_create_dm(uuid) from public, anon;
grant execute on function private.discover_profiles(integer) to authenticated;
grant execute on function private.get_public_profile(uuid) to authenticated;
grant execute on function private.get_or_create_dm(uuid) to authenticated;

create or replace function public.discover_profiles(p_limit integer default 20)
returns table (
  id uuid, username text, display_name text, bio text, age integer,
  city text, avatar_path text, dating_enabled boolean, is_private boolean,
  is_following boolean, is_liked boolean
)
language sql stable security invoker set search_path = ''
as $$ select * from private.discover_profiles(p_limit); $$;

create or replace function public.get_public_profile(p_profile_id uuid)
returns table (
  id uuid, username text, display_name text, bio text, age integer,
  city text, avatar_path text, dating_enabled boolean, is_private boolean,
  followers_count bigint, following_count bigint
)
language sql stable security invoker set search_path = ''
as $$ select * from private.get_public_profile(p_profile_id); $$;

create or replace function public.get_or_create_dm(p_other_user_id uuid)
returns uuid
language sql volatile security invoker set search_path = ''
as $$ select private.get_or_create_dm(p_other_user_id); $$;

create index conversation_members_user_idx on public.conversation_members(user_id);
create index conversations_user2_idx on public.conversations(user2_id);
create index direct_messages_sender_idx on public.direct_messages(sender_id);
create index notifications_actor_idx on public.notifications(actor_id);
create index reports_reported_user_idx on public.reports(reported_user_id);

