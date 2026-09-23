create or replace function public.get_nitra_analytics(
  p_password text,
  p_day date
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private, extensions
as $$
declare
  v_expected_hash text;
  v_day date := coalesce(p_day, timezone('Europe/Bratislava', now())::date);
  v_unique bigint;
  v_pageviews bigint;
  v_clicks jsonb;
begin
  select password_hash into v_expected_hash
  from private.nitra_event_admin
  where singleton = true;

  if v_expected_hash is null
     or encode(extensions.digest(coalesce(p_password, ''), 'sha256'), 'hex') <> v_expected_hash then
    raise exception 'Invalid admin password';
  end if;

  select count(*), coalesce(sum(pageviews), 0)
  into v_unique, v_pageviews
  from private.nitra_analytics_sessions
  where day = v_day;

  select coalesce(
    jsonb_agg(jsonb_build_object('target', target, 'clicks', clicks) order by clicks desc, target),
    '[]'::jsonb
  )
  into v_clicks
  from private.nitra_analytics_clicks
  where day = v_day;

  return jsonb_build_object(
    'day', v_day,
    'unique_visitors', v_unique,
    'pageviews', v_pageviews,
    'clicks', v_clicks
  );
end;
$$;

revoke all on function public.get_nitra_analytics(text, date) from public;
grant execute on function public.get_nitra_analytics(text, date) to anon, authenticated;
