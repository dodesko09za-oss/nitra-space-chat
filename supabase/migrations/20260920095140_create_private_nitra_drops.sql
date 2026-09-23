create table public.nitra_drops (
id uuid primary key default gen_random_uuid(),
body text not null check(char_length(btrim(body)) between 3 and 1200),
status text not null default 'unread' check(status in ('unread','read','answered','archived')),
reply text not null default '' check(char_length(reply)<=1200),
style text not null default 'default' check(style in ('default','chrome','blur','slide','zoom','fade')),
created_at timestamptz not null default now()
);
alter table public.nitra_drops enable row level security;
revoke all on public.nitra_drops from public,anon,authenticated;
grant insert(body) on public.nitra_drops to anon,authenticated;
grant select,update on public.nitra_drops to authenticated;
create policy drops_submit on public.nitra_drops for insert to anon,authenticated with check(status='unread' and reply='' and style='default');
create policy drops_admin_read on public.nitra_drops for select to authenticated using((select public.is_admin()));
create policy drops_admin_update on public.nitra_drops for update to authenticated using((select public.is_admin())) with check((select public.is_admin()));
create index drops_created on public.nitra_drops(created_at desc);
