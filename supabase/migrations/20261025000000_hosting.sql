-- Hosting rotation: who hosts each night, and the group's fixed order ("after X comes Y").
-- Optional: a group that does not rotate simply leaves it off.

alter table public.groups
  add column if not exists hosting_enabled boolean not null default false,
  add column if not exists host_rotation   uuid[]  not null default '{}';   -- player ids, in turn order

alter table public.games
  add column if not exists host_player_id uuid references public.players(id);

-- the host is a player of the same group (a guest is fine); a closed night stays as it was
create or replace function public.games_host_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.host_player_id is not null
     and not exists (select 1 from players where id = new.host_player_id and group_id = new.group_id and status <> 'pending') then
    raise exception 'host must be a player of this group';
  end if;
  return new;
end $$;
drop trigger if exists games_host_guard on public.games;
create trigger games_host_guard before insert or update of host_player_id on public.games
  for each row execute function public.games_host_guard();

-- check: should return true, true
select exists (select 1 from information_schema.columns where table_name = 'games' and column_name = 'host_player_id') as host_ok,
       exists (select 1 from information_schema.columns where table_name = 'groups' and column_name = 'host_rotation') as rotation_ok;
