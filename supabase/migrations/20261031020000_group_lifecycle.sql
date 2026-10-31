-- Group lifecycle: rename, archive, delete (soft) and restore. Nothing is ever erased.
--   archived : still visible to its members (history, league), but no new nights and no new members
--   deleted  : hidden from members; only the group's admins see it, under "deleted groups", and can restore it

alter table public.groups
  add column if not exists archived_at timestamptz,
  add column if not exists deleted_at  timestamptz,
  add column if not exists deleted_by  uuid references public.profiles(id);

-- only the functions below change the state (they set app.group_state)
create or replace function public.groups_state_guard()
returns trigger language plpgsql as $$
begin
  if (new.archived_at is distinct from old.archived_at or new.deleted_at is distinct from old.deleted_at
      or new.deleted_by is distinct from old.deleted_by)
     and coalesce(current_setting('app.group_state', true), '') <> 'on' then
    raise exception 'use the archive / delete / restore actions';
  end if;
  if old.deleted_at is not null and new.deleted_at is not null and new.name <> old.name then
    raise exception 'group is deleted';
  end if;
  return new;
end $$;
drop trigger if exists groups_state_guard on public.groups;
create trigger groups_state_guard before update on public.groups
  for each row execute function public.groups_state_guard();

create or replace function public.set_group_state(p_group uuid, p_action text)
returns void language plpgsql security definer set search_path = public as $$
declare gr groups%rowtype;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into gr from groups where id = p_group for update;
  if not found then raise exception 'no such group'; end if;
  if not is_group_admin(p_group) then raise exception 'only a group admin can do this'; end if;
  if p_action in ('archive', 'delete')
     and exists (select 1 from games where group_id = p_group and status in ('open', 'counting')) then
    raise exception 'group has an open game';
  end if;
  perform set_config('app.group_state', 'on', true);
  if p_action = 'archive' then
    update groups set archived_at = coalesce(archived_at, now()) where id = p_group;
  elsif p_action = 'unarchive' then
    update groups set archived_at = null where id = p_group;
  elsif p_action = 'delete' then
    update groups set deleted_at = now(), deleted_by = auth.uid() where id = p_group;
  elsif p_action = 'restore' then
    update groups set deleted_at = null, deleted_by = null where id = p_group;
  else
    raise exception 'unknown action';
  end if;
  perform set_config('app.group_state', 'off', true);
end $$;
revoke all on function public.set_group_state(uuid, text) from public, anon;
grant execute on function public.set_group_state(uuid, text) to authenticated;

-- an archived or deleted group takes no new nights and no new members
create or replace function public.group_active_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from groups where id = new.group_id and (archived_at is not null or deleted_at is not null)) then
    raise exception 'group is archived';
  end if;
  return new;
end $$;
drop trigger if exists games_group_active on public.games;
create trigger games_group_active before insert on public.games
  for each row execute function public.group_active_guard();
drop trigger if exists players_group_active on public.players;
create trigger players_group_active before insert on public.players
  for each row execute function public.group_active_guard();

-- a member renames himself in a group (admins can already rename anyone)
create or replace function public.rename_me(p_group uuid, p_name text)
returns void language plpgsql security definer set search_path = public as $$
declare nm text := btrim(coalesce(p_name, ''));
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if length(nm) not between 1 and 40 then raise exception 'name must be 1-40 characters'; end if;
  if exists (select 1 from players where group_id = p_group and display_name = nm and profile_id is distinct from auth.uid()) then
    raise exception 'name taken by another member';
  end if;
  update players set display_name = nm where group_id = p_group and profile_id = auth.uid() and status = 'active';
  if not found then raise exception 'not a member of this group'; end if;
end $$;
revoke all on function public.rename_me(uuid, text) from public, anon;
grant execute on function public.rename_me(uuid, text) to authenticated;
