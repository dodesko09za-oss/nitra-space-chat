alter table public.nitra_news_automation add column auto_publish boolean not null default false,
 add column max_ai_per_run integer not null default 2 check(max_ai_per_run between 1 and 10);
alter table public.nitra_news_sources add column website_url text check(website_url is null or website_url ~ '^https://'),
 add column priority integer not null default 0;
alter table public.nitra_news add column cover_template text not null default 'auto' check(cover_template in ('auto','left','center','bottom','number','asymmetric')),
 add column cover_chrome boolean not null default true,
 add column cover_headline text not null default '' check(length(cover_headline)<=180),
 add column cover_number integer not null default 1 check(cover_number between 1 and 9999),
 add column fact_sheet jsonb not null default '{}',
 add column generation_error text,
 add column topic_id uuid references public.nitra_news_topics(id) on delete set null;
create index news_topic_idx on public.nitra_news(topic_id);
-- No arbitrary limit on topic keyword text; UI paginates topics instead.
alter table public.nitra_news_topics drop constraint if exists nitra_news_topics_query_check;
alter table public.nitra_news_topics add constraint nitra_news_topics_query_check check(length(query) between 1 and 8000);
create table public.nitra_news_source_items (
 id uuid primary key default gen_random_uuid(),source_id uuid not null references public.nitra_news_sources(id) on delete cascade,
 source_article_id text,canonical_url text not null check(canonical_url ~ '^https://'),
 title text not null,excerpt text not null default '',published_at timestamptz not null,
 article_id uuid references public.nitra_news(id) on delete set null,
 created_at timestamptz not null default now(),unique(source_id,canonical_url),unique(source_id,source_article_id)
);
create index news_source_items_article_idx on public.nitra_news_source_items(article_id);
create index news_source_items_time_idx on public.nitra_news_source_items(published_at desc);
create table public.nitra_news_article_sources (
 article_id uuid not null references public.nitra_news(id) on delete cascade,
 item_id uuid not null references public.nitra_news_source_items(id) on delete cascade,
 primary key(article_id,item_id)
);
create index news_article_sources_item_idx on public.nitra_news_article_sources(item_id);
create table public.nitra_news_generations (
 id uuid primary key default gen_random_uuid(),article_id uuid references public.nitra_news(id) on delete set null,
 actor_id uuid references auth.users(id) on delete set null,
 action text not null, model text not null, status text not null default 'processing' check(status in ('processing','complete','failed')),
 input_hash text not null, input jsonb not null, output jsonb, fact_sheet jsonb,
 verified boolean not null default false, sensitive boolean not null default true,
 usage jsonb not null default '[]',estimated_cost_usd numeric, error text,
 created_at timestamptz not null default now(),finished_at timestamptz
);
create index news_generation_article_idx on public.nitra_news_generations(article_id,created_at desc);
create index news_generation_actor_idx on public.nitra_news_generations(actor_id);
create index news_generation_cache_idx on public.nitra_news_generations(input_hash) where status='complete';
create unique index news_one_generation_at_a_time on public.nitra_news_generations(article_id) where status='processing';
do $$ declare t text;begin
 foreach t in array array['nitra_news_source_items','nitra_news_article_sources'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from anon,authenticated',t);
  execute format('grant select,insert,update,delete on public.%I to authenticated',t);
  execute format('create policy news_admin on public.%I for all to authenticated using ((select private.is_admin(auth.uid()) and not private.account_is_banned(auth.uid()))) with check ((select private.is_admin(auth.uid()) and not private.account_is_banned(auth.uid())))',t);
 end loop;
end $$;
alter table public.nitra_news_generations enable row level security;
revoke all on public.nitra_news_generations from anon,authenticated;
grant select on public.nitra_news_generations to authenticated;
create policy generations_admin_read on public.nitra_news_generations for select to authenticated using((select private.is_admin(auth.uid()) and not private.account_is_banned(auth.uid())));
-- The trusted worker's attestation is not writable by frontend/admin CRUD.
create table private.news_publish_permits(article_id uuid primary key,transaction_id bigint not null);
revoke all on private.news_publish_permits from public,anon,authenticated,service_role;
alter table private.news_publish_permits enable row level security;
create or replace function private.prepare_news() returns trigger language plpgsql security invoker set search_path='' as $$
declare worker_allowed boolean:=false;
begin
 new.updated_at:=now();
 if new.status in ('published','scheduled') then
  if current_user='postgres' then
   select exists(select 1 from private.news_publish_permits where article_id=new.id and transaction_id=txid_current()) into worker_allowed;
  end if;
  if auth.uid() is not null and private.is_admin(auth.uid()) and not private.account_is_banned(auth.uid()) then new.reviewed_by:=auth.uid();
  elsif worker_allowed then null;
  elsif current_user='postgres' and tg_op='UPDATE' and old.status='scheduled' and new.status='published'
    and old.scheduled_at<=now() and private.is_admin(old.reviewed_by) and not private.account_is_banned(old.reviewed_by)
    and (to_jsonb(new)-array['status','published_at','updated_at'])=(to_jsonb(old)-array['status','published_at','updated_at']) then null;
  else raise exception 'Editor approval required' using errcode='42501'; end if;
  if new.manual_review_required or length(btrim(new.summary))<80 or length(btrim(new.content))<250
   or concat_ws(' ',new.summary,new.content) ~* '(návrh (čaká|vznikol)|pred publikovaním|pred vydaním|dodatočné redakčné overenie)'
   or (new.cover_image_url is not null and new.image_rights='source_unverified') then raise exception 'Complete editorial and image rights review before publication' using errcode='23514'; end if;
  if new.status='scheduled' and (new.scheduled_at is null or new.scheduled_at<=now()) then raise exception 'Choose a future publication time' using errcode='23514'; end if;
  if new.status='published' then new.published_at:=coalesce(new.published_at,now()); end if;
 end if;
 return new;
end $$;
create function private.news_publish_generated(p_article uuid,p_generation uuid) returns boolean language plpgsql security definer set search_path='' as $$
declare a public.nitra_news;g public.nitra_news_generations;
begin
 select * into a from public.nitra_news where id=p_article for update;
 select * into g from public.nitra_news_generations where id=p_generation and article_id=p_article;
 if a.id is null or g.id is null or a.status not in ('draft','review') or not g.verified or g.sensitive or a.sensitive or g.status<>'complete'
  or a.headline is distinct from g.output->>'headline' or a.summary is distinct from g.output->>'summary' or a.content is distinct from g.output->>'content'
  or coalesce(jsonb_array_length(g.fact_sheet->'unknown'),1)>0
  or not exists(select 1 from public.nitra_news_automation where not paused and auto_publish)
  or not exists(select 1 from public.nitra_news_sources where id=a.source_id and approved and enabled and trust_level='official' and mode='safe_publish')
  or not exists(select 1 from public.nitra_news_topics where id=a.topic_id and enabled and mode='safe_publish')
  then return false; end if;
 insert into private.news_publish_permits values(a.id,txid_current());
 update public.nitra_news set status='published',published_at=now(),manual_review_required=false where id=a.id;
 delete from private.news_publish_permits where article_id=a.id;
 return true;
end $$;
create function public.news_publish_generated(p_article uuid,p_generation uuid) returns boolean language sql security invoker set search_path='' as $$select private.news_publish_generated(p_article,p_generation)$$;
revoke all on function private.news_publish_generated(uuid,uuid),public.news_publish_generated(uuid,uuid) from public,anon,authenticated;
grant execute on function private.news_publish_generated(uuid,uuid),public.news_publish_generated(uuid,uuid) to service_role;
grant usage on schema private to service_role;
