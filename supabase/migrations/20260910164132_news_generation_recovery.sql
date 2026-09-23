alter table public.nitra_news_generations add column responses jsonb not null default '[]';
create function private.news_recover_processing(p_article uuid default null) returns integer
language plpgsql security definer set search_path='' as $$
declare a record; recovered integer:=0;
begin
 for a in select id from public.nitra_news
  where status='processing' and updated_at<now()-interval '15 minutes'
    and (p_article is null or id=p_article)
  order by updated_at limit 50 for update skip locked
 loop
  if exists(select 1 from public.nitra_news_generations where article_id=a.id and status='processing' and created_at>=now()-interval '15 minutes') then continue;end if;
  update public.nitra_news_generations set status='failed',finished_at=now(),
   error='Spracovanie bolo prerušené. Pred opakovaním skontroluj uložené odpovede a možné náklady.'
   where article_id=a.id and status='processing';
  update public.nitra_news set status='failed',
   generation_error='Spracovanie bolo prerušené. Výsledky ostali v histórii AI; opakovanie vyžaduje administrátora.'
   where id=a.id;
  recovered:=recovered+1;
 end loop;
 return recovered;
end $$;
create function public.news_recover_processing(p_article uuid default null) returns integer
language sql security invoker set search_path='' as $$select private.news_recover_processing(p_article)$$;
revoke all on function private.news_recover_processing(uuid),public.news_recover_processing(uuid) from public,anon,authenticated;
grant execute on function private.news_recover_processing(uuid),public.news_recover_processing(uuid) to service_role;
