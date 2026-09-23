create table if not exists public.post_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 500),
  created_at timestamptz not null default now()
);

create index if not exists post_comments_post_created_idx
  on public.post_comments(post_id, created_at desc);
create index if not exists post_comments_user_idx
  on public.post_comments(user_id);

alter table public.post_comments enable row level security;

drop policy if exists post_comments_read_allowed on public.post_comments;
create policy post_comments_read_allowed on public.post_comments
for select to authenticated
using (
  exists (
    select 1 from public.posts po
    where po.id = post_id
      and private.can_view_social_content(po.user_id, (select auth.uid()))
      and not private.users_are_blocked((select auth.uid()), user_id)
  )
);

drop policy if exists post_comments_insert_own on public.post_comments;
create policy post_comments_insert_own on public.post_comments
for insert to authenticated
with check (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.posts po
    where po.id = post_id
      and private.can_view_social_content(po.user_id, (select auth.uid()))
      and not private.users_are_blocked((select auth.uid()), po.user_id)
  )
);

drop policy if exists post_comments_delete_allowed on public.post_comments;
create policy post_comments_delete_allowed on public.post_comments
for delete to authenticated
using (
  user_id = (select auth.uid())
  or exists (
    select 1 from public.posts po
    where po.id = post_id and po.user_id = (select auth.uid())
  )
);

revoke all on table public.post_comments from anon;
grant select, insert, delete on table public.post_comments to authenticated;

create or replace function private.post_comments_feed(p_post_id uuid, p_limit integer default 100)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when exists (
      select 1 from public.posts po
      where po.id = p_post_id
        and private.can_view_social_content(po.user_id, auth.uid())
    )
    then coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id,
        'post_id', c.post_id,
        'user_id', c.user_id,
        'body', c.body,
        'created_at', c.created_at,
        'username', p.username,
        'display_name', p.display_name,
        'avatar_path', p.avatar_path,
        'is_verified', p.is_verified
      ) order by c.created_at asc)
      from (
        select pc.*
        from public.post_comments pc
        where pc.post_id = p_post_id
          and not private.users_are_blocked(auth.uid(), pc.user_id)
        order by pc.created_at desc
        limit least(greatest(coalesce(p_limit, 100), 1), 100)
      ) c
      join public.profiles p on p.id = c.user_id
      where p.deactivated_at is null
    ), '[]'::jsonb)
    else '[]'::jsonb
  end;
$$;

create or replace function public.post_comments_feed(p_post_id uuid, p_limit integer default 100)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$ select private.post_comments_feed(p_post_id, p_limit); $$;

revoke all on function private.post_comments_feed(uuid, integer) from public, anon;
revoke all on function public.post_comments_feed(uuid, integer) from public, anon;
grant execute on function private.post_comments_feed(uuid, integer) to authenticated;
grant execute on function public.post_comments_feed(uuid, integer) to authenticated;
