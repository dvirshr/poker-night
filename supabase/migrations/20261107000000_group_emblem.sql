-- Group emblem printed on the table felt (an emoji chosen by a group admin). Null = none.
alter table public.groups add column if not exists emblem text;
alter table public.groups drop constraint if exists groups_emblem_check;
alter table public.groups add constraint groups_emblem_check check (emblem is null or char_length(emblem) between 1 and 8);
