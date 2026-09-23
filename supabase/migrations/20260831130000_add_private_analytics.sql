create table if not exists private.nitra_analytics_sessions (
  day date not null,
  session_id uuid not null,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  pageviews integer not null default 0 check (pageviews >= 0),
  primary key (day, session_id)
);

create table if not exists private.nitra_analytics_clicks (
  day date not null,
  target text not null,
  clicks bigint not null default 0 check (clicks >= 0),
  primary key (day, target)
);

alter table private.nitra_analytics_sessions enable row level security;
alter table private.nitra_analytics_clicks enable row level security;

revoke all on private.nitra_analytics_sessions from public, anon, authenticated;
revoke all on private.nitra_analytics_clicks from public, anon, authenticated;

create or replace function public.record_nitra_analytics(
  p_session_id uuid,
  p_event text,
  p_target text default null
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_day date := timezone('Europe/Bratislava', now())::date;
  v_target text := lower(trim(coalesce(p_target, '')));
  v_allowed_targets constant text[] := array[
    'tellonym', 'chat', 'section_board', 'section_events', 'section_future',
    'wall_compose', 'event_link', 'poll_vote'
  ];
begin
  if p_session_id is null or p_event not in ('pageview', 'click') then
    raise exception 'Invalid analytics event';
  end if;

  insert into private.nitra_analytics_sessions (day, session_id, pageviews)
  values (v_day, p_session_id, case when p_event = 'pageview' then 1 else 0 end)
  on conflict (day, session_id) do update
    set last_seen = now(),
        pageviews = private.nitra_analytics_sessions.pageviews + excluded.pageviews;

  if p_event = 'click' then
    if not (v_target = any(v_allowed_targets)) then
      raise exception 'Invalid analytics target';
    end if;

    insert into private.nitra_analytics_clicks (day, target, clicks)
    values (v_day, v_target, 1)
    on conflict (day, target) do update
      set clicks = private.nitra_analytics_clicks.clicks + 1;
  end if;
end;
$$;

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

revoke all on function public.record_nitra_analytics(uuid, text, text) from public;
revoke all on function public.get_nitra_analytics(text, date) from public;
grant execute on function public.record_nitra_analytics(uuid, text, text) to anon, authenticated;
grant execute on function public.get_nitra_analytics(text, date) to anon, authenticated;
