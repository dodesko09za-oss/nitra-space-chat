-- Connect the notifications design to the existing request system and allow
-- users to contribute a location name without exposing direct INSERT access.

alter table public.locations
  add column if not exists normalized_name text;

update public.locations
set normalized_name = lower(regexp_replace(btrim(display_name), '[[:space:]]+', ' ', 'g'))
where normalized_name is null;

alter table public.locations
  alter column normalized_name set not null,
  alter column sort_order set default 1000;

create unique index if not exists locations_normalized_name_idx
  on public.locations(normalized_name);

create or replace function private.set_profile_location(p_location_name text, p_visible boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_name text := regexp_replace(btrim(coalesce(p_location_name, '')), '[[:space:]]+', ' ', 'g');
  v_normalized text;
  v_location_id text;
  v_display_name text;
begin
  if v_me is null then raise exception 'Authentication required'; end if;
  if char_length(v_name) not between 2 and 60 or v_name ~ '[[:cntrl:]]' then
    raise exception 'Location must contain between 2 and 60 valid characters';
  end if;

  v_normalized := lower(v_name);
  insert into public.locations(id, display_name, normalized_name, sort_order, active)
  values ('loc_' || substr(md5(v_normalized), 1, 24), v_name, v_normalized, 1000, true)
  on conflict (normalized_name) do update set active = true
  returning id, display_name into v_location_id, v_display_name;

  update public.profiles
  set location_id = v_location_id, location_visible = coalesce(p_visible, false)
  where id = v_me;

  return jsonb_build_object('id', v_location_id, 'display_name', v_display_name);
end;
$$;

-- One current request notification per sender/recipient/type. A repeated
-- request makes the existing notification unread instead of creating spam.
with ranked as (
  select id, row_number() over (
    partition by user_id, actor_id, type order by created_at desc, id desc
  ) as position
  from public.notifications
  where type in ('follow_request', 'connection_request')
)
delete from public.notifications n
using ranked r
where n.id = r.id and r.position > 1;

create unique index if not exists notifications_pending_request_idx
  on public.notifications(user_id, actor_id, type)
  where type in ('follow_request', 'connection_request');

create or replace function private.handle_follow_request_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.notifications(user_id, actor_id, type, read_at, created_at)
  values (new.target_id, new.requester_id, 'follow_request', null, now())
  on conflict (user_id, actor_id, type) where type in ('follow_request', 'connection_request')
  do update set read_at = null, created_at = excluded.created_at;
  return new;
end;
$$;

drop trigger if exists follow_requests_notify on public.follow_requests;
create trigger follow_requests_notify
after insert or update on public.follow_requests
for each row execute function private.handle_follow_request_notification();

create or replace function private.handle_connection_request_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.notifications(user_id, actor_id, type, read_at, created_at)
  values (new.target_id, new.requester_id, 'connection_request', null, now())
  on conflict (user_id, actor_id, type) where type in ('follow_request', 'connection_request')
  do update set read_at = null, created_at = excluded.created_at;
  return new;
end;
$$;

drop trigger if exists connection_requests_notify on public.connection_requests;
create trigger connection_requests_notify
after insert or update on public.connection_requests
for each row execute function private.handle_connection_request_notification();

create or replace function private.respond_follow_request(p_requester uuid, p_accept boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_me uuid := auth.uid();
begin
  if v_me is null or not exists(
    select 1 from public.follow_requests where requester_id=p_requester and target_id=v_me
  ) then raise exception 'Follow request not found'; end if;

  delete from public.follow_requests where requester_id=p_requester and target_id=v_me;
  update public.notifications set read_at=coalesce(read_at,now())
  where user_id=v_me and actor_id=p_requester and type='follow_request';

  if p_accept and not private.users_are_blocked(v_me,p_requester) then
    insert into public.follows(follower_id,following_id) values(p_requester,v_me) on conflict do nothing;
    insert into public.notifications(user_id,actor_id,type)
    values(p_requester,v_me,'follow');
  end if;
end;
$$;

create or replace function private.respond_connection_request(p_requester uuid, p_accept boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_me uuid:=auth.uid(); v_user1 uuid; v_user2 uuid; v_id uuid;
begin
  if v_me is null or not exists(
    select 1 from public.connection_requests where requester_id=p_requester and target_id=v_me
  ) then raise exception 'Connection request not found'; end if;

  delete from public.connection_requests where requester_id=p_requester and target_id=v_me;
  update public.notifications set read_at=coalesce(read_at,now())
  where user_id=v_me and actor_id=p_requester and type='connection_request';

  if p_accept and not private.users_are_blocked(v_me,p_requester) then
    v_user1:=least(v_me,p_requester); v_user2:=greatest(v_me,p_requester);
    insert into public.connections(user1_id,user2_id) values(v_user1,v_user2)
    on conflict(user1_id,user2_id) do update set user1_id=excluded.user1_id
    returning id into v_id;
    insert into public.notifications(user_id,actor_id,type,entity_id)
    values(p_requester,v_me,'connection',v_id);
  end if;
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

create or replace function public.set_profile_location(p_location_name text, p_visible boolean default true)
returns jsonb language sql volatile security invoker set search_path=''
as $$ select private.set_profile_location(p_location_name,p_visible); $$;

create or replace function public.social_notifications(p_limit integer default 50)
returns jsonb language sql stable security invoker set search_path=''
as $$ select private.social_notifications(p_limit); $$;

revoke all on function private.set_profile_location(text,boolean),private.social_notifications(integer) from public,anon;
grant execute on function private.set_profile_location(text,boolean),private.social_notifications(integer) to authenticated;
revoke all on function public.set_profile_location(text,boolean),public.social_notifications(integer) from public,anon;
grant execute on function public.set_profile_location(text,boolean),public.social_notifications(integer) to authenticated;

do $$
begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime')
     and not exists(
       select 1 from pg_publication_tables
       where pubname='supabase_realtime' and schemaname='public' and tablename='notifications'
     ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;
