alter table public.nitra_news
  drop constraint if exists nitra_news_image_rights_check;

alter table public.nitra_news
  add constraint nitra_news_image_rights_check
  check (image_rights = any (array[
    'fallback'::text,
    'source_unverified'::text,
    'owned'::text,
    'licensed'::text,
    'official'::text
  ]));
