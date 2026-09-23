create extension if not exists postgis with schema extensions;

create table if not exists private.profile_geo_locations (
  user_id uuid primary key references auth.users(id) on delete cascade,
  location extensions.geography(point, 4326) not null,
  accuracy_meters double precision not null default 0
    check (accuracy_meters >= 0 and accuracy_meters <= 50000),
  updated_at timestamptz not null default now()
);

create index if not exists profile_geo_locations_location_idx
  on private.profile_geo_locations using gist (location);

alter table private.profile_geo_locations enable row level security;
revoke all on table private.profile_geo_locations from public, anon, authenticated;

create or replace function private.set_profile_gps(
  p_latitude double precision,
  p_longitude double precision,
  p_accuracy_meters double precision default 0
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_updated_at timestamptz := now();
begin
  if v_user_id is null then
    raise exception 'Musíš byť prihlásený.';
  end if;
  if private.account_is_banned(v_user_id) then
    raise exception 'Tento účet je zablokovaný.';
  end if;
  if p_latitude is null or p_latitude < -90 or p_latitude > 90 then
    raise exception 'Neplatná zemepisná šírka.';
  end if;
  if p_longitude is null or p_longitude < -180 or p_longitude > 180 then
    raise exception 'Neplatná zemepisná dĺžka.';
  end if;
  if coalesce(p_accuracy_meters, 0) < 0 or coalesce(p_accuracy_meters, 0) > 50000 then
    raise exception 'Neplatná presnosť polohy.';
  end if;

  insert into private.profile_geo_locations (user_id, location, accuracy_meters, updated_at)
  values (
    v_user_id,
    extensions.st_setsrid(extensions.st_makepoint(p_longitude, p_latitude), 4326)::extensions.geography,
    coalesce(p_accuracy_meters, 0),
    v_updated_at
  )
  on conflict (user_id) do update
    set location = excluded.location,
        accuracy_meters = excluded.accuracy_meters,
        updated_at = excluded.updated_at;

  return jsonb_build_object(
    'enabled', true,
    'accuracy_meters', round(coalesce(p_accuracy_meters, 0))::integer,
    'updated_at', v_updated_at
  );
end;
$$;

create or replace function private.clear_profile_gps()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Musíš byť prihlásený.';
  end if;
  delete from private.profile_geo_locations where user_id = auth.uid();
  return found;
end;
$$;

create or replace function private.my_gps_state()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when auth.uid() is null then jsonb_build_object('enabled', false)
    else coalesce(
      (select jsonb_build_object(
        'enabled', true,
        'accuracy_meters', round(g.accuracy_meters)::integer,
        'updated_at', g.updated_at
      ) from private.profile_geo_locations g where g.user_id = auth.uid()),
      jsonb_build_object('enabled', false)
    )
  end;
$$;

create or replace function private.discover_profiles_geo(p_mode text default 'suggested', p_limit integer default 20)
returns table (
  id uuid, username text, display_name text, bio text, age integer, avatar_path text,
  location_name text, is_private boolean, follow_state text, common_interests text[], distance_km integer
)
language sql
stable
security definer
set search_path = ''
as $$
  with me as (
    select p.location_id, g.location
    from public.profiles p
    left join private.profile_geo_locations g on g.user_id = p.id
    where p.id = auth.uid()
  ), candidates as (
    select p.*,
      coalesce((select count(*) from public.matching_profile_interests mine
        join public.matching_profile_interests theirs on theirs.interest_id = mine.interest_id
        where mine.user_id = auth.uid() and theirs.user_id = p.id), 0) common_count,
      case when p.location_id = (select location_id from me) then 0
        else coalesce((select ln.priority from public.location_neighbors ln
          where ln.source_id = (select location_id from me) and ln.target_id = p.location_id), 50) end location_rank,
      case when (select location from me) is not null and candidate_geo.location is not null
        then extensions.st_distance((select location from me), candidate_geo.location)
      end distance_meters
    from public.profiles p
    left join private.profile_geo_locations candidate_geo on candidate_geo.user_id = p.id
    where auth.uid() is not null and not private.account_is_banned(auth.uid())
      and p.id <> auth.uid() and p.deactivated_at is null
      and not private.account_is_banned(p.id)
      and not private.users_are_blocked(auth.uid(), p.id)
      and not exists(select 1 from public.follows f where f.follower_id = auth.uid() and f.following_id = p.id)
  )
  select c.id, c.username, c.display_name, c.bio,
    extract(year from age(current_date, c.birth_date))::integer, c.avatar_path,
    case when c.location_visible then l.display_name end, c.is_private,
    case when exists(select 1 from public.follow_requests fr where fr.requester_id = auth.uid() and fr.target_id = c.id) then 'requested' else 'none' end,
    array(select i.display_name from public.matching_profile_interests mine
      join public.matching_profile_interests theirs on theirs.interest_id = mine.interest_id
      join public.interests i on i.id = mine.interest_id
      where mine.user_id = auth.uid() and theirs.user_id = c.id order by i.sort_order limit 2),
    case when c.distance_meters is not null then greatest(1, ceil(c.distance_meters / 1000.0)::integer) end
  from candidates c
  left join public.locations l on l.id = c.location_id
  order by
    case when p_mode = 'nearby' then (c.distance_meters is null)::integer else 0 end,
    case when p_mode = 'nearby' then c.distance_meters end,
    case when p_mode = 'nearby' then c.location_rank else 0 end,
    case when p_mode = 'suggested' then c.common_count else 0 end desc,
    case when p_mode = 'new' then c.created_at end desc,
    c.last_active_at desc nulls last, c.created_at desc
  limit least(greatest(coalesce(p_limit, 20), 1), 30);
$$;

create or replace function public.set_profile_gps(
  p_latitude double precision,
  p_longitude double precision,
  p_accuracy_meters double precision default 0
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$ select private.set_profile_gps(p_latitude, p_longitude, p_accuracy_meters); $$;

create or replace function public.clear_profile_gps()
returns boolean
language sql
security invoker
set search_path = ''
as $$ select private.clear_profile_gps(); $$;

create or replace function public.my_gps_state()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$ select private.my_gps_state(); $$;

create or replace function public.discover_profiles_geo(p_mode text default 'suggested', p_limit integer default 20)
returns table (
  id uuid, username text, display_name text, bio text, age integer, avatar_path text,
  location_name text, is_private boolean, follow_state text, common_interests text[], distance_km integer
)
language sql
stable
security invoker
set search_path = ''
as $$ select * from private.discover_profiles_geo(p_mode, p_limit); $$;

revoke all on function private.set_profile_gps(double precision, double precision, double precision),
  private.clear_profile_gps(), private.my_gps_state(), private.discover_profiles_geo(text, integer)
  from public, anon;
grant execute on function private.set_profile_gps(double precision, double precision, double precision),
  private.clear_profile_gps(), private.my_gps_state(), private.discover_profiles_geo(text, integer)
  to authenticated;

revoke all on function public.set_profile_gps(double precision, double precision, double precision),
  public.clear_profile_gps(), public.my_gps_state(), public.discover_profiles_geo(text, integer)
  from public, anon;
grant execute on function public.set_profile_gps(double precision, double precision, double precision),
  public.clear_profile_gps(), public.my_gps_state(), public.discover_profiles_geo(text, integer)
  to authenticated;
