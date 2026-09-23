-- Nitra Space social core.
-- This migration is intentionally isolated from the existing anonymous chat
-- tables and RPC functions.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique,
  display_name text,
  bio text not null default '',
  birth_date date not null,
  city text not null default 'Nitra',
  avatar_path text,
  dating_enabled boolean not null default false,
  is_private boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_active_at timestamptz,
  constraint profiles_username_format check (
    username = lower(username)
    and username ~ '^[a-z0-9_]{3,24}$'
  ),
  constraint profiles_display_name_length check (char_length(display_name) <= 50),
  constraint profiles_bio_length check (char_length(bio) <= 500),
  constraint profiles_city_nitra check (city = 'Nitra'),
  constraint profiles_minimum_age check (birth_date <= current_date - interval '16 years'),
  constraint profiles_dating_age check (
    dating_enabled = false
    or birth_date <= current_date - interval '18 years'
  )
);

create table public.follows (
  follower_id uuid not null references public.profiles(id) on delete cascade,
  following_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, following_id),
  constraint follows_not_self check (follower_id <> following_id)
);

create table public.profile_likes (
  from_user_id uuid not null references public.profiles(id) on delete cascade,
  to_user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (from_user_id, to_user_id),
  constraint profile_likes_not_self check (from_user_id <> to_user_id)
);

create table public.matches (
  id uuid primary key default gen_random_uuid(),
  user1_id uuid not null references public.profiles(id) on delete cascade,
  user2_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint matches_canonical_order check (user1_id < user2_id),
  constraint matches_unique_pair unique (user1_id, user2_id)
);

create table public.blocks (
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint blocks_not_self check (blocker_id <> blocked_id)
);

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  reported_user_id uuid not null references public.profiles(id) on delete cascade,
  reason text not null,
  created_at timestamptz not null default now(),
  status text not null default 'open',
  constraint reports_not_self check (reporter_id <> reported_user_id),
  constraint reports_reason_allowed check (
    reason in ('spam', 'harassment', 'hate', 'sexual_content', 'impersonation', 'underage', 'other')
  ),
  constraint reports_status_allowed check (status in ('open', 'reviewing', 'resolved', 'dismissed'))
);

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  user1_id uuid not null references public.profiles(id) on delete cascade,
  user2_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  last_message_at timestamptz,
  constraint conversations_canonical_order check (user1_id < user2_id),
  constraint conversations_unique_pair unique (user1_id, user2_id)
);

create table public.conversation_members (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

create table public.direct_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  constraint direct_messages_body_length check (
    char_length(btrim(body)) between 1 and 2000
  )
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete cascade,
  type text not null,
  entity_id uuid,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  constraint notifications_type_allowed check (type in ('follow', 'match', 'message'))
);

create table private.social_retention (
  id boolean primary key default true check (id),
  dm_retention interval not null default interval '30 days',
  notification_retention interval not null default interval '30 days'
);
insert into private.social_retention(id) values (true) on conflict (id) do nothing;
revoke all on private.social_retention from public, anon, authenticated;

create index follows_following_idx on public.follows(following_id);
create index profile_likes_to_user_idx on public.profile_likes(to_user_id);
create index matches_user2_idx on public.matches(user2_id);
create index blocks_blocked_idx on public.blocks(blocked_id);
create index direct_messages_conversation_created_idx
  on public.direct_messages(conversation_id, created_at desc);
create index notifications_user_created_idx
  on public.notifications(user_id, created_at desc);
create index reports_reporter_created_idx
  on public.reports(reporter_id, created_at desc);

create or replace function private.users_are_blocked(p_user_a uuid, p_user_b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.blocks b
    where (b.blocker_id = p_user_a and b.blocked_id = p_user_b)
       or (b.blocker_id = p_user_b and b.blocked_id = p_user_a)
  );
$$;

create or replace function private.is_conversation_member(p_conversation_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.conversation_members cm
    where cm.conversation_id = p_conversation_id and cm.user_id = p_user_id
  );
$$;

revoke all on function private.users_are_blocked(uuid, uuid) from public, anon;
revoke all on function private.is_conversation_member(uuid, uuid) from public, anon;
grant execute on function private.users_are_blocked(uuid, uuid) to authenticated;
grant execute on function private.is_conversation_member(uuid, uuid) to authenticated;

create or replace function private.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  new.username := lower(btrim(new.username));
  new.city := 'Nitra';
  return new;
end;
$$;

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function private.set_updated_at();

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_username text := lower(btrim(coalesce(new.raw_user_meta_data ->> 'username', '')));
  v_display_name text := nullif(btrim(coalesce(new.raw_user_meta_data ->> 'display_name', '')), '');
  v_birth_date date;
begin
  begin
    v_birth_date := (new.raw_user_meta_data ->> 'birth_date')::date;
  exception when others then
    raise exception 'Invalid birth date';
  end;

  if v_username !~ '^[a-z0-9_]{3,24}$' then
    raise exception 'Username must contain 3-24 lowercase letters, numbers or underscores';
  end if;

  if v_birth_date > current_date - interval '16 years' then
    raise exception 'Social accounts require age 16 or older';
  end if;

  insert into public.profiles(id, username, display_name, birth_date, city)
  values (new.id, v_username, coalesce(v_display_name, v_username), v_birth_date, 'Nitra');
  return new;
end;
$$;

revoke all on function private.handle_new_user() from public, anon, authenticated;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function private.handle_new_user();

create or replace function private.limit_social_action()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if tg_table_name = 'reports' then
    select count(*) into v_count from public.reports
    where reporter_id = new.reporter_id and created_at > now() - interval '1 hour';
    if v_count >= 5 then raise exception 'Too many reports. Try again later.'; end if;
  elsif tg_table_name = 'profile_likes' then
    select count(*) into v_count from public.profile_likes
    where from_user_id = new.from_user_id and created_at > now() - interval '1 minute';
    if v_count >= 30 then raise exception 'Too many likes. Try again later.'; end if;
  elsif tg_table_name = 'follows' then
    select count(*) into v_count from public.follows
    where follower_id = new.follower_id and created_at > now() - interval '1 minute';
    if v_count >= 30 then raise exception 'Too many follows. Try again later.'; end if;
  elsif tg_table_name = 'direct_messages' then
    select count(*) into v_count from public.direct_messages
    where sender_id = new.sender_id and created_at > now() - interval '1 minute';
    if v_count >= 30 then raise exception 'Too many messages. Try again later.'; end if;
  end if;
  return new;
end;
$$;
revoke all on function private.limit_social_action() from public, anon, authenticated;

create trigger reports_rate_limit before insert on public.reports
for each row execute function private.limit_social_action();
create trigger likes_rate_limit before insert on public.profile_likes
for each row execute function private.limit_social_action();
create trigger follows_rate_limit before insert on public.follows
for each row execute function private.limit_social_action();
create trigger direct_messages_rate_limit before insert on public.direct_messages
for each row execute function private.limit_social_action();

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
revoke all on function private.handle_mutual_like() from public, anon, authenticated;
create trigger profile_likes_create_match
after insert on public.profile_likes
for each row execute function private.handle_mutual_like();

create or replace function private.handle_follow_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if private.users_are_blocked(new.follower_id, new.following_id) then
    raise exception 'This action is not allowed';
  end if;
  insert into public.notifications(user_id, actor_id, type)
  values (new.following_id, new.follower_id, 'follow');
  return new;
end;
$$;
revoke all on function private.handle_follow_notification() from public, anon, authenticated;
create trigger follows_create_notification
after insert on public.follows
for each row execute function private.handle_follow_notification();

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
  delete from public.profile_likes
  where (from_user_id = new.blocker_id and to_user_id = new.blocked_id)
     or (from_user_id = new.blocked_id and to_user_id = new.blocker_id);
  delete from public.matches where user1_id = v_user1 and user2_id = v_user2;
  delete from public.conversations where user1_id = v_user1 and user2_id = v_user2;
  return new;
end;
$$;
revoke all on function private.handle_block() from public, anon, authenticated;
create trigger blocks_remove_connections
after insert on public.blocks
for each row execute function private.handle_block();

create or replace function private.touch_conversation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.conversations set last_message_at = new.created_at where id = new.conversation_id;
  insert into public.notifications(user_id, actor_id, type, entity_id)
  select cm.user_id, new.sender_id, 'message', new.conversation_id
  from public.conversation_members cm
  where cm.conversation_id = new.conversation_id and cm.user_id <> new.sender_id;
  return new;
end;
$$;
revoke all on function private.touch_conversation() from public, anon, authenticated;
create trigger direct_messages_touch_conversation
after insert on public.direct_messages
for each row execute function private.touch_conversation();

create or replace function public.discover_profiles(p_limit integer default 20)
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

create or replace function public.get_public_profile(p_profile_id uuid)
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

create or replace function public.get_or_create_dm(p_other_user_id uuid)
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

revoke all on function public.discover_profiles(integer) from public, anon;
revoke all on function public.get_public_profile(uuid) from public, anon;
revoke all on function public.get_or_create_dm(uuid) from public, anon;
grant execute on function public.discover_profiles(integer) to authenticated;
grant execute on function public.get_public_profile(uuid) to authenticated;
grant execute on function public.get_or_create_dm(uuid) to authenticated;

create or replace function public.cleanup_expired_social_data()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_dm_retention interval;
  v_notification_retention interval;
  v_messages integer;
  v_notifications integer;
  v_conversations integer;
begin
  select dm_retention, notification_retention
    into v_dm_retention, v_notification_retention
  from private.social_retention where id = true;

  delete from public.direct_messages where created_at < now() - v_dm_retention;
  get diagnostics v_messages = row_count;
  delete from public.notifications where created_at < now() - v_notification_retention;
  get diagnostics v_notifications = row_count;
  delete from public.conversations c
  where not exists (select 1 from public.direct_messages dm where dm.conversation_id = c.id)
    and c.created_at < now() - v_dm_retention;
  get diagnostics v_conversations = row_count;

  return jsonb_build_object(
    'direct_messages', v_messages,
    'notifications', v_notifications,
    'conversations', v_conversations
  );
end;
$$;
revoke all on function public.cleanup_expired_social_data() from public, anon, authenticated;
grant execute on function public.cleanup_expired_social_data() to service_role;

alter table public.profiles enable row level security;
alter table public.follows enable row level security;
alter table public.profile_likes enable row level security;
alter table public.matches enable row level security;
alter table public.blocks enable row level security;
alter table public.reports enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.direct_messages enable row level security;
alter table public.notifications enable row level security;

create policy profiles_select_own on public.profiles for select to authenticated
using ((select auth.uid()) = id);
create policy profiles_update_own on public.profiles for update to authenticated
using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

create policy follows_select_related on public.follows for select to authenticated
using ((select auth.uid()) in (follower_id, following_id));
create policy follows_insert_own on public.follows for insert to authenticated
with check ((select auth.uid()) = follower_id and not private.users_are_blocked(follower_id, following_id));
create policy follows_delete_own on public.follows for delete to authenticated
using ((select auth.uid()) = follower_id);

create policy likes_select_own on public.profile_likes for select to authenticated
using ((select auth.uid()) = from_user_id);
create policy likes_insert_own on public.profile_likes for insert to authenticated
with check ((select auth.uid()) = from_user_id and not private.users_are_blocked(from_user_id, to_user_id));
create policy likes_delete_own on public.profile_likes for delete to authenticated
using ((select auth.uid()) = from_user_id);

create policy matches_select_member on public.matches for select to authenticated
using ((select auth.uid()) in (user1_id, user2_id) and not private.users_are_blocked(user1_id, user2_id));

create policy blocks_select_own on public.blocks for select to authenticated
using ((select auth.uid()) = blocker_id);
create policy blocks_insert_own on public.blocks for insert to authenticated
with check ((select auth.uid()) = blocker_id);
create policy blocks_delete_own on public.blocks for delete to authenticated
using ((select auth.uid()) = blocker_id);

create policy reports_insert_own on public.reports for insert to authenticated
with check ((select auth.uid()) = reporter_id);

create policy conversations_select_member on public.conversations for select to authenticated
using (private.is_conversation_member(id, (select auth.uid())));
create policy conversation_members_select_member on public.conversation_members for select to authenticated
using (private.is_conversation_member(conversation_id, (select auth.uid())));
create policy direct_messages_select_member on public.direct_messages for select to authenticated
using (private.is_conversation_member(conversation_id, (select auth.uid())));
create policy direct_messages_insert_member on public.direct_messages for insert to authenticated
with check (
  sender_id = (select auth.uid())
  and private.is_conversation_member(conversation_id, (select auth.uid()))
  and not exists (
    select 1 from public.conversations c
    where c.id = conversation_id and private.users_are_blocked(c.user1_id, c.user2_id)
  )
);

create policy notifications_select_own on public.notifications for select to authenticated
using ((select auth.uid()) = user_id);
create policy notifications_update_own on public.notifications for update to authenticated
using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy notifications_delete_own on public.notifications for delete to authenticated
using ((select auth.uid()) = user_id);

revoke all on public.profiles, public.follows, public.profile_likes, public.matches,
  public.blocks, public.reports, public.conversations, public.conversation_members,
  public.direct_messages, public.notifications from anon;

grant select on public.profiles to authenticated;
grant update (username, display_name, bio, birth_date, city, avatar_path, dating_enabled, is_private, last_active_at)
  on public.profiles to authenticated;
grant select, insert, delete on public.follows, public.profile_likes, public.blocks to authenticated;
grant select on public.matches, public.conversations, public.conversation_members to authenticated;
grant insert on public.reports to authenticated;
grant select, insert on public.direct_messages to authenticated;
grant select, update (read_at), delete on public.notifications to authenticated;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 153600, array['image/webp','image/jpeg','image/png'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy avatars_insert_own on storage.objects for insert to authenticated
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
  and owner_id = (select auth.uid()::text)
);
create policy avatars_select_own on storage.objects for select to authenticated
using (bucket_id = 'avatars' and owner_id = (select auth.uid()::text));
create policy avatars_update_own on storage.objects for update to authenticated
using (bucket_id = 'avatars' and owner_id = (select auth.uid()::text))
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
  and owner_id = (select auth.uid()::text)
);
create policy avatars_delete_own on storage.objects for delete to authenticated
using (bucket_id = 'avatars' and owner_id = (select auth.uid()::text));

create policy dm_realtime_read on realtime.messages for select to authenticated
using (
  extension in ('broadcast', 'presence')
  and split_part((select realtime.topic()), ':', 1) = 'dm'
  and private.is_conversation_member(
    split_part((select realtime.topic()), ':', 2)::uuid,
    (select auth.uid())
  )
);
create policy dm_realtime_write on realtime.messages for insert to authenticated
with check (
  extension in ('broadcast', 'presence')
  and split_part((select realtime.topic()), ':', 1) = 'dm'
  and private.is_conversation_member(
    split_part((select realtime.topic()), ':', 2)::uuid,
    (select auth.uid())
  )
);

do $$
declare v_job_id bigint;
begin
  select jobid into v_job_id from cron.job where jobname = 'cleanup-nitra-space-social';
  if v_job_id is not null then perform cron.unschedule(v_job_id); end if;
  perform cron.schedule(
    'cleanup-nitra-space-social',
    '17 * * * *',
    'select public.cleanup_expired_social_data();'
  );
end;
$$;

