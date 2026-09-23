-- Allow a free-form display name at signup while keeping the public username
-- safe, normalized and unique. This does not touch anonymous chat tables.

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_requested_username text := lower(btrim(coalesce(new.raw_user_meta_data ->> 'username', '')));
  v_display_name text := left(btrim(coalesce(new.raw_user_meta_data ->> 'display_name', '')), 50);
  v_username_base text;
  v_username text;
  v_birth_date date;
begin
  begin
    v_birth_date := (new.raw_user_meta_data ->> 'birth_date')::date;
  exception when others then
    raise exception 'Invalid birth date';
  end;

  if v_birth_date > current_date - interval '16 years' then
    raise exception 'Social accounts require age 16 or older';
  end if;

  if v_display_name = '' then
    v_display_name := 'Používateľ';
  end if;

  if v_requested_username ~ '^[a-z0-9_]{3,24}$'
     and not exists (select 1 from public.profiles p where p.username = v_requested_username) then
    v_username := v_requested_username;
  else
    v_username_base := trim(both '_' from regexp_replace(lower(v_display_name), '[^a-z0-9]+', '_', 'g'));
    if char_length(v_username_base) < 3 then v_username_base := 'user'; end if;
    v_username := left(v_username_base, 15) || '_' || left(replace(new.id::text, '-', ''), 8);
  end if;

  insert into public.profiles(id, username, display_name, birth_date, city)
  values (new.id, v_username, v_display_name, v_birth_date, 'Nitra');
  return new;
end;
$$;

revoke all on function private.handle_new_user() from public, anon, authenticated;
