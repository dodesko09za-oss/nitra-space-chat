create table if not exists public.nitra_news_topics (
  id uuid primary key default gen_random_uuid(),
  label text not null check (char_length(btrim(label)) between 2 and 60),
  query text not null check (char_length(btrim(query)) between 2 and 120),
  scope text not null default 'global' check (scope in ('global', 'sk_cz', 'nitra')),
  enabled boolean not null default true,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists nitra_news_topics_query_unique
  on public.nitra_news_topics (lower(query));

alter table public.nitra_news_topics enable row level security;

revoke all on table public.nitra_news_topics from anon, authenticated;
grant select, insert, update, delete on table public.nitra_news_topics to authenticated;
grant all on table public.nitra_news_topics to service_role;

drop policy if exists "news topics are admin only" on public.nitra_news_topics;
create policy "news topics are admin only"
on public.nitra_news_topics
for all
to authenticated
using (
  private.is_admin((select auth.uid()))
  and not private.account_is_banned((select auth.uid()))
)
with check (
  private.is_admin((select auth.uid()))
  and not private.account_is_banned((select auth.uid()))
);

insert into public.nitra_news_topics (label, query, scope)
values
  ('Rap svet', 'rap', 'global'),
  ('Kanye West', 'Kanye West', 'global'),
  ('Playboi Carti', 'Playboi Carti', 'global'),
  ('SK/CZ rap', 'sk/cz rap', 'sk_cz')
on conflict do nothing;
