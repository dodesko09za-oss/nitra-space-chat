-- Run within a transaction AFTER the two pending community schema scripts.
-- Every test identity and row MUST be rolled back; no auth emails are sent.
create temp table nitra_community_test_ids(role text,id uuid);
insert into nitra_community_test_ids values('one',gen_random_uuid()),('two',gen_random_uuid()),('outsider',gen_random_uuid()),('editor',gen_random_uuid());
grant select on nitra_community_test_ids to authenticated,anon;
insert into auth.users(id,email,raw_user_meta_data)
select id,id::text||'@test.invalid',jsonb_build_object('display_name','Test','birth_date','2000-01-01') from nitra_community_test_ids;
insert into private.admin_users(user_id) select id from nitra_community_test_ids where role='editor';
update public.profiles set discoverable=true where id in (select id from nitra_community_test_ids);
insert into public.nitra_polls(id,question,options,active,account_voting) values('community-security-test','Test bezpečnosti?','[{"id":"a","label":"A"},{"id":"b","label":"B"}]',true,true);
insert into public.nitra_news(slug,headline,summary,content,source_name,source_url) values('community-security-test','Never public draft','Test','Tento testovací článok sa nikdy nesmie publikovať na produkčnom webe.','Test','https://test.invalid/community-security-test');
set local role anon;
do $$begin
 if exists(select 1 from public.nitra_news where slug='community-security-test') then raise exception 'Draft exposed';end if;
 if public.get_active_nitra_poll(null)->>'id'='community-security-test' then raise exception 'Legacy API exposed new poll';end if;
 begin perform public.vote_nitra_poll('community-security-test','a',gen_random_uuid());raise exception 'Legacy vote bypass';exception when raise_exception then if sqlerrm='Legacy vote bypass' then raise;end if;end;
 if has_function_privilege(current_user,'public.nitra_community_vote(text,text)','EXECUTE') then raise exception 'Anonymous votes allowed';end if;
 if public.nitra_community_polls() @? '$[*].options[*] ? (@.votes != null)' then raise exception 'Results exposed before voting';end if;
end$$;
reset role;
select set_config('request.jwt.claim.sub',(select id::text from nitra_community_test_ids where role='one'),true);
set local role authenticated;
do $$begin
 begin update public.profiles set is_verified=true where id=auth.uid();raise exception 'Self verification succeeded';exception when insufficient_privilege then null;end;
 begin update public.nitra_news set status='published' where slug='community-security-test';if found then raise exception 'Non-admin published';end if;exception when insufficient_privilege then null;end;
 perform public.nitra_community_vote('community-security-test','a');perform public.nitra_community_vote('community-security-test','b');
 if not public.nitra_community_polls() @? '$[*] ? (@.id == "community-security-test" && @.selected_option == "a" && @.total_votes == 1)' then raise exception 'Vote not idempotent';end if;
 begin perform public.get_or_create_dm((select id from nitra_community_test_ids where role='two'));raise exception 'DM created without consent';exception when raise_exception then if sqlerrm='DM created without consent' then raise;end if;end;
 perform public.nitra_community_request((select id from nitra_community_test_ids where role='two'));
end$$;
reset role;
select set_config('request.jwt.claim.sub',(select id::text from nitra_community_test_ids where role='two'),true);
set local role authenticated;
select public.nitra_community_respond((select id from nitra_community_test_ids where role='one'),true);
reset role;
select set_config('request.jwt.claim.sub',(select id::text from nitra_community_test_ids where role='one'),true);
set local role authenticated;
insert into public.direct_messages(conversation_id,sender_id,body) select (public.nitra_community_inbox()->0->>'id')::uuid,auth.uid(),'rollback-only test';
reset role;
select set_config('request.jwt.claim.sub',(select id::text from nitra_community_test_ids where role='outsider'),true);
set local role authenticated;
do $$begin if exists(select 1 from public.direct_messages where body='rollback-only test') then raise exception 'Non-member read DM';end if;end$$;
reset role;
select set_config('request.jwt.claim.sub',(select id::text from nitra_community_test_ids where role='one'),true);
set local role authenticated;
insert into public.blocks(blocker_id,blocked_id) select auth.uid(),id from nitra_community_test_ids where role='two';
do $$begin if jsonb_array_length(public.nitra_community_inbox())<>0 then raise exception 'Blocked conversation visible';end if;end$$;
reset role;
select set_config('request.jwt.claim.sub',(select id::text from nitra_community_test_ids where role='editor'),true);
set local role authenticated;
update public.nitra_news set status='published' where slug='community-security-test';
do $$begin if not exists(select 1 from public.nitra_news where slug='community-security-test' and status='published' and published_at is not null) then raise exception 'Admin publication failed';end if;end$$;
reset role;
