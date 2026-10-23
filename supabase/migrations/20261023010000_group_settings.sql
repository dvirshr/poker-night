-- Group settings: admins can switch who opens a game and promote/demote other admins.
-- (Admins could already update groups and players through RLS; this adds the guard rails.)

create or replace function public.players_role_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- an admin must be a real account, not a guest
  if new.role = 'admin' and new.profile_id is null then
    raise exception 'a guest cannot be an admin';
  end if;
  -- never leave a group without an active admin
  if old.role = 'admin' and old.status = 'active'
     and (new.role <> 'admin' or new.status <> 'active')
     and not exists (select 1 from players
                     where group_id = old.group_id and id <> old.id and role = 'admin' and status = 'active') then
    raise exception 'a group needs at least one admin';
  end if;
  return new;
end $$;

drop trigger if exists players_role_guard on public.players;
create trigger players_role_guard before update on public.players
  for each row execute function public.players_role_guard();
