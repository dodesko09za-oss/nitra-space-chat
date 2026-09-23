create table public.matching_passes (
  user_id uuid not null references public.profiles(id) on delete cascade,
  target_user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, target_user_id),
  constraint matching_passes_not_self check (user_id <> target_user_id)
);

create index matching_passes_target_idx on public.matching_passes(target_user_id);
alter table public.matching_passes enable row level security;
revoke all on public.matching_passes from public, anon, authenticated;

create or replace function private.matching_decide(p_target uuid, p_like boolean)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_user1 uuid;
  v_user2 uuid;
begin
  if v_me is null or p_target is null or p_target = v_me
     or private.users_are_blocked(v_me, p_target)
     or not exists (
       select 1 from public.profiles p
       join public.matching_profiles mp on mp.user_id = p.id
       where p.id = p_target and p.deactivated_at is null and mp.matching_enabled
     )
     or not exists (
       select 1 from public.matching_profiles mp
       where mp.user_id = v_me and mp.matching_enabled
     ) then
    raise exception 'Matching decision is not allowed';
  end if;

  if p_like then
    delete from public.matching_passes where user_id = v_me and target_user_id = p_target;
    insert into public.profile_likes(from_user_id, to_user_id)
    values (v_me, p_target) on conflict do nothing;
    v_user1 := least(v_me, p_target);
    v_user2 := greatest(v_me, p_target);
    if exists (select 1 from public.matches where user1_id = v_user1 and user2_id = v_user2) then
      return 'match';
    end if;
    return 'liked';
  end if;

  insert into public.matching_passes(user_id, target_user_id)
  values (v_me, p_target) on conflict do nothing;
  return 'passed';
end;
$$;

create or replace function public.matching_decide(p_target uuid, p_like boolean)
returns text
language sql
volatile
security invoker
set search_path = ''
as $$ select private.matching_decide(p_target, p_like); $$;

revoke all on function private.matching_decide(uuid, boolean) from public, anon;
grant execute on function private.matching_decide(uuid, boolean) to authenticated;
revoke all on function public.matching_decide(uuid, boolean) from public, anon;
grant execute on function public.matching_decide(uuid, boolean) to authenticated;

create or replace function private.matching_feed(p_limit integer default 12)
returns jsonb
language sql stable security definer set search_path=''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',p.id,'username',p.username,'display_name',p.display_name,'age',extract(year from age(current_date,p.birth_date))::integer,
    'intro',mp.intro,'location_name',case when p.location_visible then l.display_name end,
    'photos',coalesce((select jsonb_agg(mph.storage_path order by mph.position) from public.matching_photos mph where mph.user_id=p.id),'[]'::jsonb),
    'interests',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'name',i.display_name) order by i.sort_order) from public.matching_profile_interests mpi join public.interests i on i.id=mpi.interest_id where mpi.user_id=p.id),'[]'::jsonb),
    'liked',false
  ) order by p.last_active_at desc nulls last),'[]'::jsonb)
  from (select p.* from public.profiles p join public.matching_profiles mp0 on mp0.user_id=p.id
    where auth.uid() is not null
      and exists(select 1 from public.matching_profiles mine where mine.user_id=auth.uid() and mine.matching_enabled)
      and p.id<>auth.uid() and p.deactivated_at is null and mp0.matching_enabled
      and not private.users_are_blocked(auth.uid(),p.id)
      and not exists(select 1 from public.profile_likes pl where pl.from_user_id=auth.uid() and pl.to_user_id=p.id)
      and not exists(select 1 from public.matching_passes ps where ps.user_id=auth.uid() and ps.target_user_id=p.id)
    order by p.last_active_at desc nulls last limit least(greatest(coalesce(p_limit,12),1),20)) p
  join public.matching_profiles mp on mp.user_id=p.id
  left join public.locations l on l.id=p.location_id;
$$;

