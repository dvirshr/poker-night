-- Banker handover: the current banker can now pass the role on (before: group admins only).
-- Admins still can, e.g. when the banker already left. The new banker must be an active group member with an account.
create or replace function public.games_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  g_mode text;
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then
      new.created_by := auth.uid();
      if not is_group_member(new.group_id) then
        raise exception 'not a member of this group';
      end if;
      select banker_mode into g_mode from groups where id = new.group_id;
      if g_mode = 'opener_is_banker' then
        new.banker_profile_id := auth.uid();
      elsif not is_group_admin(new.group_id) then
        raise exception 'only a group admin can open a game in this group';
      end if;
    end if;
    if not exists (select 1 from players where group_id = new.group_id
                   and profile_id = new.banker_profile_id and status = 'active') then
      raise exception 'banker must be an active member of the group';
    end if;
    new.status := 'open';
    new.closed_at := null;
    return new;
  end if;

  -- UPDATE
  if old.status = 'closed' then
    raise exception 'game is closed and cannot be changed';
  end if;
  if new.group_id <> old.group_id or new.game_type <> old.game_type or new.created_by <> old.created_by then
    raise exception 'group, type and creator are immutable';
  end if;
  if (new.buy_in_ils <> old.buy_in_ils or new.start_stack_chips is distinct from old.start_stack_chips)
     and exists (select 1 from ledger_entries where game_id = old.id) then
    raise exception 'buy-in and starting stack are locked once money was entered';
  end if;
  if new.status = 'closed' and coalesce(current_setting('app.closing', true), '') <> 'on' then
    raise exception 'use close_game() to close a game';
  end if;
  if new.banker_profile_id <> old.banker_profile_id then
    if auth.uid() is not null and not (is_group_admin(old.group_id) or old.banker_profile_id = auth.uid()) then
      raise exception 'only the banker or a group admin can hand over the banker role';
    end if;
    if not exists (select 1 from players where group_id = old.group_id
                   and profile_id = new.banker_profile_id and status = 'active') then
      raise exception 'banker must be an active member of the group';
    end if;
  end if;
  return new;
end $$;
