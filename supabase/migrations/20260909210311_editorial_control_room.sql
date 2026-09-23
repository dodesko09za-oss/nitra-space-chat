-- Additive editorial controls; existing articles and source records stay intact.
create table public.nitra_news_categories (
 id uuid primary key default gen_random_uuid(), name text not null unique check(length(name) between 1 and 60),
 slug text not null unique check(slug ~ '^[a-z0-9-]+$'), sort_order integer not null default 0, enabled boolean not null default true
);
insert into public.nitra_news_categories(name,slug,sort_order) values
 ('Mesto','mesto',1),('Kultúra','kultura',2),('Školy','skoly',3),('Nightlife','nightlife',4),('Šport','sport',5),('Ľudia','ludia',6),('Doprava','doprava',7),('Bezpečnosť','bezpecnost',8);
alter table public.nitra_news
 add column subheadline text not null default '' check(length(subheadline)<=300),
 add column cover_image_alt text not null default '' check(length(cover_image_alt)<=300),
 add column category_id uuid references public.nitra_news_categories(id) on delete set null,
 add column source_published_at timestamptz,
 add column scheduled_at timestamptz,
 add column featured boolean not null default false,
 add column layout text not null default 'standard' check(layout in ('standard','featured','compact','breaking')),
 add column tags text[] not null default '{}' check(cardinality(tags)<=12),
 add column seo_title text not null default '' check(length(seo_title)<=180),
 add column seo_description text not null default '' check(length(seo_description)<=600),
 add column social_title text not null default '' check(length(social_title)<=180),
 add column social_description text not null default '' check(length(social_description)<=600),
 add column additional_images jsonb not null default '[]' check(jsonb_typeof(additional_images)='array'),
 add column source_facts jsonb not null default '[]' check(jsonb_typeof(source_facts)='array'),
 add column related_sources jsonb not null default '[]' check(jsonb_typeof(related_sources)='array'),
 add column created_by uuid references auth.users(id) on delete set null default auth.uid(),
 add column reviewed_by uuid references auth.users(id) on delete set null,
 add column sensitive boolean not null default false;
alter table public.nitra_news drop constraint nitra_news_status_check;
alter table public.nitra_news add constraint nitra_news_status_check check(status in ('discovered','processing','draft','review','scheduled','published','rejected','archived','failed'));
create index news_category_page_idx on public.nitra_news(category_id,published_at desc,id desc) where status='published';
create index news_schedule_idx on public.nitra_news(scheduled_at) where status='scheduled';
create index news_created_by_idx on public.nitra_news(created_by);
create index news_reviewed_by_idx on public.nitra_news(reviewed_by);
alter table public.nitra_news_sources
 add column enabled boolean not null default false,
 add column trust_level text not null default 'standard' check(trust_level in ('standard','official')),
 add column category_id uuid references public.nitra_news_categories(id) on delete set null,
 add column frequency_minutes integer not null default 60 check(frequency_minutes between 15 and 10080),
 add column mode text not null default 'draft' check(mode in ('discover','draft','notify','safe_publish')),
 add column last_checked_at timestamptz, add column last_success_at timestamptz,
 add column last_error text, add column discovered_count integer not null default 0;
alter table public.nitra_news_sources drop constraint nitra_news_sources_adapter_check;
alter table public.nitra_news_sources add constraint nitra_news_sources_adapter_check check(adapter in ('json','rss','atom'));
alter table public.nitra_news_topics
 add column required_keywords text[] not null default '{}',
 add column excluded_keywords text[] not null default '{}',
 add column source_filters uuid[] not null default '{}',
 add column category_id uuid references public.nitra_news_categories(id) on delete set null,
 add column priority integer not null default 0,
 add column mode text not null default 'draft' check(mode in ('discover','draft','notify','safe_publish'));
create index news_source_category_idx on public.nitra_news_sources(category_id);
create index news_topic_category_idx on public.nitra_news_topics(category_id);
create table public.nitra_news_keywords (
 id uuid primary key default gen_random_uuid(), topic_id uuid not null references public.nitra_news_topics(id) on delete cascade,
 term text not null check(length(term) between 1 and 120), kind text not null check(kind in ('include','required','exclude')),unique(topic_id,term,kind)
);
create table public.nitra_news_automation (
 id boolean primary key default true check(id), paused boolean not null default true, updated_at timestamptz not null default now()
);
insert into public.nitra_news_automation(id) values(true);
create table public.nitra_news_ingestion_runs (
 id uuid primary key default gen_random_uuid(), source_id uuid references public.nitra_news_sources(id) on delete set null,
 started_at timestamptz not null default now(), finished_at timestamptz, actor_id uuid references auth.users(id) on delete set null default auth.uid(),
 status text not null default 'running' check(status in ('running','completed','failed','skipped')),
 checked integer not null default 0, drafts integer not null default 0, duplicates integer not null default 0,
 error text check(length(error)<=1000), report jsonb not null default '{}'
);
create index news_runs_time_idx on public.nitra_news_ingestion_runs(started_at desc);
create index news_runs_source_idx on public.nitra_news_ingestion_runs(source_id);
create index news_runs_actor_idx on public.nitra_news_ingestion_runs(actor_id);
create table public.nitra_news_media (
 id uuid primary key default gen_random_uuid(), url text not null check(url ~ '^https://'), storage_path text,
 alt text not null default '', credit text not null check(length(credit)>0),
 rights text not null check(rights in ('owned','licensed','official')), original_url text, license_notes text not null default '',
 created_by uuid references auth.users(id) on delete set null default auth.uid(),created_at timestamptz not null default now()
);
create index news_media_owner_idx on public.nitra_news_media(created_by);
create table public.nitra_news_revisions (
 id bigint generated always as identity primary key, article_id uuid, actor_id uuid references auth.users(id) on delete set null,
 created_at timestamptz not null default now(), operation text not null, snapshot jsonb not null
);
create index news_revision_article_idx on public.nitra_news_revisions(article_id,created_at desc);
create index news_revision_actor_idx on public.nitra_news_revisions(actor_id);
do $$ declare t text; begin
 foreach t in array array['nitra_news_categories','nitra_news_keywords','nitra_news_automation','nitra_news_ingestion_runs','nitra_news_media','nitra_news_revisions'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from anon,authenticated',t);
  execute format('grant select,insert,update,delete on public.%I to authenticated',t);
  execute format('create policy editorial_admin on public.%I for all to authenticated using ((select private.is_admin(auth.uid()) and not private.account_is_banned(auth.uid()))) with check ((select private.is_admin(auth.uid()) and not private.account_is_banned(auth.uid())))',t);
 end loop;
end $$;
grant select on public.nitra_news_categories to anon;
create policy categories_public on public.nitra_news_categories for select to anon,authenticated using(enabled);
-- Audit records are append-only, even to editors. Trigger alone appends them.
revoke insert,update,delete on public.nitra_news_revisions from authenticated;
create function private.audit_news() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.nitra_news_revisions(article_id,actor_id,operation,snapshot)
 values(case when tg_op='DELETE' then old.id else new.id end, auth.uid(),tg_op,case when tg_op='INSERT' then to_jsonb(new) else to_jsonb(old) end);
 return null;
end $$;
revoke all on function private.audit_news() from public,anon,authenticated;
create trigger news_audit after insert or update or delete on public.nitra_news for each row execute function private.audit_news();
-- Scheduling still requires an authenticated editor's explicit review.
create or replace function private.prepare_news() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 new.updated_at:=now();
 if new.status in ('published','scheduled') then
  if auth.uid() is not null and private.is_admin(auth.uid()) and not private.account_is_banned(auth.uid()) then
   new.reviewed_by:=auth.uid();
  elsif current_user='postgres' and tg_op='UPDATE' and old.status='scheduled' and new.status='published'
    and old.scheduled_at<=now() and private.is_admin(old.reviewed_by) and not private.account_is_banned(old.reviewed_by)
    and (to_jsonb(new)-array['status','published_at','updated_at'])=(to_jsonb(old)-array['status','published_at','updated_at']) then
   null;
  else raise exception 'Editor approval required' using errcode='42501'; end if;
  if new.manual_review_required or length(btrim(new.summary))<80 or length(btrim(new.content))<250
   or concat_ws(' ',new.summary,new.content) ~* '(návrh (čaká|vznikol)|pred publikovaním|pred vydaním|dodatočné redakčné overenie)'
   or (new.cover_image_url is not null and new.image_rights='source_unverified') then
   raise exception 'Complete editorial and image rights review before publication' using errcode='23514';
  end if;
  if new.status='scheduled' and (new.scheduled_at is null or new.scheduled_at<=now()) then
   raise exception 'Choose a future publication time' using errcode='23514';
  end if;
  if new.status='published' then new.published_at:=coalesce(new.published_at,now()); end if;
 end if;
 return new;
end $$;
create function private.news_release_due() returns void language plpgsql security definer set search_path='' as $$
declare article record;
begin
 for article in select id from public.nitra_news where status='scheduled' and scheduled_at<=now() for update skip locked loop
  begin
   update public.nitra_news set status='published',published_at=scheduled_at where id=article.id;
  exception when others then
   update public.nitra_news set status='review',manual_review_required=true where id=article.id;
   insert into public.nitra_news_ingestion_runs(status,finished_at,error,report) values('failed',now(),'Scheduled article requires renewed editorial approval',jsonb_build_object('article_id',article.id));
  end;
 end loop;
end $$;
revoke all on function private.news_release_due() from public,anon,authenticated,service_role;
select cron.schedule('nitra-news-release-due','* * * * *','select private.news_release_due()');
