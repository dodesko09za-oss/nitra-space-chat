create or replace function public.manage_nitra_poll_history(
  p_password text,
  p_action text default 'list',
  p_poll_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
    delete from public.nitra_polls where id = p_poll_id;
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
    from public.nitra_polls p
  ) history;

  return result;
end;
$$;

revoke all on function public.manage_nitra_poll_history(text, text, text) from public;
grant execute on function public.manage_nitra_poll_history(text, text, text) to anon, authenticated;
