create or replace function public.manage_nitra_poll(
  p_password text,
  p_question text,
  p_options text[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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

  update public.nitra_polls set active = false where active;

  insert into public.nitra_polls (id, question, options, active)
  select new_poll_id,
         btrim(p_question),
         jsonb_agg(jsonb_build_object('id', 'option-' || position, 'label', value) order by position),
         true
  from unnest(clean_options) with ordinality as option_rows(value, position);

  return public.get_active_nitra_poll(null);
end;
$$;

revoke all on function public.manage_nitra_poll(text, text, text[]) from public;
grant execute on function public.manage_nitra_poll(text, text, text[]) to anon, authenticated;

