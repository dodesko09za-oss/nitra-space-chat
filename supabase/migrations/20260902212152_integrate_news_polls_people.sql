-- Additive extension; legacy polls keep their original APIs.
begin;
alter table public.nitra_polls add column account_voting boolean not null default false;
alter table public.nitra_polls add column kind text not null default 'normal' check(kind in ('normal','versus','rating','daily'));
alter table public.nitra_polls add column news_id uuid references public.nitra_news(id) on delete set null;
alter table public.nitra_polls add column closes_at timestamptz;
alter table public.nitra_polls drop constraint if exists nitra_polls_options_check;
alter table public.nitra_polls add constraint nitra_polls_options_shape check(jsonb_typeof(options)='array' and jsonb_array_length(options) between 2 and 10);
create index nitra_polls_news_idx on public.nitra_polls(news_id) where news_id is not null;
create index nitra_polls_active_idx on public.nitra_polls(created_at desc) where active;
create index nitra_poll_voter_time_idx on private.nitra_poll_votes(voter_id,created_at desc);
grant select,insert,update,delete on public.nitra_polls to authenticated;
create policy polls_admin on public.nitra_polls for all to authenticated using(account_voting and private.is_admin((select auth.uid())) and not private.account_is_banned((select auth.uid()))) with check(account_voting and private.is_admin((select auth.uid())) and not private.account_is_banned((select auth.uid())));
create function private.validate_nitra_community_poll() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_op='UPDATE' and new.account_voting<>old.account_voting then raise exception 'Voting mode is immutable'; end if;
  if not new.account_voting then return new; end if;
  if jsonb_array_length(new.options) <> (case when new.kind='rating' then 10 when new.kind='versus' then 2 else jsonb_array_length(new.options) end)
    or (new.kind in ('normal','daily') and jsonb_array_length(new.options)>4)
    or exists(select 1 from jsonb_array_elements(new.options) o where coalesce(length(o->>'id'),0) not between 1 and 50 or coalesce(length(o->>'label'),0) not between 1 and 120)
    or (select count(distinct o->>'id') from jsonb_array_elements(new.options) o)<>jsonb_array_length(new.options) then raise exception 'Invalid poll options'; end if;
  if tg_op='UPDATE' and new.options is distinct from old.options and exists(select 1 from private.nitra_poll_votes where poll_id=old.id) then raise exception 'Cannot change options after votes'; end if;
  return new;
end;$$;
revoke all on function private.validate_nitra_community_poll() from public,anon,authenticated;
create trigger nitra_community_poll_validate before insert or update on public.nitra_polls for each row execute function private.validate_nitra_community_poll();
create function private.nitra_community_polls(p_news uuid default null) returns jsonb language sql stable security definer set search_path='' as $$
select coalesce(jsonb_agg(x.item order by x.created_at desc),'[]'::jsonb) from (
 select p.created_at,jsonb_build_object('id',p.id,'question',p.question,'kind',p.kind,'active',p.active,'news_id',p.news_id,
 'selected_option',(select option_id from private.nitra_poll_votes where poll_id=p.id and voter_id=auth.uid()),
 'total_votes',case when private.is_admin(auth.uid()) or exists(select 1 from private.nitra_poll_votes where poll_id=p.id and voter_id=auth.uid()) then (select count(*) from private.nitra_poll_votes where poll_id=p.id) else null end,
 'options',(select jsonb_agg(o || jsonb_build_object('votes',case when private.is_admin(auth.uid()) or exists(select 1 from private.nitra_poll_votes where poll_id=p.id and voter_id=auth.uid()) then (select count(*) from private.nitra_poll_votes v where v.poll_id=p.id and v.option_id=o->>'id') else null end) order by ord) from jsonb_array_elements(p.options) with ordinality options(o,ord))) item
 from public.nitra_polls p where p.account_voting and p.active and (p.closes_at is null or p.closes_at>now()) and (p_news is null or p.news_id=p_news) order by p.created_at desc limit 30
) x;
$$;
create function private.nitra_community_vote(p_poll text,p_option text) returns jsonb language plpgsql security definer set search_path='' as $$
declare me uuid:=auth.uid();
begin
 if me is null or private.account_is_banned(me) then raise exception 'Sign in required' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended(me::text,0));
 perform 1 from public.nitra_polls where id=p_poll and account_voting and active and (closes_at is null or closes_at>now()) for share;
 if not found then raise exception 'Poll closed'; end if;
 if not exists(select 1 from public.nitra_polls p,jsonb_array_elements(p.options) o where p.id=p_poll and o->>'id'=p_option) then raise exception 'Invalid option'; end if;
 if (select count(*) from private.nitra_poll_votes where voter_id=me and created_at>now()-interval '1 minute')>=15 then raise exception 'Slow down'; end if;
 insert into private.nitra_poll_votes(poll_id,voter_id,option_id) values(p_poll,me,p_option) on conflict(poll_id,voter_id) do nothing;
 return private.nitra_community_polls(null);
end;$$;
grant usage on schema private to anon,authenticated;
revoke all on function private.nitra_community_polls(uuid),private.nitra_community_vote(text,text) from public,anon,authenticated;
grant execute on function private.nitra_community_polls(uuid) to anon,authenticated;
grant execute on function private.nitra_community_vote(text,text) to authenticated;
create function public.nitra_community_polls(p_news uuid default null) returns jsonb language sql security invoker set search_path='' as $$ select private.nitra_community_polls(p_news); $$;
create function public.nitra_community_vote(p_poll text,p_option text) returns jsonb language sql security invoker set search_path='' as $$ select private.nitra_community_vote(p_poll,p_option); $$;
revoke all on function public.nitra_community_polls(uuid),public.nitra_community_vote(text,text) from public,anon,authenticated;
grant execute on function public.nitra_community_polls(uuid) to anon,authenticated;
grant execute on function public.nitra_community_vote(text,text) to authenticated;
CREATE OR REPLACE FUNCTION public.get_active_nitra_poll(p_voter_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
  with active_poll as (
    select p.id, p.question, p.options
    from public.nitra_polls p
    where p.active and not p.account_voting
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
$function$;

CREATE OR REPLACE FUNCTION public.manage_nitra_poll(p_password text, p_question text, p_options text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  expected_hash text;
  clean_options text[];
  new_poll_id text := 'poll-' || gen_random_uuid()::text;
begin
  select password_hash into expected_hash
  from private.nitra_event_admin
  where singleton = true;

  if expected_hash is null
     or encode(extensions.digest(coalesce(p_password, ''), 'sha256'), 'hex') <> expected_hash then
    raise exception 'Nesprávne admin heslo.';
  end if;

  select array_agg(btrim(value) order by position)
  into clean_options
  from unnest(coalesce(p_options, array[]::text[])) with ordinality as input(value, position)
  where char_length(btrim(value)) between 1 and 80;

  if char_length(btrim(coalesce(p_question, ''))) not between 4 and 180 then
    raise exception 'Otázka musí mať 4 až 180 znakov.';
  end if;

  if coalesce(array_length(clean_options, 1), 0) not between 2 and 4 then
    raise exception 'Anketa musí mať 2 až 4 odpovede.';
  end if;

  update public.nitra_polls set active = false where active and not account_voting;

  insert into public.nitra_polls (id, question, options, active)
  select new_poll_id,
         btrim(p_question),
         jsonb_agg(jsonb_build_object('id', 'option-' || position, 'label', value) order by position),
         true
  from unnest(clean_options) with ordinality as option_rows(value, position);

  return public.get_active_nitra_poll(null);
end;
$function$;

CREATE OR REPLACE FUNCTION public.manage_nitra_poll_history(p_password text, p_action text DEFAULT 'list'::text, p_poll_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  expected_hash text;
  normalized_action text := lower(btrim(coalesce(p_action, 'list')));
  result jsonb;
begin
  select password_hash into expected_hash
  from private.nitra_event_admin
  where singleton = true;

  if expected_hash is null
     or encode(extensions.digest(coalesce(p_password, ''), 'sha256'), 'hex') <> expected_hash then
    raise exception 'Nesprávne admin heslo.';
  end if;

  if normalized_action = 'delete' then
    if coalesce(btrim(p_poll_id), '') = '' then
      raise exception 'Chýba anketa na vymazanie.';
    end if;
    delete from public.nitra_polls where id = p_poll_id and not account_voting;
  elsif normalized_action <> 'list' then
    raise exception 'Neplatná admin akcia.';
  end if;

  select coalesce(jsonb_agg(poll_item order by created_at desc), '[]'::jsonb)
  into result
  from (
    select
      p.created_at,
      jsonb_build_object(
        'id', p.id,
        'question', p.question,
        'active', p.active,
        'created_at', p.created_at,
        'total_votes', (select count(*) from private.nitra_poll_votes v where v.poll_id = p.id),
        'options', (
          select coalesce(jsonb_agg(
            option_item || jsonb_build_object(
              'votes', (select count(*) from private.nitra_poll_votes v where v.poll_id = p.id and v.option_id = option_item->>'id')
            ) order by option_order
          ), '[]'::jsonb)
          from jsonb_array_elements(p.options) with ordinality as items(option_item, option_order)
        )
      ) as poll_item
    from public.nitra_polls p where not p.account_voting
  ) history;

  return result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.vote_nitra_poll(p_poll_id text, p_option_id text, p_voter_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
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
      and p.active and not p.account_voting
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
$function$;


-- Reuse profiles, statuses, connections, requests, messages and notifications.

alter table public.profiles add column discoverable boolean not null default false;
alter table public.profiles add column show_online boolean not null default false;
alter table public.profiles add column people_interests text[] not null default '{}' check(cardinality(people_interests)<=8 and length(people_interests::text)<=300);
alter table public.conversation_members add column last_read_at timestamptz not null default now();
create index profiles_people_idx on public.profiles(username) where discoverable and deactivated_at is null;
create index profiles_people_interests_idx on public.profiles using gin(people_interests) where discoverable;
-- Preserve existing editable columns; reject privilege escalation at the row boundary.
create function private.protect_profile_verification() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if auth.uid() is not null and not private.is_admin(auth.uid()) and (new.is_verified is distinct from old.is_verified or new.verified_at is distinct from old.verified_at) then raise exception 'Admin required' using errcode='42501'; end if;
 return new;
end;$$;
revoke all on function private.protect_profile_verification() from public,anon,authenticated;
create trigger nitra_profile_verification before update on public.profiles for each row execute function private.protect_profile_verification();
create function private.nitra_community_people(p_after text default '',p_username text default null,p_interest text default '') returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(x) order by x.username),'[]'::jsonb) from (
 select p.id,p.username,p.display_name,p.avatar_path,p.bio,p.is_verified,p.show_online,p.people_interests,
 extract(year from age(current_date,p.birth_date))::int age,
 (select s.body from public.statuses s where s.user_id=p.id and s.visibility='public' and s.expires_at>now() order by s.created_at desc limit 1) status
 from public.profiles p where (p.discoverable or p.id=auth.uid()) and p.deactivated_at is null and not private.account_is_banned(p.id)
 and not private.account_is_banned(auth.uid()) and not private.users_are_blocked(auth.uid(),p.id)
 and p.username>coalesce(p_after,'') and (p_username is null or p.username=p_username)
 and (coalesce(p_interest,'')='' or p_interest=any(p.people_interests)) order by p.username limit 20
 ) x;
$$;
create function public.nitra_community_people(p_after text default '',p_username text default null,p_interest text default '') returns jsonb language sql security invoker set search_path='' as $$ select private.nitra_community_people(p_after,p_username,p_interest); $$;
revoke all on function private.nitra_community_people(text,text,text),public.nitra_community_people(text,text,text) from public,anon,authenticated;
grant usage on schema private to anon,authenticated;
grant execute on function private.nitra_community_people(text,text,text),public.nitra_community_people(text,text,text) to anon,authenticated;
create function private.nitra_community_request(p_target uuid) returns text language plpgsql security definer set search_path='' as $$
declare me uuid:=auth.uid();
begin
 if me is null or private.account_is_banned(me) or private.account_is_banned(p_target) or private.users_are_blocked(me,p_target) then raise exception 'Request not allowed' using errcode='42501'; end if;
 if not exists(select 1 from public.profiles where id=p_target and discoverable and deactivated_at is null) then raise exception 'Profile unavailable'; end if;
 perform pg_advisory_xact_lock(hashtextextended(me::text,1));
 if exists(select 1 from public.connection_requests where requester_id=me and target_id=p_target and expires_at>now()) then return 'requested'; end if;
 if (select count(*) from public.connection_requests where requester_id=me and created_at>now()-interval '1 hour')>=15 then raise exception 'Too many requests'; end if;
 return private.request_connection(p_target);
end;$$;
create function public.nitra_community_request(p_target uuid) returns text language sql security invoker set search_path='' as $$ select private.nitra_community_request(p_target); $$;
revoke all on function private.nitra_community_request(uuid),public.nitra_community_request(uuid) from public,anon,authenticated;
grant execute on function private.nitra_community_request(uuid),public.nitra_community_request(uuid) to authenticated;
create function private.nitra_community_respond(p_requester uuid,p_accept boolean) returns uuid language plpgsql security definer set search_path='' as $$
declare me uuid:=auth.uid();
begin
 if me is null or private.account_is_banned(me) or private.account_is_banned(p_requester) or private.users_are_blocked(me,p_requester) then raise exception 'Not allowed' using errcode='42501'; end if;
 if not exists(select 1 from public.connection_requests where requester_id=p_requester and target_id=me and expires_at>now()) then raise exception 'Request unavailable'; end if;
 perform private.respond_connection_request(p_requester,p_accept);
 if p_accept then return private.get_or_create_dm(p_requester); end if;
 return null;
end;$$;
create function public.nitra_community_respond(p_requester uuid,p_accept boolean) returns uuid language sql security invoker set search_path='' as $$ select private.nitra_community_respond(p_requester,p_accept); $$;
revoke all on function private.nitra_community_respond(uuid,boolean),public.nitra_community_respond(uuid,boolean) from public,anon,authenticated;
grant execute on function private.nitra_community_respond(uuid,boolean),public.nitra_community_respond(uuid,boolean) to authenticated;
create function private.nitra_community_inbox() returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(x) order by x.last_message_at desc nulls last),'[]'::jsonb) from (
 select c.id,p.id other_id,p.username,p.display_name,p.avatar_path,c.last_message_at,
 (select count(*) from public.direct_messages d where d.conversation_id=c.id and d.sender_id<>auth.uid() and d.created_at>cm.last_read_at) unread
 from public.conversations c join public.conversation_members cm on cm.conversation_id=c.id and cm.user_id=auth.uid()
 join public.profiles p on p.id=case when c.user1_id=auth.uid() then c.user2_id else c.user1_id end
 where not private.account_is_banned(auth.uid()) and not private.account_is_banned(p.id) and not private.users_are_blocked(auth.uid(),p.id)
 order by c.last_message_at desc nulls last limit 50) x;
$$;
create function public.nitra_community_inbox() returns jsonb language sql security invoker set search_path='' as $$select private.nitra_community_inbox();$$;
create function private.nitra_community_read(p_conversation uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Sign in required' using errcode='42501'; end if;
 update public.conversation_members set last_read_at=now() where conversation_id=p_conversation and user_id=auth.uid();
 update public.notifications set read_at=now() where user_id=auth.uid() and type='message' and entity_id=p_conversation and read_at is null;
end;$$;
create function public.nitra_community_read(p_conversation uuid) returns void language sql security invoker set search_path='' as $$select private.nitra_community_read(p_conversation);$$;
revoke all on function private.nitra_community_inbox(),public.nitra_community_inbox(),private.nitra_community_read(uuid),public.nitra_community_read(uuid) from public,anon,authenticated;
grant execute on function private.nitra_community_inbox(),public.nitra_community_inbox(),private.nitra_community_read(uuid),public.nitra_community_read(uuid) to authenticated;
-- Restrictive policies combine with existing membership policies, never broaden them.
create policy nitra_community_dm_safe on public.direct_messages as restrictive for all to authenticated
 using(not private.account_is_banned((select auth.uid())) and not private.account_is_banned(sender_id))
 with check(not private.account_is_banned((select auth.uid())) and exists(select 1 from public.conversations c where c.id=conversation_id and not private.account_is_banned(c.user1_id) and not private.account_is_banned(c.user2_id)));
create function private.guard_connection_requests() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or new.requester_id<>auth.uid() or new.requester_id=new.target_id or private.account_is_banned(new.requester_id) or private.account_is_banned(new.target_id) or private.users_are_blocked(new.requester_id,new.target_id) then raise exception 'Request not allowed' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(new.requester_id::text,1));
 if (select count(*) from public.connection_requests where requester_id=new.requester_id and created_at>now()-interval '1 hour' and target_id<>new.target_id)>=15 then raise exception 'Too many requests';end if;
 return new;
end;$$;
revoke all on function private.guard_connection_requests() from public,anon,authenticated;
create trigger nitra_request_guard before insert or update on public.connection_requests for each row execute function private.guard_connection_requests();
commit;
