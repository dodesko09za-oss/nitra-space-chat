-- Expand Nitra Space social features without touching anonymous chat messages.
-- Random Chat continues to use only Realtime Broadcast for message payloads.

create extension if not exists pg_trgm with schema extensions;

-- Defense in depth for the non-exposed retention configuration.
alter table private.social_retention enable row level security;

-- A signed-in social session must still be able to enter the anonymous chat.
grant execute on function public.find_chat_partner(uuid) to anon, authenticated;
grant execute on function public.close_chat_room(uuid) to anon, authenticated;

-- Close stale rooms as well as deleting rooms already closed by the clients.
create or replace function public.cleanup_old_chat_rooms()
returns integer
language plpgsql
security definer
set search_path = 'pg_catalog', 'public'
as $$
declare
  v_deleted integer := 0;
begin
  update public.chat_participants cp
  set left_at = now()
  from public.chat_rooms r
  where cp.room_id = r.id
    and cp.left_at is null
    and (
      (r.status = 'waiting' and r.created_at < now() - interval '2 minutes')
      or (r.status = 'active' and r.created_at < now() - interval '2 hours')
    );

  update public.chat_rooms r
  set status = 'closed', closed_at = coalesce(r.closed_at, now())
  where (
      (r.status = 'waiting' and r.created_at < now() - interval '2 minutes')
      or (r.status = 'active' and r.created_at < now() - interval '2 hours')
    );

  delete from public.chat_rooms r
  where r.status = 'closed'
    and coalesce(r.closed_at, r.created_at) < now() - interval '2 minutes';

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;
revoke all on function public.cleanup_old_chat_rooms() from public, anon, authenticated;

create table public.locations (
  id text primary key,
  display_name text not null unique,
  city text not null default 'Nitra',
  sort_order smallint not null,
  active boolean not null default true,
  constraint locations_id_format check (id ~ '^[a-z0-9_]{2,32}$'),
  constraint locations_city_nitra check (city = 'Nitra')
);

insert into public.locations(id, display_name, sort_order) values
  ('nitra', 'Nitra', 0),
  ('centrum', 'Centrum', 10),
  ('chrenova', 'Chrenová', 20),
  ('klokocina', 'Klokočina', 30),
  ('zobor', 'Zobor', 40),
  ('drazovce', 'Dražovce', 50),
  ('janikovce', 'Janíkovce', 60)
on conflict (id) do update set
  display_name = excluded.display_name,
  sort_order = excluded.sort_order,
  active = true;

create table public.location_neighbors (
  source_id text not null references public.locations(id) on delete cascade,
  target_id text not null references public.locations(id) on delete cascade,
  priority smallint not null check (priority between 1 and 20),
  primary key (source_id, target_id),
  constraint location_neighbors_not_self check (source_id <> target_id)
);

insert into public.location_neighbors(source_id, target_id, priority) values
  ('centrum','chrenova',1),('centrum','klokocina',2),('centrum','zobor',3),
  ('chrenova','centrum',1),('chrenova','janikovce',2),('chrenova','zobor',3),
  ('klokocina','centrum',1),('klokocina','drazovce',2),('klokocina','zobor',3),
  ('zobor','centrum',1),('zobor','drazovce',2),('zobor','chrenova',3),
  ('drazovce','zobor',1),('drazovce','klokocina',2),('drazovce','centrum',3),
  ('janikovce','chrenova',1),('janikovce','centrum',2)
on conflict (source_id, target_id) do update set priority = excluded.priority;

alter table public.profiles
  add column location_id text references public.locations(id) on delete set null,
  add column location_visible boolean not null default true,
  add column deactivated_at timestamptz;

update public.profiles set location_id = 'nitra' where location_id is null;

create table public.matching_profiles (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  matching_enabled boolean not null default false,
  intro text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint matching_profiles_intro_length check (char_length(intro) <= 300)
);

insert into public.matching_profiles(user_id, matching_enabled)
select id, dating_enabled from public.profiles
on conflict (user_id) do nothing;

create table public.matching_photos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.matching_profiles(user_id) on delete cascade,
  storage_path text not null unique,
  position smallint not null check (position between 1 and 3),
  created_at timestamptz not null default now(),
  unique (user_id, position)
);

create table public.interests (
  id text primary key,
  display_name text not null unique,
  sort_order smallint not null,
  constraint interests_id_format check (id ~ '^[a-z0-9_]{2,32}$')
);

insert into public.interests(id, display_name, sort_order) values
  ('music','Hudba',10),('gym','Gym',20),('gaming','Gaming',30),
  ('coffee','Coffee',40),('party','Party',50),('events','Events',60),
  ('photography','Photography',70),('cars','Cars',80),('travel','Travel',90),
  ('fashion','Fashion',100),('sport','Sport',110),('movies','Movies',120)
on conflict (id) do update set display_name = excluded.display_name, sort_order = excluded.sort_order;

create table public.matching_profile_interests (
  user_id uuid not null references public.matching_profiles(user_id) on delete cascade,
  interest_id text not null references public.interests(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, interest_id)
);

create table public.follow_requests (
  requester_id uuid not null references public.profiles(id) on delete cascade,
  target_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 days'),
  primary key (requester_id, target_id),
  constraint follow_requests_not_self check (requester_id <> target_id),
  constraint follow_requests_expiry check (expires_at > created_at)
);

create table public.connections (
  id uuid primary key default gen_random_uuid(),
  user1_id uuid not null references public.profiles(id) on delete cascade,
  user2_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint connections_canonical_order check (user1_id < user2_id),
  constraint connections_unique_pair unique (user1_id, user2_id)
);

create table public.connection_requests (
  requester_id uuid not null references public.profiles(id) on delete cascade,
  target_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 days'),
  primary key (requester_id, target_id),
  constraint connection_requests_not_self check (requester_id <> target_id),
  constraint connection_requests_expiry check (expires_at > created_at)
);

create table public.statuses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles(id) on delete cascade,
  body text not null,
  visibility text not null default 'followers',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours'),
  constraint statuses_body_length check (char_length(btrim(body)) between 1 and 100),
  constraint statuses_visibility_allowed check (visibility in ('public','followers')),
  constraint statuses_max_lifetime check (expires_at <= created_at + interval '24 hours')
);

create table public.posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  image_path text not null unique,
  caption text not null default '',
  created_at timestamptz not null default now(),
  constraint posts_caption_length check (char_length(caption) <= 1000)
);

create table public.post_likes (
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create index profiles_display_name_trgm_idx on public.profiles
  using gin (lower(coalesce(display_name,'')) extensions.gin_trgm_ops);
create index profiles_username_pattern_idx on public.profiles (username text_pattern_ops);
create index profiles_location_active_idx on public.profiles (location_id, last_active_at desc)
  where deactivated_at is null;
create index matching_profiles_enabled_updated_idx on public.matching_profiles (matching_enabled, updated_at desc);
create index matching_photos_user_position_idx on public.matching_photos (user_id, position);
create index matching_interests_interest_user_idx on public.matching_profile_interests (interest_id, user_id);
create index follow_requests_target_created_idx on public.follow_requests (target_id, created_at desc);
create index follow_requests_expires_idx on public.follow_requests (expires_at);
create index connections_user2_idx on public.connections (user2_id);
create index connection_requests_target_created_idx on public.connection_requests (target_id, created_at desc);
create index connection_requests_expires_idx on public.connection_requests (expires_at);
create index statuses_expires_idx on public.statuses (expires_at);
create index statuses_visibility_created_idx on public.statuses (visibility, created_at desc);
create index posts_user_created_idx on public.posts (user_id, created_at desc);
create index posts_created_idx on public.posts (created_at desc);
create index post_likes_user_idx on public.post_likes (user_id);

create or replace function private.storage_owner(p_name text)
returns uuid
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare v_value text := split_part(p_name, '/', 1);
begin
  if v_value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    return v_value::uuid;
  end if;
  return null;
end;
$$;

create or replace function private.can_view_social_content(p_owner uuid, p_viewer uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_viewer is not null
    and not private.users_are_blocked(p_owner, p_viewer)
    and (
      p_owner = p_viewer
      or exists (
        select 1 from public.profiles p
        where p.id = p_owner
          and p.deactivated_at is null
          and (
            not p.is_private
            or exists (
              select 1 from public.follows f
              where f.follower_id = p_viewer and f.following_id = p_owner
            )
          )
      )
    );
$$;

create or replace function private.can_view_matching(p_owner uuid, p_viewer uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_viewer is not null
    and not private.users_are_blocked(p_owner, p_viewer)
    and (
      p_owner = p_viewer
      or exists (
        select 1
        from public.matching_profiles mp
        join public.profiles p on p.id = mp.user_id
        where mp.user_id = p_owner
          and mp.matching_enabled
          and p.deactivated_at is null
      )
    );
$$;

create or replace function private.limit_matching_photo_count()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select count(*) from public.matching_photos where user_id = new.user_id) >= 3 then
    raise exception 'Matching profile can contain at most 3 photos';
  end if;
  return new;
end;
$$;

create trigger matching_photos_limit
before insert on public.matching_photos
for each row execute function private.limit_matching_photo_count();

create or replace function private.limit_matching_interest_count()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select count(*) from public.matching_profile_interests where user_id = new.user_id) >= 8 then
    raise exception 'Matching profile can contain at most 8 interests';
  end if;
  return new;
end;
$$;

create trigger matching_interests_limit
before insert on public.matching_profile_interests
for each row execute function private.limit_matching_interest_count();

create or replace function private.validate_matching_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.matching_enabled and not exists (
    select 1 from public.profiles p
    where p.id = new.user_id and p.birth_date <= current_date - interval '18 years'
  ) then
    raise exception 'Matching mode is available only to users aged 18 or older';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger matching_profiles_validate
before insert or update on public.matching_profiles
for each row execute function private.validate_matching_profile();

create or replace function private.validate_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.user_id <> auth.uid() then
    raise exception 'Status owner mismatch';
  end if;
  if new.visibility = 'public' and exists (
    select 1 from public.profiles p where p.id = new.user_id and p.is_private
  ) then
    raise exception 'Private profiles can publish followers-only statuses';
  end if;
  new.body := btrim(new.body);
  new.created_at := now();
  new.expires_at := now() + interval '24 hours';
  return new;
end;
$$;

create trigger statuses_validate
before insert or update on public.statuses
for each row execute function private.validate_status();

-- Extend the lightweight notification event types; text stays in the client.
alter table public.notifications drop constraint notifications_type_allowed;
alter table public.notifications add constraint notifications_type_allowed check (
  type in ('follow','follow_request','connection_request','connection','matching_like','match','message')
);

create or replace function private.handle_follow_request_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.notifications(user_id, actor_id, type)
  values (new.target_id, new.requester_id, 'follow_request');
  return new;
end;
$$;
create trigger follow_requests_notify
after insert on public.follow_requests
for each row execute function private.handle_follow_request_notification();

create or replace function private.handle_connection_request_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.notifications(user_id, actor_id, type)
  values (new.target_id, new.requester_id, 'connection_request');
  return new;
end;
$$;
create trigger connection_requests_notify
after insert on public.connection_requests
for each row execute function private.handle_connection_request_notification();

create or replace function private.handle_mutual_like()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user1 uuid;
  v_user2 uuid;
  v_match_id uuid;
begin
  if private.users_are_blocked(new.from_user_id, new.to_user_id) then
    raise exception 'This action is not allowed';
  end if;

  insert into public.notifications(user_id, actor_id, type)
  values (new.to_user_id, new.from_user_id, 'matching_like');

  if exists (
    select 1 from public.profile_likes
    where from_user_id = new.to_user_id and to_user_id = new.from_user_id
  ) then
    v_user1 := least(new.from_user_id, new.to_user_id);
    v_user2 := greatest(new.from_user_id, new.to_user_id);
    insert into public.matches(user1_id, user2_id)
    values (v_user1, v_user2)
    on conflict (user1_id, user2_id) do nothing
    returning id into v_match_id;
    if v_match_id is not null then
      insert into public.notifications(user_id, actor_id, type, entity_id)
      values
        (new.from_user_id, new.to_user_id, 'match', v_match_id),
        (new.to_user_id, new.from_user_id, 'match', v_match_id);
    end if;
  end if;
  return new;
end;
$$;

create or replace function private.handle_block()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user1 uuid := least(new.blocker_id, new.blocked_id);
  v_user2 uuid := greatest(new.blocker_id, new.blocked_id);
begin
  delete from public.follows
  where (follower_id = new.blocker_id and following_id = new.blocked_id)
     or (follower_id = new.blocked_id and following_id = new.blocker_id);
  delete from public.follow_requests
  where (requester_id = new.blocker_id and target_id = new.blocked_id)
     or (requester_id = new.blocked_id and target_id = new.blocker_id);
  delete from public.connection_requests
  where (requester_id = new.blocker_id and target_id = new.blocked_id)
     or (requester_id = new.blocked_id and target_id = new.blocker_id);
  delete from public.connections where user1_id = v_user1 and user2_id = v_user2;
  delete from public.profile_likes
  where (from_user_id = new.blocker_id and to_user_id = new.blocked_id)
     or (from_user_id = new.blocked_id and to_user_id = new.blocker_id);
  delete from public.matches where user1_id = v_user1 and user2_id = v_user2;
  delete from public.conversations where user1_id = v_user1 and user2_id = v_user2;
  delete from public.notifications
  where (user_id = new.blocker_id and actor_id = new.blocked_id)
     or (user_id = new.blocked_id and actor_id = new.blocker_id);
  return new;
end;
$$;

-- New users automatically get the small, separate matching settings row.
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_requested_username text := lower(btrim(coalesce(new.raw_user_meta_data ->> 'username', '')));
  v_display_name text := left(btrim(coalesce(new.raw_user_meta_data ->> 'display_name', '')), 50);
  v_username_base text;
  v_username text;
  v_birth_date date;
begin
  begin
    v_birth_date := (new.raw_user_meta_data ->> 'birth_date')::date;
  exception when others then
    raise exception 'Invalid birth date';
  end;
  if v_birth_date > current_date - interval '16 years' then
    raise exception 'Social accounts require age 16 or older';
  end if;
  if v_display_name = '' then v_display_name := 'Používateľ'; end if;
  if v_requested_username ~ '^[a-z0-9_]{3,24}$'
     and not exists (select 1 from public.profiles p where p.username = v_requested_username) then
    v_username := v_requested_username;
  else
    v_username_base := trim(both '_' from regexp_replace(lower(v_display_name), '[^a-z0-9]+', '_', 'g'));
    if char_length(v_username_base) < 3 then v_username_base := 'user'; end if;
    v_username := left(v_username_base, 15) || '_' || left(replace(new.id::text, '-', ''), 8);
  end if;
  insert into public.profiles(id, username, display_name, birth_date, city, location_id)
  values (new.id, v_username, v_display_name, v_birth_date, 'Nitra', 'nitra');
  insert into public.matching_profiles(user_id) values (new.id);
  return new;
end;
$$;

-- Public follow is immediate; private follow creates a request.
create or replace function private.follow_profile(p_target uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare v_me uuid := auth.uid(); v_private boolean;
begin
  if v_me is null or p_target is null or v_me = p_target
     or private.users_are_blocked(v_me, p_target) then
    raise exception 'Follow is not allowed';
  end if;
  select is_private into v_private from public.profiles
  where id = p_target and deactivated_at is null;
  if not found then raise exception 'Profile not found'; end if;
  if exists (select 1 from public.follows where follower_id=v_me and following_id=p_target) then
    return 'following';
  end if;
  if v_private then
    insert into public.follow_requests(requester_id,target_id)
    values(v_me,p_target)
    on conflict(requester_id,target_id) do update set created_at=now(), expires_at=now()+interval '30 days';
    return 'requested';
  end if;
  insert into public.follows(follower_id,following_id) values(v_me,p_target) on conflict do nothing;
  return 'following';
end;
$$;

create or replace function private.cancel_follow(p_target uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_me uuid := auth.uid();
begin
  delete from public.follow_requests where requester_id=v_me and target_id=p_target;
  delete from public.follows where follower_id=v_me and following_id=p_target;
end;
$$;

create or replace function private.respond_follow_request(p_requester uuid, p_accept boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_me uuid := auth.uid();
begin
  if not exists(select 1 from public.follow_requests where requester_id=p_requester and target_id=v_me) then
    raise exception 'Follow request not found';
  end if;
  delete from public.follow_requests where requester_id=p_requester and target_id=v_me;
  if p_accept and not private.users_are_blocked(v_me,p_requester) then
    insert into public.follows(follower_id,following_id) values(p_requester,v_me) on conflict do nothing;
  end if;
end;
$$;

create or replace function private.request_connection(p_target uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare v_me uuid := auth.uid(); v_user1 uuid; v_user2 uuid;
begin
  if v_me is null or p_target is null or v_me=p_target or private.users_are_blocked(v_me,p_target) then
    raise exception 'Connection request is not allowed';
  end if;
  v_user1:=least(v_me,p_target); v_user2:=greatest(v_me,p_target);
  if exists(select 1 from public.connections where user1_id=v_user1 and user2_id=v_user2) then return 'connected'; end if;
  insert into public.connection_requests(requester_id,target_id)
  values(v_me,p_target)
  on conflict(requester_id,target_id) do update set created_at=now(),expires_at=now()+interval '30 days';
  return 'requested';
end;
$$;

create or replace function private.cancel_connection_request(p_target uuid)
returns void
language sql
security definer
set search_path = ''
as $$ delete from public.connection_requests where requester_id=auth.uid() and target_id=p_target; $$;

create or replace function private.respond_connection_request(p_requester uuid, p_accept boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_me uuid:=auth.uid(); v_user1 uuid; v_user2 uuid; v_id uuid;
begin
  if not exists(select 1 from public.connection_requests where requester_id=p_requester and target_id=v_me) then
    raise exception 'Connection request not found';
  end if;
  delete from public.connection_requests where requester_id=p_requester and target_id=v_me;
  if p_accept and not private.users_are_blocked(v_me,p_requester) then
    v_user1:=least(v_me,p_requester); v_user2:=greatest(v_me,p_requester);
    insert into public.connections(user1_id,user2_id) values(v_user1,v_user2)
    on conflict(user1_id,user2_id) do update set user1_id=excluded.user1_id
    returning id into v_id;
    insert into public.notifications(user_id,actor_id,type,entity_id)
    values(p_requester,v_me,'connection',v_id),(v_me,p_requester,'connection',v_id);
  end if;
end;
$$;

create or replace function private.search_profiles(p_query text, p_limit integer default 20, p_after_username text default null)
returns table (
  id uuid, username text, display_name text, avatar_path text, location_name text,
  is_private boolean, follow_state text
)
language sql
stable
security definer
set search_path = ''
as $$
  with input as (select lower(trim(leading '@' from btrim(coalesce(p_query,'')))) q)
  select p.id,p.username,p.display_name,p.avatar_path,
    case when p.location_visible then l.display_name end,
    p.is_private,
    case
      when exists(select 1 from public.follows f where f.follower_id=auth.uid() and f.following_id=p.id) then 'following'
      when exists(select 1 from public.follow_requests fr where fr.requester_id=auth.uid() and fr.target_id=p.id) then 'requested'
      else 'none'
    end
  from public.profiles p
  left join public.locations l on l.id=p.location_id
  cross join input i
  where auth.uid() is not null and char_length(i.q)>=2
    and p.id<>auth.uid() and p.deactivated_at is null
    and not private.users_are_blocked(auth.uid(),p.id)
    and (p.username like '%'||i.q||'%' or lower(coalesce(p.display_name,'')) like '%'||i.q||'%')
    and (p_after_username is null or p.username>p_after_username)
  order by (p.username=i.q) desc,(p.username like i.q||'%') desc,p.username
  limit least(greatest(coalesce(p_limit,20),1),30);
$$;

create or replace function private.discover_profiles_v2(p_mode text default 'suggested', p_limit integer default 20)
returns table (
  id uuid, username text, display_name text, bio text, age integer, avatar_path text,
  location_name text, is_private boolean, follow_state text, common_interests text[]
)
language sql
stable
security definer
set search_path = ''
as $$
  with me as (
    select p.location_id from public.profiles p where p.id=auth.uid()
  ), candidates as (
    select p.*,
      coalesce((select count(*) from public.matching_profile_interests mine
        join public.matching_profile_interests theirs on theirs.interest_id=mine.interest_id
        where mine.user_id=auth.uid() and theirs.user_id=p.id),0) common_count,
      case when p.location_id=(select location_id from me) then 0
        else coalesce((select ln.priority from public.location_neighbors ln
          where ln.source_id=(select location_id from me) and ln.target_id=p.location_id),50) end location_rank
    from public.profiles p
    where auth.uid() is not null and p.id<>auth.uid() and p.deactivated_at is null
      and not private.users_are_blocked(auth.uid(),p.id)
      and not exists(select 1 from public.follows f where f.follower_id=auth.uid() and f.following_id=p.id)
  )
  select c.id,c.username,c.display_name,c.bio,
    extract(year from age(current_date,c.birth_date))::integer,c.avatar_path,
    case when c.location_visible then l.display_name end,c.is_private,
    case when exists(select 1 from public.follow_requests fr where fr.requester_id=auth.uid() and fr.target_id=c.id) then 'requested' else 'none' end,
    array(select i.display_name from public.matching_profile_interests mine
      join public.matching_profile_interests theirs on theirs.interest_id=mine.interest_id
      join public.interests i on i.id=mine.interest_id
      where mine.user_id=auth.uid() and theirs.user_id=c.id order by i.sort_order limit 2)
  from candidates c left join public.locations l on l.id=c.location_id
  order by
    case when p_mode='nearby' then c.location_rank else 0 end,
    case when p_mode='suggested' then c.common_count else 0 end desc,
    case when p_mode='new' then c.created_at end desc,
    c.last_active_at desc nulls last,c.created_at desc
  limit least(greatest(coalesce(p_limit,20),1),30);
$$;

create or replace function private.profile_details(p_profile_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id',p.id,'username',p.username,'display_name',p.display_name,'bio',p.bio,
    'avatar_path',p.avatar_path,'is_private',p.is_private,
    'location_name',case when p.id=auth.uid() or p.location_visible then l.display_name end,
    'location_id',case when p.id=auth.uid() then p.location_id end,
    'location_visible',case when p.id=auth.uid() then p.location_visible end,
    'followers_count',(select count(*) from public.follows f where f.following_id=p.id),
    'following_count',(select count(*) from public.follows f where f.follower_id=p.id),
    'posts_count',(select count(*) from public.posts po where po.user_id=p.id),
    'can_view_content',private.can_view_social_content(p.id,auth.uid()),
    'follow_state',case when p.id=auth.uid() then 'self'
      when exists(select 1 from public.follows f where f.follower_id=auth.uid() and f.following_id=p.id) then 'following'
      when exists(select 1 from public.follow_requests fr where fr.requester_id=auth.uid() and fr.target_id=p.id) then 'requested'
      else 'none' end,
    'connection_state',case when p.id=auth.uid() then 'self'
      when exists(select 1 from public.connections c where c.user1_id=least(auth.uid(),p.id) and c.user2_id=greatest(auth.uid(),p.id)) then 'connected'
      when exists(select 1 from public.connection_requests cr where cr.requester_id=auth.uid() and cr.target_id=p.id) then 'requested'
      when exists(select 1 from public.connection_requests cr where cr.requester_id=p.id and cr.target_id=auth.uid()) then 'incoming'
      else 'none' end,
    'posts',case when private.can_view_social_content(p.id,auth.uid()) then coalesce((
      select jsonb_agg(jsonb_build_object('id',po.id,'image_path',po.image_path,'caption',po.caption,'created_at',po.created_at,'like_count',(select count(*) from public.post_likes pl where pl.post_id=po.id),'liked',(exists(select 1 from public.post_likes pl where pl.post_id=po.id and pl.user_id=auth.uid()))) order by po.created_at desc)
      from (select * from public.posts where user_id=p.id order by created_at desc limit 24) po
    ),'[]'::jsonb) else '[]'::jsonb end
  )
  from public.profiles p left join public.locations l on l.id=p.location_id
  where p.id=p_profile_id and auth.uid() is not null and p.deactivated_at is null
    and not private.users_are_blocked(auth.uid(),p.id);
$$;

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
  where auth.uid() is not null and not private.users_are_blocked(auth.uid(),p.id)
    and (btrim(coalesce(p_query,''))='' or p.username ilike '%'||trim(leading '@' from p_query)||'%' or p.display_name ilike '%'||p_query||'%')
  order by p.username limit least(greatest(coalesce(p_limit,30),1),50);
$$;

create or replace function private.matching_feed(p_limit integer default 12)
returns jsonb
language sql stable security definer set search_path=''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',p.id,'username',p.username,'display_name',p.display_name,'age',extract(year from age(current_date,p.birth_date))::integer,
    'intro',mp.intro,'location_name',case when p.location_visible then l.display_name end,
    'photos',coalesce((select jsonb_agg(mph.storage_path order by mph.position) from public.matching_photos mph where mph.user_id=p.id),'[]'::jsonb),
    'interests',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'name',i.display_name) order by i.sort_order) from public.matching_profile_interests mpi join public.interests i on i.id=mpi.interest_id where mpi.user_id=p.id),'[]'::jsonb),
    'liked',exists(select 1 from public.profile_likes pl where pl.from_user_id=auth.uid() and pl.to_user_id=p.id)
  ) order by p.last_active_at desc nulls last),'[]'::jsonb)
  from (select p.* from public.profiles p join public.matching_profiles mp0 on mp0.user_id=p.id
    where auth.uid() is not null
      and exists(select 1 from public.matching_profiles mine where mine.user_id=auth.uid() and mine.matching_enabled)
      and p.id<>auth.uid() and p.deactivated_at is null and mp0.matching_enabled
      and not private.users_are_blocked(auth.uid(),p.id)
    order by p.last_active_at desc nulls last limit least(greatest(coalesce(p_limit,12),1),20)) p
  join public.matching_profiles mp on mp.user_id=p.id
  left join public.locations l on l.id=p.location_id;
$$;

create or replace function private.matching_updates(p_limit integer default 30)
returns jsonb
language sql stable security definer set search_path=''
as $$
  select jsonb_build_object(
    'unread',(select count(*) from public.notifications n where n.user_id=auth.uid() and n.type in ('matching_like','match') and n.read_at is null),
    'items',coalesce((select jsonb_agg(jsonb_build_object('id',n.id,'actor_id',n.actor_id,'type',n.type,'entity_id',n.entity_id,'created_at',n.created_at,'read_at',n.read_at,'actor_username',p.username,'actor_name',p.display_name,'actor_avatar',p.avatar_path) order by n.created_at desc)
      from (select * from public.notifications where user_id=auth.uid() and type in ('matching_like','match') order by created_at desc limit least(greatest(coalesce(p_limit,30),1),50)) n
      left join public.profiles p on p.id=n.actor_id),'[]'::jsonb)
  );
$$;

create or replace function private.request_inbox()
returns jsonb
language sql stable security definer set search_path=''
as $$
  select jsonb_build_object(
    'follow_requests',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'username',p.username,'display_name',p.display_name,'avatar_path',p.avatar_path,'created_at',fr.created_at) order by fr.created_at desc) from public.follow_requests fr join public.profiles p on p.id=fr.requester_id where fr.target_id=auth.uid() and fr.expires_at>now() and not private.users_are_blocked(auth.uid(),fr.requester_id)),'[]'::jsonb),
    'connection_requests',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'username',p.username,'display_name',p.display_name,'avatar_path',p.avatar_path,'created_at',cr.created_at) order by cr.created_at desc) from public.connection_requests cr join public.profiles p on p.id=cr.requester_id where cr.target_id=auth.uid() and cr.expires_at>now() and not private.users_are_blocked(auth.uid(),cr.requester_id)),'[]'::jsonb)
  );
$$;

-- JSON helper used by the Home payload to avoid N+1 profile requests.
create or replace function private.discover_profiles_json(p_mode text, p_limit integer)
returns jsonb
language sql stable security definer set search_path=''
as $$
  select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb)
  from private.discover_profiles_v2(p_mode,p_limit) x;
$$;

-- Recreate social_home now that its helper exists.
create or replace function private.social_home(p_post_limit integer default 10, p_suggested_limit integer default 10)
returns jsonb
language sql stable security definer set search_path=''
as $$
  select jsonb_build_object(
    'statuses',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'body',s.body,'visibility',s.visibility,'created_at',s.created_at,'expires_at',s.expires_at,'user_id',p.id,'username',p.username,'display_name',p.display_name,'avatar_path',p.avatar_path) order by s.created_at desc)
      from public.statuses s join public.profiles p on p.id=s.user_id
      where s.expires_at>now() and not private.users_are_blocked(auth.uid(),s.user_id)
        and (s.user_id=auth.uid() or (s.visibility='public' and not p.is_private) or exists(select 1 from public.follows f where f.follower_id=auth.uid() and f.following_id=s.user_id))),'[]'::jsonb),
    'suggested',private.discover_profiles_json('suggested',p_suggested_limit),
    'posts',coalesce((select jsonb_agg(jsonb_build_object('id',po.id,'image_path',po.image_path,'caption',po.caption,'created_at',po.created_at,'user_id',p.id,'username',p.username,'display_name',p.display_name,'avatar_path',p.avatar_path,'like_count',(select count(*) from public.post_likes pl where pl.post_id=po.id),'liked',exists(select 1 from public.post_likes pl where pl.post_id=po.id and pl.user_id=auth.uid())) order by po.created_at desc)
      from (select po.* from public.posts po join public.profiles pp on pp.id=po.user_id where not pp.is_private and pp.deactivated_at is null and not private.users_are_blocked(auth.uid(),po.user_id) order by po.created_at desc limit least(greatest(coalesce(p_post_limit,10),1),20)) po
      join public.profiles p on p.id=po.user_id),'[]'::jsonb)
  );
$$;

create or replace function private.set_status(p_body text, p_visibility text)
returns uuid
language plpgsql security definer set search_path=''
as $$
declare v_id uuid;
begin
  insert into public.statuses(user_id,body,visibility) values(auth.uid(),p_body,p_visibility)
  on conflict(user_id) do update set body=excluded.body,visibility=excluded.visibility,created_at=now(),expires_at=now()+interval '24 hours'
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function private.save_matching_profile(p_enabled boolean, p_intro text, p_interest_ids text[])
returns void
language plpgsql security definer set search_path=''
as $$
declare v_me uuid:=auth.uid(); v_ids text[]:=coalesce(p_interest_ids,array[]::text[]);
begin
  if coalesce(array_length(v_ids,1),0)>8 then raise exception 'Choose at most 8 interests'; end if;
  if exists(select 1 from unnest(v_ids) x where not exists(select 1 from public.interests i where i.id=x)) then
    raise exception 'Unknown interest';
  end if;
  update public.matching_profiles set matching_enabled=p_enabled,intro=left(btrim(coalesce(p_intro,'')),300) where user_id=v_me;
  delete from public.matching_profile_interests where user_id=v_me;
  insert into public.matching_profile_interests(user_id,interest_id)
  select v_me,x from unnest(v_ids) x on conflict do nothing;
end;
$$;

create or replace function private.toggle_post_like(p_post_id uuid)
returns boolean
language plpgsql security definer set search_path=''
as $$
begin
  if exists(select 1 from public.post_likes where post_id=p_post_id and user_id=auth.uid()) then
    delete from public.post_likes where post_id=p_post_id and user_id=auth.uid(); return false;
  end if;
  if not exists(select 1 from public.posts p where p.id=p_post_id and private.can_view_social_content(p.user_id,auth.uid())) then
    raise exception 'Post is not available';
  end if;
  insert into public.post_likes(post_id,user_id) values(p_post_id,auth.uid()); return true;
end;
$$;

-- Connections as well as matches can open a retained social DM.
create or replace function private.get_or_create_dm(p_other_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v_me uuid:=auth.uid(); v_user1 uuid; v_user2 uuid; v_conversation_id uuid;
begin
  if v_me is null or p_other_user_id is null or v_me=p_other_user_id then raise exception 'Invalid conversation participant'; end if;
  if private.users_are_blocked(v_me,p_other_user_id) then raise exception 'This conversation is blocked'; end if;
  v_user1:=least(v_me,p_other_user_id); v_user2:=greatest(v_me,p_other_user_id);
  if not exists(select 1 from public.matches where user1_id=v_user1 and user2_id=v_user2)
     and not exists(select 1 from public.connections where user1_id=v_user1 and user2_id=v_user2) then
    raise exception 'A mutual match or accepted connection is required before messaging';
  end if;
  insert into public.conversations(user1_id,user2_id) values(v_user1,v_user2)
  on conflict(user1_id,user2_id) do update set user1_id=excluded.user1_id returning id into v_conversation_id;
  insert into public.conversation_members(conversation_id,user_id)
  values(v_conversation_id,v_user1),(v_conversation_id,v_user2) on conflict do nothing;
  return v_conversation_id;
end;
$$;

-- Public invoker wrappers are the only exposed RPC surface.
create or replace function public.search_profiles(p_query text,p_limit integer default 20,p_after_username text default null)
returns table(id uuid,username text,display_name text,avatar_path text,location_name text,is_private boolean,follow_state text)
language sql stable security invoker set search_path=''
as $$ select * from private.search_profiles(p_query,p_limit,p_after_username); $$;
create or replace function public.discover_profiles_v2(p_mode text default 'suggested',p_limit integer default 20)
returns table(id uuid,username text,display_name text,bio text,age integer,avatar_path text,location_name text,is_private boolean,follow_state text,common_interests text[])
language sql stable security invoker set search_path=''
as $$ select * from private.discover_profiles_v2(p_mode,p_limit); $$;
create or replace function public.profile_details(p_profile_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$ select private.profile_details(p_profile_id); $$;
create or replace function public.list_profile_relationships(p_profile_id uuid,p_kind text,p_query text default '',p_limit integer default 30)
returns table(id uuid,username text,display_name text,avatar_path text,follow_state text)
language sql stable security invoker set search_path='' as $$ select * from private.list_profile_relationships(p_profile_id,p_kind,p_query,p_limit); $$;
create or replace function public.matching_feed(p_limit integer default 12) returns jsonb
language sql stable security invoker set search_path='' as $$ select private.matching_feed(p_limit); $$;
create or replace function public.matching_updates(p_limit integer default 30) returns jsonb
language sql stable security invoker set search_path='' as $$ select private.matching_updates(p_limit); $$;
create or replace function public.request_inbox() returns jsonb
language sql stable security invoker set search_path='' as $$ select private.request_inbox(); $$;
create or replace function public.social_home(p_post_limit integer default 10,p_suggested_limit integer default 10) returns jsonb
language sql stable security invoker set search_path='' as $$ select private.social_home(p_post_limit,p_suggested_limit); $$;
create or replace function public.follow_profile(p_target uuid) returns text
language sql volatile security invoker set search_path='' as $$ select private.follow_profile(p_target); $$;
create or replace function public.cancel_follow(p_target uuid) returns void
language sql volatile security invoker set search_path='' as $$ select private.cancel_follow(p_target); $$;
create or replace function public.respond_follow_request(p_requester uuid,p_accept boolean) returns void
language sql volatile security invoker set search_path='' as $$ select private.respond_follow_request(p_requester,p_accept); $$;
create or replace function public.request_connection(p_target uuid) returns text
language sql volatile security invoker set search_path='' as $$ select private.request_connection(p_target); $$;
create or replace function public.cancel_connection_request(p_target uuid) returns void
language sql volatile security invoker set search_path='' as $$ select private.cancel_connection_request(p_target); $$;
create or replace function public.respond_connection_request(p_requester uuid,p_accept boolean) returns void
language sql volatile security invoker set search_path='' as $$ select private.respond_connection_request(p_requester,p_accept); $$;
create or replace function public.set_status(p_body text,p_visibility text) returns uuid
language sql volatile security invoker set search_path='' as $$ select private.set_status(p_body,p_visibility); $$;
create or replace function public.save_matching_profile(p_enabled boolean,p_intro text,p_interest_ids text[]) returns void
language sql volatile security invoker set search_path='' as $$ select private.save_matching_profile(p_enabled,p_intro,p_interest_ids); $$;
create or replace function public.toggle_post_like(p_post_id uuid) returns boolean
language sql volatile security invoker set search_path='' as $$ select private.toggle_post_like(p_post_id); $$;

-- RLS for every newly exposed table.
alter table public.locations enable row level security;
alter table public.location_neighbors enable row level security;
alter table public.matching_profiles enable row level security;
alter table public.matching_photos enable row level security;
alter table public.interests enable row level security;
alter table public.matching_profile_interests enable row level security;
alter table public.follow_requests enable row level security;
alter table public.connections enable row level security;
alter table public.connection_requests enable row level security;
alter table public.statuses enable row level security;
alter table public.posts enable row level security;
alter table public.post_likes enable row level security;

create policy locations_read on public.locations for select to authenticated using (active);
create policy location_neighbors_read on public.location_neighbors for select to authenticated using (true);
create policy interests_read on public.interests for select to authenticated using (true);

create policy matching_profiles_read on public.matching_profiles for select to authenticated
using ((select private.can_view_matching(user_id,(select auth.uid()))));
create policy matching_profiles_update_own on public.matching_profiles for update to authenticated
using (user_id=(select auth.uid())) with check(user_id=(select auth.uid()));
create policy matching_photos_read on public.matching_photos for select to authenticated
using ((select private.can_view_matching(user_id,(select auth.uid()))));
create policy matching_photos_insert_own on public.matching_photos for insert to authenticated
with check(user_id=(select auth.uid()));
create policy matching_photos_update_own on public.matching_photos for update to authenticated
using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));
create policy matching_photos_delete_own on public.matching_photos for delete to authenticated
using(user_id=(select auth.uid()));
create policy matching_interests_read on public.matching_profile_interests for select to authenticated
using ((select private.can_view_matching(user_id,(select auth.uid()))));
create policy matching_interests_insert_own on public.matching_profile_interests for insert to authenticated
with check(user_id=(select auth.uid()));
create policy matching_interests_delete_own on public.matching_profile_interests for delete to authenticated
using(user_id=(select auth.uid()));

create policy follow_requests_read_related on public.follow_requests for select to authenticated
using((select auth.uid()) in (requester_id,target_id));
create policy follow_requests_insert_own on public.follow_requests for insert to authenticated
with check(requester_id=(select auth.uid()) and not private.users_are_blocked(requester_id,target_id)
  and exists(select 1 from public.profiles p where p.id=target_id and p.is_private));
create policy follow_requests_delete_related on public.follow_requests for delete to authenticated
using((select auth.uid()) in (requester_id,target_id));

drop policy follows_insert_own on public.follows;
create policy follows_insert_own on public.follows for insert to authenticated
with check(follower_id=(select auth.uid()) and not private.users_are_blocked(follower_id,following_id)
  and exists(select 1 from public.profiles p where p.id=following_id and not p.is_private));

create policy connections_read_member on public.connections for select to authenticated
using((select auth.uid()) in (user1_id,user2_id) and not private.users_are_blocked(user1_id,user2_id));
create policy connection_requests_read_related on public.connection_requests for select to authenticated
using((select auth.uid()) in (requester_id,target_id));
create policy connection_requests_insert_own on public.connection_requests for insert to authenticated
with check(requester_id=(select auth.uid()) and not private.users_are_blocked(requester_id,target_id));
create policy connection_requests_delete_related on public.connection_requests for delete to authenticated
using((select auth.uid()) in (requester_id,target_id));

create policy statuses_read_allowed on public.statuses for select to authenticated
using(expires_at>now() and not private.users_are_blocked(user_id,(select auth.uid())) and (
  user_id=(select auth.uid())
  or (visibility='public' and exists(select 1 from public.profiles p where p.id=user_id and not p.is_private))
  or exists(select 1 from public.follows f where f.follower_id=(select auth.uid()) and f.following_id=user_id)
));
create policy statuses_insert_own on public.statuses for insert to authenticated with check(user_id=(select auth.uid()));
create policy statuses_update_own on public.statuses for update to authenticated
using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));
create policy statuses_delete_own on public.statuses for delete to authenticated using(user_id=(select auth.uid()));

create policy posts_read_allowed on public.posts for select to authenticated
using((select private.can_view_social_content(user_id,(select auth.uid()))));
create policy posts_insert_own on public.posts for insert to authenticated with check(user_id=(select auth.uid()));
create policy posts_update_own on public.posts for update to authenticated
using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));
create policy posts_delete_own on public.posts for delete to authenticated using(user_id=(select auth.uid()));
create policy post_likes_read_own on public.post_likes for select to authenticated using(user_id=(select auth.uid()));
create policy post_likes_insert_own on public.post_likes for insert to authenticated
with check(user_id=(select auth.uid()) and exists(select 1 from public.posts p where p.id=post_id and private.can_view_social_content(p.user_id,(select auth.uid()))));
create policy post_likes_delete_own on public.post_likes for delete to authenticated using(user_id=(select auth.uid()));

drop policy likes_insert_own on public.profile_likes;
create policy likes_insert_own on public.profile_likes for insert to authenticated
with check(from_user_id=(select auth.uid()) and not private.users_are_blocked(from_user_id,to_user_id)
  and exists(select 1 from public.matching_profiles mine where mine.user_id=from_user_id and mine.matching_enabled)
  and exists(select 1 from public.matching_profiles target where target.user_id=to_user_id and target.matching_enabled));

-- Storage buckets are private; reads require the same database visibility rules.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values
  ('matching-photos','matching-photos',false,358400,array['image/webp']),
  ('post-images','post-images',false,614400,array['image/webp'])
on conflict(id) do update set public=excluded.public,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

create policy matching_storage_read on storage.objects for select to authenticated
using(bucket_id='matching-photos' and (select private.can_view_matching(private.storage_owner(name),(select auth.uid()))));
create policy matching_storage_insert on storage.objects for insert to authenticated
with check(bucket_id='matching-photos' and private.storage_owner(name)=(select auth.uid()) and owner_id=(select auth.uid()::text));
create policy matching_storage_update on storage.objects for update to authenticated
using(bucket_id='matching-photos' and private.storage_owner(name)=(select auth.uid()) and owner_id=(select auth.uid()::text))
with check(bucket_id='matching-photos' and private.storage_owner(name)=(select auth.uid()) and owner_id=(select auth.uid()::text));
create policy matching_storage_delete on storage.objects for delete to authenticated
using(bucket_id='matching-photos' and private.storage_owner(name)=(select auth.uid()) and owner_id=(select auth.uid()::text));

create policy post_storage_read on storage.objects for select to authenticated
using(bucket_id='post-images' and (select private.can_view_social_content(private.storage_owner(name),(select auth.uid()))));
create policy post_storage_insert on storage.objects for insert to authenticated
with check(bucket_id='post-images' and private.storage_owner(name)=(select auth.uid()) and owner_id=(select auth.uid()::text));
create policy post_storage_update on storage.objects for update to authenticated
using(bucket_id='post-images' and private.storage_owner(name)=(select auth.uid()) and owner_id=(select auth.uid()::text))
with check(bucket_id='post-images' and private.storage_owner(name)=(select auth.uid()) and owner_id=(select auth.uid()::text));
create policy post_storage_delete on storage.objects for delete to authenticated
using(bucket_id='post-images' and private.storage_owner(name)=(select auth.uid()) and owner_id=(select auth.uid()::text));

-- Least-privilege Data API grants (also prepares for the October 2026 change).
revoke all on public.locations,public.location_neighbors,public.matching_profiles,public.matching_photos,
  public.interests,public.matching_profile_interests,public.follow_requests,public.connections,
  public.connection_requests,public.statuses,public.posts,public.post_likes from anon;
revoke all on public.locations,public.location_neighbors,public.matching_profiles,public.matching_photos,
  public.interests,public.matching_profile_interests,public.follow_requests,public.connections,
  public.connection_requests,public.statuses,public.posts,public.post_likes from authenticated;
grant select on public.locations,public.location_neighbors,public.interests to authenticated;
grant select,update(matching_enabled,intro) on public.matching_profiles to authenticated;
grant select,insert,update(position),delete on public.matching_photos to authenticated;
grant select,insert,delete on public.matching_profile_interests to authenticated;
grant select,insert,delete on public.follow_requests,public.connection_requests to authenticated;
grant select on public.connections to authenticated;
grant select,insert,update(body,visibility,created_at,expires_at),delete on public.statuses to authenticated;
grant select,insert,update(caption),delete on public.posts to authenticated;
grant select,insert,delete on public.post_likes to authenticated;
grant update(location_id,location_visible) on public.profiles to authenticated;

revoke all on function private.storage_owner(text),private.can_view_social_content(uuid,uuid),private.can_view_matching(uuid,uuid),
  private.follow_profile(uuid),private.cancel_follow(uuid),private.respond_follow_request(uuid,boolean),
  private.request_connection(uuid),private.cancel_connection_request(uuid),private.respond_connection_request(uuid,boolean),
  private.search_profiles(text,integer,text),private.discover_profiles_v2(text,integer),private.profile_details(uuid),
  private.list_profile_relationships(uuid,text,text,integer),private.matching_feed(integer),private.matching_updates(integer),
  private.request_inbox(),private.social_home(integer,integer),private.set_status(text,text),private.save_matching_profile(boolean,text,text[]),private.toggle_post_like(uuid)
  from public,anon;
grant execute on function private.storage_owner(text),private.can_view_social_content(uuid,uuid),private.can_view_matching(uuid,uuid),
  private.follow_profile(uuid),private.cancel_follow(uuid),private.respond_follow_request(uuid,boolean),
  private.request_connection(uuid),private.cancel_connection_request(uuid),private.respond_connection_request(uuid,boolean),
  private.search_profiles(text,integer,text),private.discover_profiles_v2(text,integer),private.profile_details(uuid),
  private.list_profile_relationships(uuid,text,text,integer),private.matching_feed(integer),private.matching_updates(integer),
  private.request_inbox(),private.social_home(integer,integer),private.set_status(text,text),private.save_matching_profile(boolean,text,text[]),private.toggle_post_like(uuid)
  to authenticated;

revoke all on function public.search_profiles(text,integer,text),public.discover_profiles_v2(text,integer),public.profile_details(uuid),
  public.list_profile_relationships(uuid,text,text,integer),public.matching_feed(integer),public.matching_updates(integer),
  public.request_inbox(),public.social_home(integer,integer),public.follow_profile(uuid),public.cancel_follow(uuid),
  public.respond_follow_request(uuid,boolean),public.request_connection(uuid),public.cancel_connection_request(uuid),
  public.respond_connection_request(uuid,boolean),public.set_status(text,text),public.save_matching_profile(boolean,text,text[]),public.toggle_post_like(uuid)
  from public,anon;
grant execute on function public.search_profiles(text,integer,text),public.discover_profiles_v2(text,integer),public.profile_details(uuid),
  public.list_profile_relationships(uuid,text,text,integer),public.matching_feed(integer),public.matching_updates(integer),
  public.request_inbox(),public.social_home(integer,integer),public.follow_profile(uuid),public.cancel_follow(uuid),
  public.respond_follow_request(uuid,boolean),public.request_connection(uuid),public.cancel_connection_request(uuid),
  public.respond_connection_request(uuid,boolean),public.set_status(text,text),public.save_matching_profile(boolean,text,text[]),public.toggle_post_like(uuid)
  to authenticated;

-- Keep the old public wrapper functional with the updated private DM rule.
grant execute on function private.get_or_create_dm(uuid) to authenticated;

create or replace function public.cleanup_expired_social_data()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_dm_retention interval; v_notification_retention interval;
  v_messages integer; v_notifications integer; v_conversations integer;
  v_statuses integer; v_follow_requests integer; v_connection_requests integer;
begin
  select dm_retention,notification_retention into v_dm_retention,v_notification_retention
  from private.social_retention where id=true;
  delete from public.direct_messages where created_at<now()-v_dm_retention; get diagnostics v_messages=row_count;
  delete from public.notifications where created_at<now()-v_notification_retention; get diagnostics v_notifications=row_count;
  delete from public.statuses where expires_at<=now(); get diagnostics v_statuses=row_count;
  delete from public.follow_requests where expires_at<=now(); get diagnostics v_follow_requests=row_count;
  delete from public.connection_requests where expires_at<=now(); get diagnostics v_connection_requests=row_count;
  delete from public.conversations c where not exists(select 1 from public.direct_messages dm where dm.conversation_id=c.id) and c.created_at<now()-v_dm_retention;
  get diagnostics v_conversations=row_count;
  return jsonb_build_object('direct_messages',v_messages,'notifications',v_notifications,'statuses',v_statuses,
    'follow_requests',v_follow_requests,'connection_requests',v_connection_requests,'conversations',v_conversations);
end;
$$;
revoke all on function public.cleanup_expired_social_data() from public,anon,authenticated;
grant execute on function public.cleanup_expired_social_data() to service_role;
