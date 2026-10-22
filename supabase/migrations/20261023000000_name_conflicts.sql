-- Name conflicts when a friend joins after being added by hand as a guest.
--   * Same name as a GUEST (no account): the request goes to the admin, who either links it
--     to the guest (keeps the guest's history) or approves it as a different person with a new name.
--   * Same name as a member WITH an account: clearly someone else, so the joiner is asked
--     to pick a different name.

-- pending requests may share a name with an existing player; active players stay unique
alter table public.players drop constraint if exists players_group_id_display_name_key;
create unique index if not exists players_active_name_unique
  on public.players (group_id, display_name) where status <> 'pending';

create or replace function public.join_group(p_code text, p_display_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  inv  group_invites%rowtype;
  pid  uuid;
  nm   text := btrim(coalesce(p_display_name, ''));
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if nm = '' then raise exception 'name required'; end if;
  select * into inv from group_invites where code = btrim(p_code) and expires_at > now();
  if not found then raise exception 'invite code is invalid or expired'; end if;

  select id into pid from players where group_id = inv.group_id and profile_id = auth.uid();
  if pid is not null then return pid; end if;

  if exists (select 1 from players where group_id = inv.group_id and display_name = nm
               and status <> 'pending' and profile_id is not null) then
    raise exception 'name taken by another member';
  end if;

  insert into players (group_id, profile_id, display_name, role, status)
  values (inv.group_id, auth.uid(), nm, 'member', 'pending')
  returning id into pid;
  return pid;
end $$;

drop function if exists public.approve_member(uuid, uuid);
create or replace function public.approve_member(p_pending uuid, p_link_guest uuid default null, p_new_name text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  pend  players%rowtype;
  guest players%rowtype;
  nm    text;
begin
  select * into pend from players where id = p_pending and status = 'pending';
  if not found then raise exception 'no such pending member'; end if;
  if not is_group_admin(pend.group_id) then raise exception 'admins only'; end if;

  if p_link_guest is not null then
    select * into guest from players where id = p_link_guest and group_id = pend.group_id
                                         and profile_id is null and status = 'active';
    if not found then raise exception 'guest player not found in this group'; end if;
    delete from players where id = pend.id;          -- pending rows are never referenced by games
    update players set profile_id = pend.profile_id, is_guest = false where id = guest.id;
    return guest.id;
  end if;

  nm := btrim(coalesce(nullif(btrim(p_new_name), ''), pend.display_name));
  if exists (select 1 from players where group_id = pend.group_id and display_name = nm
               and status <> 'pending' and id <> pend.id) then
    raise exception 'name already in use in this group';
  end if;
  update players set status = 'active', display_name = nm where id = pend.id;
  return pend.id;
end $$;

revoke all on function public.approve_member(uuid, uuid, text) from public, anon;
grant execute on function public.approve_member(uuid, uuid, text) to authenticated;
