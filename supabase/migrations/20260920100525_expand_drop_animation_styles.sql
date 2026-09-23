alter table public.nitra_drops drop constraint nitra_drops_style_check;
alter table public.nitra_drops add constraint nitra_drops_style_check
check(style in ('default','chrome','blur','slide','zoom','fade','orbit','liquid','shimmer','pulse'));
