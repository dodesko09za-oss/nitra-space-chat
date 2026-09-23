begin;

create or replace function private.prepare_news()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();

  if new.status = 'published' then
    if auth.uid() is null
      or not private.is_admin(auth.uid())
      or private.account_is_banned(auth.uid()) then
      raise exception 'Manual editor approval required' using errcode = '42501';
    end if;

    if new.manual_review_required then
      raise exception 'Complete editorial review before publishing' using errcode = '23514';
    end if;

    if length(btrim(new.summary)) < 80 or length(btrim(new.content)) < 250 then
      raise exception 'Article summary or content is incomplete' using errcode = '23514';
    end if;

    if concat_ws(' ', new.summary, new.content) ~* '(návrh (čaká|vznikol)|pred publikovaním|pred vydaním|čo treba pred vydaním|dodatočné redakčné overenie)' then
      raise exception 'Draft instructions cannot be published' using errcode = '23514';
    end if;

    if new.cover_image_url is not null and new.image_rights = 'source_unverified' then
      raise exception 'Image rights must be confirmed before publishing' using errcode = '23514';
    end if;

    new.published_at := coalesce(new.published_at, now());
  end if;

  return new;
end;
$$;

revoke all on function private.prepare_news() from public, anon, authenticated;

commit;
