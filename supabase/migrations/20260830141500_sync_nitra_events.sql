create schema if not exists private;

create table if not exists public.nitra_events (
  id uuid primary key default gen_random_uuid(),
  organizer text not null check (char_length(organizer) between 1 and 80),
  title text not null check (char_length(title) between 1 and 70),
  performer text not null check (char_length(performer) between 1 and 120),
  event_date timestamptz not null,
  place text not null check (char_length(place) between 1 and 80),
  link text not null default '' check (char_length(link) <= 500),
  image_data text not null default '' check (char_length(image_data) <= 2000000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.nitra_events enable row level security;

revoke all on table public.nitra_events from public, anon, authenticated;
grant select on table public.nitra_events to anon, authenticated;

drop policy if exists "Public can read Nitra events" on public.nitra_events;
create policy "Public can read Nitra events"
on public.nitra_events
for select
to anon, authenticated
using (true);

create table if not exists private.nitra_event_admin (
  singleton boolean primary key default true check (singleton),
  password_hash text not null
);

revoke all on table private.nitra_event_admin from public, anon, authenticated;

insert into private.nitra_event_admin (singleton, password_hash)
values (true, 'a6c60fccaf9154e44aafeed3bd70ead686eaf25b30bd9efe61afa105722ebddd')
on conflict (singleton) do nothing;

create or replace function public.manage_nitra_event(
  p_password text,
  p_action text,
  p_event jsonb default '{}'::jsonb,
  p_event_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  expected_hash text;
  result_row public.nitra_events;
begin
  select password_hash into expected_hash
  from private.nitra_event_admin
  where singleton = true;

  if expected_hash is null
     or encode(extensions.digest(coalesce(p_password, ''), 'sha256'), 'hex') <> expected_hash then
    raise exception 'Nesprávne admin heslo.';
  end if;

  if p_action = 'insert' then
    insert into public.nitra_events (
      id, organizer, title, performer, event_date, place, link, image_data
    )
    values (
      coalesce(p_event_id, gen_random_uuid()),
      btrim(p_event->>'organizer'),
      btrim(p_event->>'title'),
      btrim(p_event->>'performer'),
      (p_event->>'event_date')::timestamptz,
      btrim(p_event->>'place'),
      coalesce(btrim(p_event->>'link'), ''),
      coalesce(p_event->>'image_data', '')
    )
    on conflict (id) do update
    set organizer = excluded.organizer,
        title = excluded.title,
        performer = excluded.performer,
        event_date = excluded.event_date,
        place = excluded.place,
        link = excluded.link,
        image_data = excluded.image_data,
        updated_at = now()
    returning * into result_row;
  elsif p_action = 'update' then
    if p_event_id is null then raise exception 'Chýba ID eventu.'; end if;
    update public.nitra_events
    set organizer = btrim(p_event->>'organizer'),
        title = btrim(p_event->>'title'),
        performer = btrim(p_event->>'performer'),
        event_date = (p_event->>'event_date')::timestamptz,
        place = btrim(p_event->>'place'),
        link = coalesce(btrim(p_event->>'link'), ''),
        image_data = coalesce(p_event->>'image_data', ''),
        updated_at = now()
    where id = p_event_id
    returning * into result_row;
    if result_row.id is null then raise exception 'Event sa nenašiel.'; end if;
  elsif p_action = 'delete' then
    if p_event_id is null then raise exception 'Chýba ID eventu.'; end if;
    delete from public.nitra_events where id = p_event_id returning * into result_row;
    if result_row.id is null then raise exception 'Event sa nenašiel.'; end if;
  else
    raise exception 'Neplatná admin operácia.';
  end if;

  return to_jsonb(result_row);
end;
$$;

revoke all on function public.manage_nitra_event(text, text, jsonb, uuid) from public;
grant execute on function public.manage_nitra_event(text, text, jsonb, uuid) to anon, authenticated;

insert into public.nitra_events (
  id, organizer, title, performer, event_date, place, link, image_data
)
values (
  '00000000-0000-4000-8000-000000000001',
  'Student Events',
  'YOUNIVERSE Festival',
  'Line-up bude oznámený',
  '2026-10-23T00:00:00+02:00',
  'Agrokomplex, Nitra',
  'https://www.instagram.com/studentevents.sk/',
  ''
)
on conflict (id) do update
set organizer = excluded.organizer,
    title = excluded.title,
    performer = excluded.performer,
    event_date = excluded.event_date,
    place = excluded.place,
    link = excluded.link,
    updated_at = now();
