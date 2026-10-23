-- Wave 1: unlink a member's account, per-group table theme.

-- Table look, chosen by an admin in group settings.
alter table public.groups add column if not exists table_theme text not null default 'graphite';
alter table public.groups drop constraint if exists groups_table_theme_check;
alter table public.groups add constraint groups_table_theme_check
  check (table_theme in ('graphite', 'green', 'vegas', 'ocean'));

-- Undo a wrong approval: the player row (and its history) goes back to being a guest,
-- and the account gets a fresh pending request so the admin can approve it again correctly.
create or replace function public.unlink_member(p_player uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  pl   players%rowtype;
  acc  uuid;
  nm   text;
  pid  uuid;
begin
  select * into pl from players where id = p_player and status = 'active';
  if not found then raise exception 'no such player'; end if;
  if not is_group_admin(pl.group_id) then raise exception 'admins only'; end if;
  if pl.profile_id is null then raise exception 'player has no account'; end if;
  if pl.profile_id = auth.uid() then raise exception 'cannot unlink yourself'; end if;
  if exists (select 1 from games where group_id = pl.group_id and status <> 'closed' and banker_profile_id = pl.profile_id) then
    raise exception 'player is the banker of an open game';
  end if;

  acc := pl.profile_id;
  select display_name into nm from profiles where id = acc;
  -- demote first (the role guard makes sure an admin stays in the group)
  update players set role = 'member' where id = pl.id and role = 'admin';
  update players set profile_id = null, is_guest = true where id = pl.id;
  insert into players (group_id, profile_id, display_name, role, status)
  values (pl.group_id, acc, coalesce(nm, pl.display_name), 'member', 'pending')
  returning id into pid;
  return pid;
end $$;

revoke all on function public.unlink_member(uuid) from public, anon;
grant execute on function public.unlink_member(uuid) to authenticated;
