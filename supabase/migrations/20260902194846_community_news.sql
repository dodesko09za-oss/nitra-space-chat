-- Recorded through Supabase migration API (CLI unavailable). Existing chat is untouched.
begin;
create table public.nitra_news_sources (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 120),
  endpoint text not null unique check (endpoint ~ '^https://'),
  adapter text not null default 'json' check (adapter in ('json','rss')),
  approved boolean not null default false,
  license_notes text not null default '',
  created_at timestamptz not null default now()
);
create table public.nitra_news (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) <= 180),
  headline text not null check (length(trim(headline)) between 5 and 180),
  summary text not null default '' check (length(summary) <= 600),
  content text not null default '' check (length(content) <= 40000),
  cover_image_url text,
  image_rights text not null default 'fallback' check (image_rights in ('fallback','owned','licensed','official')),
  image_credit text not null default '' check (length(image_credit) <= 500),
  source_name text not null check (length(source_name) between 1 and 120),
  source_url text not null check (source_url ~ '^https://'),
  source_id uuid references public.nitra_news_sources(id) on delete set null,
  fingerprint text unique,
  category text not null default 'Mesto' check (length(category) between 1 and 60),
  status text not null default 'draft' check (status in ('draft','published','rejected')),
  breaking boolean not null default false,
  manual_review_required boolean not null default true,
  ai_generated boolean not null default false,
  visual_headline text not null default '' check (length(visual_headline) <= 140),
  card_version integer not null default 1,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint news_published_valid check (status <> 'published' or (published_at is not null and length(trim(content)) >= 20)),
  constraint news_image_rights check (cover_image_url is null or (cover_image_url ~ '^https://' and image_rights <> 'fallback' and length(trim(image_credit)) > 0))
);
create index nitra_news_feed_idx on public.nitra_news(published_at desc, id desc) where status='published';
create index nitra_news_admin_idx on public.nitra_news(status, created_at desc);
create index nitra_news_source_idx on public.nitra_news(source_id);
create unique index nitra_news_source_url_idx on public.nitra_news(source_url);
alter table public.nitra_news enable row level security;
alter table public.nitra_news_sources enable row level security;
revoke all on public.nitra_news, public.nitra_news_sources from anon, authenticated;
grant select on public.nitra_news to anon, authenticated;
grant insert, update, delete on public.nitra_news to authenticated;
grant select, insert, update, delete on public.nitra_news_sources to authenticated;
grant all on public.nitra_news, public.nitra_news_sources to service_role;
create policy news_public_read on public.nitra_news for select to anon, authenticated using (status='published' and published_at <= now());
create policy news_admin on public.nitra_news for all to authenticated using (private.is_admin((select auth.uid())) and not private.account_is_banned((select auth.uid()))) with check (private.is_admin((select auth.uid())) and not private.account_is_banned((select auth.uid())));
create policy news_sources_admin on public.nitra_news_sources for all to authenticated using (private.is_admin((select auth.uid()))) with check (private.is_admin((select auth.uid())));
create function private.prepare_news() returns trigger language plpgsql security invoker set search_path='' as $$
begin
  new.updated_at := now();
  if new.status='published' then
    if auth.uid() is null or not private.is_admin(auth.uid()) or private.account_is_banned(auth.uid()) then
      raise exception 'Manual editor approval required' using errcode='42501';
    end if;
    new.published_at := coalesce(new.published_at,now());
  end if;
  return new;
end;
$$;
revoke all on function private.prepare_news() from public,anon,authenticated;
create trigger news_prepare before insert or update on public.nitra_news for each row execute function private.prepare_news();
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('news-images','news-images',true,5242880,array['image/jpeg','image/png','image/webp']) on conflict(id) do nothing;
create policy news_images_read on storage.objects for select to anon,authenticated using(bucket_id='news-images');
create policy news_images_admin_insert on storage.objects for insert to authenticated with check(bucket_id='news-images' and private.is_admin((select auth.uid())) and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy news_images_admin_delete on storage.objects for delete to authenticated using(bucket_id='news-images' and private.is_admin((select auth.uid())));
commit;
