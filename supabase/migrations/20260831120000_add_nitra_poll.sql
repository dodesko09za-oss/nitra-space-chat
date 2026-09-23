create schema if not exists private;

create table if not exists public.nitra_polls (
  id text primary key,
  question text not null check (char_length(question) between 4 and 180),
  options jsonb not null check (jsonb_typeof(options) = 'array' and jsonb_array_length(options) between 2 and 6),
  active boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists private.nitra_poll_votes (
  poll_id text not null references public.nitra_polls(id) on delete cascade,
  voter_id uuid not null,
  option_id text not null,
  created_at timestamptz not null default now(),
  primary key (poll_id, voter_id)
);

alter table public.nitra_polls enable row level security;
alter table private.nitra_poll_votes enable row level security;

revoke all on public.nitra_polls from anon, authenticated;
revoke all on private.nitra_poll_votes from anon, authenticated;

insert into public.nitra_polls (id, question, options, active)
values (
  'nitra-space-direction-2026',
  'Čo by si chcel v Nitra Space používať najviac?',
  '[{"id":"events","label":"Eventy v Nitre"},{"id":"people","label":"Spoznávanie ľudí"},{"id":"wall","label":"Mestská nástenka"},{"id":"chat","label":"Anonymný chat"}]'::jsonb,
  true
)
on conflict (id) do update set
  question = excluded.question,
  options = excluded.options,
  active = excluded.active;

create or replace function public.get_active_nitra_poll(p_voter_id uuid default null)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, private
as $$
  with active_poll as (
    select p.id, p.question, p.options
    from public.nitra_polls p
    where p.active
    order by p.created_at desc
    limit 1
  ), counts as (
    select v.poll_id, v.option_id, count(*)::integer as votes
    from private.nitra_poll_votes v
    join active_poll p on p.id = v.poll_id
    group by v.poll_id, v.option_id
  )
  select jsonb_build_object(
    'id', p.id,
    'question', p.question,
    'options', (
      select jsonb_agg(option_item || jsonb_build_object('votes', coalesce(c.votes, 0)) order by option_order)
      from jsonb_array_elements(p.options) with ordinality as items(option_item, option_order)
      left join counts c on c.poll_id = p.id and c.option_id = option_item->>'id'
    ),
    'total_votes', (select count(*) from private.nitra_poll_votes v where v.poll_id = p.id),
    'selected_option', (
      select v.option_id from private.nitra_poll_votes v
      where v.poll_id = p.id and v.voter_id = p_voter_id
      limit 1
    )
  )
  from active_poll p;
$$;

create or replace function public.vote_nitra_poll(p_poll_id text, p_option_id text, p_voter_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  option_exists boolean;
begin
  if p_poll_id is null or p_option_id is null or p_voter_id is null then
    raise exception 'Neplatný hlas.';
  end if;

  select exists (
    select 1
    from public.nitra_polls p,
      jsonb_array_elements(p.options) option_item
    where p.id = p_poll_id
      and p.active
      and option_item->>'id' = p_option_id
  ) into option_exists;

  if not option_exists then
    raise exception 'Anketa alebo možnosť už nie je aktívna.';
  end if;

  insert into private.nitra_poll_votes (poll_id, voter_id, option_id)
  values (p_poll_id, p_voter_id, p_option_id)
  on conflict (poll_id, voter_id) do nothing;

  return public.get_active_nitra_poll(p_voter_id);
end;
$$;

revoke execute on function public.get_active_nitra_poll(uuid) from public;
revoke execute on function public.vote_nitra_poll(text, text, uuid) from public;
grant execute on function public.get_active_nitra_poll(uuid) to anon, authenticated;
grant execute on function public.vote_nitra_poll(text, text, uuid) to anon, authenticated;

