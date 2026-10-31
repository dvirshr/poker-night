-- Cancel a night opened by mistake (wrong type, test, duplicate).
-- Nothing is deleted: the night, its seats and every ledger line stay as they were.
-- A cancelled night is frozen (no more entries, no closing) and never counts:
-- stats, league and history only read closed nights.

alter table public.games drop constraint if exists games_status_check;
alter table public.games add constraint games_status_check
  check (status in ('open', 'counting', 'closed', 'cancelled'));
alter table public.games
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by uuid references public.profiles(id);

-- 1. cancel_game: the banker or a group admin, while the night is still open or counting.
create or replace function public.cancel_game(p_game uuid)
returns void language plpgsql security definer set search_path = public as $$
declare gm games%rowtype;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into gm from games where id = p_game for update;
  if not found then raise exception 'no such game'; end if;
  if gm.banker_profile_id <> auth.uid() and not is_group_admin(gm.group_id) then
    raise exception 'only the banker or a group admin can cancel a game';
  end if;
  if gm.status = 'closed' then raise exception 'game is closed and cannot be changed'; end if;
  if gm.status = 'cancelled' then raise exception 'game is cancelled'; end if;
  perform set_config('app.cancelling', 'on', true);
  update games set status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid() where id = p_game;
  perform set_config('app.cancelling', 'off', true);
end $$;
revoke all on function public.cancel_game(uuid) from public, anon;
grant execute on function public.cancel_game(uuid) to authenticated;

-- 2. a cancelled night is frozen; and only cancel_game() may cancel
create or replace function public.games_cancel_guard()
returns trigger language plpgsql as $$
begin
  if old.status = 'cancelled' then raise exception 'game is cancelled'; end if;
  if new.status = 'cancelled' and coalesce(current_setting('app.cancelling', true), '') <> 'on' then
    raise exception 'use cancel_game() to cancel a game';
  end if;
  return new;
end $$;
drop trigger if exists games_cancel_guard on public.games;
create trigger games_cancel_guard before update on public.games
  for each row execute function public.games_cancel_guard();

create or replace function public.child_of_cancelled_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from games where id = (case when tg_op = 'DELETE' then old.game_id else new.game_id end)
             and status = 'cancelled') then
    raise exception 'game is cancelled';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
drop trigger if exists ledger_cancelled_guard on public.ledger_entries;
create trigger ledger_cancelled_guard before insert on public.ledger_entries
  for each row execute function public.child_of_cancelled_guard();
drop trigger if exists game_players_cancelled_guard on public.game_players;
create trigger game_players_cancelled_guard before insert or update on public.game_players
  for each row execute function public.child_of_cancelled_guard();
drop trigger if exists blinds_cancelled_guard on public.blind_levels;
create trigger blinds_cancelled_guard before insert or update or delete on public.blind_levels
  for each row execute function public.child_of_cancelled_guard();
drop trigger if exists draws_cancelled_guard on public.game_draws;
create trigger draws_cancelled_guard before insert on public.game_draws
  for each row execute function public.child_of_cancelled_guard();

-- 3. "open game" now means open or counting (a cancelled night no longer blocks anyone)
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
  if exists (select 1 from games where group_id = pl.group_id and status in ('open', 'counting') and banker_profile_id = pl.profile_id) then
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

create or replace function public.delete_account()
returns void language plpgsql security definer set search_path = public, auth as $$
declare
  me uuid := auth.uid();
  g  record;
begin
  if me is null then raise exception 'not signed in'; end if;

  -- an open night needs its banker: hand it over (or close it) first
  if exists (select 1 from games where status in ('open', 'counting') and banker_profile_id = me) then
    raise exception 'account is the banker of an open game';
  end if;

  -- the only admin of a group that still has other accounts: appoint another admin first
  for g in
    select p.group_id from players p
    where p.profile_id = me and p.status = 'active' and p.role = 'admin'
      and not exists (select 1 from players o where o.group_id = p.group_id and o.id <> p.id
                      and o.role = 'admin' and o.status = 'active')
      and exists (select 1 from players o where o.group_id = p.group_id and o.id <> p.id
                  and o.status = 'active' and o.profile_id is not null)
  loop
    raise exception 'account is the only admin of a group';
  end loop;

  -- active memberships: the player (and all its history) stays, as a guest
  update players set role = 'member' where profile_id = me and role = 'admin';
  update players set profile_id = null, is_guest = true where profile_id = me and status = 'active';
  -- pending requests: no history, just withdrawn
  update players set profile_id = null, status = 'left' where profile_id = me;

  -- invite codes the account created stop working (the rows stay: they record who invited)
  update group_invites set expires_at = least(expires_at, now()) where created_by = me;

  update profiles set deleted_at = now() where id = me;
  delete from auth.users where id = me;
end $$;
