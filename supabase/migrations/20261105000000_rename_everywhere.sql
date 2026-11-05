-- A player changes his name: in his account, and optionally in every group he plays in at once.
-- Groups where another member already has that name are skipped (and reported back).
create or replace function public.rename_everywhere(p_name text, p_all_groups boolean default true)
returns table (group_id uuid, group_name text, renamed boolean)
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  nm text := btrim(coalesce(p_name, ''));
begin
  if me is null then raise exception 'not signed in'; end if;
  if length(nm) not between 1 and 40 then raise exception 'name must be 1-40 characters'; end if;

  update profiles set display_name = nm where id = me;

  if p_all_groups then
    return query
    with mine as (
      select p.id, p.group_id, g.name as gname,
             exists (select 1 from players o where o.group_id = p.group_id and o.id <> p.id and o.display_name = nm) as taken
      from players p join groups g on g.id = p.group_id
      where p.profile_id = me and p.status = 'active' and g.deleted_at is null
    ), done as (
      update players pl set display_name = nm
      from mine m where pl.id = m.id and not m.taken and pl.display_name <> nm
      returning pl.group_id
    )
    select m.group_id, m.gname, not m.taken from mine m order by m.gname;
  end if;
end $$;
revoke all on function public.rename_everywhere(text, boolean) from public, anon;
grant execute on function public.rename_everywhere(text, boolean) to authenticated;

-- A registered player's name belongs to him: only he (or an app operator) changes it.
-- Group admins still name guests, and may set a name while approving a pending request.
create or replace function public.players_name_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.display_name is distinct from old.display_name
     and old.profile_id is not null and old.status = 'active'
     and auth.uid() is not null and old.profile_id <> auth.uid()
     and not is_app_admin() then
    raise exception 'only the player can change his own name';
  end if;
  return new;
end $$;
drop trigger if exists players_name_guard on public.players;
create trigger players_name_guard before update of display_name on public.players
  for each row execute function public.players_name_guard();

-- the operator renames anyone: account, and optionally every group (skipping taken names). Logged.
create or replace function public.op_rename_user(p_profile uuid, p_name text, p_all_groups boolean default true)
returns table (group_id uuid, group_name text, renamed boolean)
language plpgsql security definer set search_path = public as $$
declare nm text := btrim(coalesce(p_name, ''));
begin
  if not is_app_admin() then raise exception 'operators only'; end if;
  if length(nm) not between 1 and 40 then raise exception 'name must be 1-40 characters'; end if;
  update profiles set display_name = nm where id = p_profile;
  if not found then raise exception 'no such user'; end if;
  insert into operator_log (operator, action) values (auth.uid(), 'user_rename');
  if p_all_groups then
    return query
    with mine as (
      select p.id, p.group_id, g.name as gname,
             exists (select 1 from players o where o.group_id = p.group_id and o.id <> p.id and o.display_name = nm) as taken
      from players p join groups g on g.id = p.group_id
      where p.profile_id = p_profile and p.status = 'active' and g.deleted_at is null
    ), done as (
      update players pl set display_name = nm
      from mine m where pl.id = m.id and not m.taken and pl.display_name <> nm
      returning pl.group_id
    )
    select m.group_id, m.gname, not m.taken from mine m order by m.gname;
  end if;
end $$;
revoke all on function public.op_rename_user(uuid, text, boolean) from public, anon;
grant execute on function public.op_rename_user(uuid, text, boolean) to authenticated;
