create policy direct_messages_delete_own
on public.direct_messages
for delete
to authenticated
using (
  sender_id = (select auth.uid())
  and private.is_conversation_member(conversation_id, (select auth.uid()))
);

grant delete on public.direct_messages to authenticated;

create or replace function private.refresh_conversation_after_message_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.conversations
  set last_message_at = (
    select max(dm.created_at)
    from public.direct_messages dm
    where dm.conversation_id = old.conversation_id
  )
  where id = old.conversation_id;
  return old;
end;
$$;

revoke all on function private.refresh_conversation_after_message_delete() from public, anon, authenticated;

create trigger direct_messages_refresh_conversation_after_delete
after delete on public.direct_messages
for each row execute function private.refresh_conversation_after_message_delete();

