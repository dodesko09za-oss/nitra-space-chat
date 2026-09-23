create or replace function private.validate_news_publication()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.status in ('published', 'scheduled') then
    if coalesce(new.manual_review_required, true) then
      raise check_violation using message =
        'Článok nemožno publikovať bez potvrdenej redakčnej kontroly.';
    end if;

    if length(trim(coalesce(new.summary, ''))) < 40
       or length(trim(coalesce(new.content, ''))) < 300 then
      raise check_violation using message =
        'Článok nemožno publikovať: chýba plnohodnotný vlastný text alebo zhrnutie.';
    end if;

    if lower(coalesce(new.content, '')) like '%toto je redakčný návrh%'
       or lower(coalesce(new.content, '')) like '%pred publikovaním%'
       or lower(coalesce(new.summary, '')) like '%pred publikovaním%'
       or lower(coalesce(new.summary, '')) like '%návrh z portálu%' then
      raise check_violation using message =
        'Článok nemožno publikovať: obsahuje iba pracovný text alebo placeholder.';
    end if;

    if nullif(trim(coalesce(new.source_name, '')), '') is null
       or coalesce(new.source_url, '') !~ '^https://' then
      raise check_violation using message =
        'Článok nemožno publikovať bez názvu a HTTPS odkazu na pôvodný zdroj.';
    end if;

    if new.status = 'scheduled' and new.scheduled_at is null then
      raise check_violation using message =
        'Naplánovaný článok musí mať dátum a čas publikovania.';
    end if;

    if new.cover_image_url is not null
       and (
         new.image_rights not in ('owned', 'licensed', 'official')
         or nullif(trim(coalesce(new.image_credit, '')), '') is null
       ) then
      raise check_violation using message =
        'Obrázok možno publikovať iba s potvrdenými právami a uvedeným kreditom.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists news_validate_publication on public.nitra_news;

create trigger news_validate_publication
before insert or update of
  status,
  manual_review_required,
  summary,
  content,
  source_name,
  source_url,
  cover_image_url,
  image_rights,
  image_credit,
  scheduled_at
on public.nitra_news
for each row
execute function private.validate_news_publication();
