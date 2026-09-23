create table if not exists public.nitra_wall_posts (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 30),
  body text not null check (char_length(btrim(body)) between 1 and 180),
  created_at timestamptz not null default now()
);

alter table public.nitra_wall_posts enable row level security;

revoke all on table public.nitra_wall_posts from public, anon, authenticated;
grant select, insert on table public.nitra_wall_posts to anon, authenticated;

drop policy if exists "Public can read Nitra wall posts" on public.nitra_wall_posts;
create policy "Public can read Nitra wall posts"
on public.nitra_wall_posts
for select
to anon, authenticated
using (true);

drop policy if exists "Public can create Nitra wall posts" on public.nitra_wall_posts;
create policy "Public can create Nitra wall posts"
on public.nitra_wall_posts
for insert
to anon, authenticated
with check (
  char_length(btrim(name)) between 1 and 30
  and char_length(btrim(body)) between 1 and 180
);

create or replace function public.delete_nitra_wall_post(
  p_password text,
  p_post_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  expected_hash text;
  deleted_id uuid;
begin
  select password_hash into expected_hash
  from private.nitra_event_admin
  where singleton = true;

  if expected_hash is null
     or encode(extensions.digest(coalesce(p_password, ''), 'sha256'), 'hex') <> expected_hash then
    raise exception 'Nesprávne admin heslo.';
  end if;

  delete from public.nitra_wall_posts
  where id = p_post_id
  returning id into deleted_id;

  if deleted_id is null then
    raise exception 'Odkaz sa nenašiel.';
  end if;

  return deleted_id;
end;
$$;

revoke all on function public.delete_nitra_wall_post(text, uuid) from public;
grant execute on function public.delete_nitra_wall_post(text, uuid) to anon, authenticated;
