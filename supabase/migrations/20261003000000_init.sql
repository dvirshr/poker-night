-- =====================================================================
-- Poker night app — initial schema (wave 1 + tournament tables)
-- Principles:
--   * All money in whole shekels (integer).
--   * ledger_entries / settlements are append-only. Corrections = reversal rows.
--   * Only the game's banker writes to a game. Every group member reads it.
--   * A group's data is visible only to its active members (RLS).
-- =====================================================================

-- ---------- helpers ----------
create or replace function public.int_array_sum(a integer[])
returns integer language sql immutable as
$$ select coalesce(sum(x), 0)::int from unnest(a) as x $$;

-- ---------- tables ----------
create table public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (length(btrim(display_name)) between 1 and 40),
  created_at   timestamptz not null default now()
);

create table public.groups (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(btrim(name)) between 1 and 60),
  banker_mode text not null default 'opener_is_banker'
              check (banker_mode in ('admin_assigns', 'opener_is_banker')),
  created_by  uuid not null default auth.uid() references public.profiles(id),
  created_at  timestamptz not null default now()
);

create table public.players (
  id           uuid primary key default gen_random_uuid(),
  group_id     uuid not null references public.groups(id) on delete restrict,
  profile_id   uuid references public.profiles(id) on delete set null,
  display_name text not null check (length(btrim(display_name)) between 1 and 40),
  role         text not null default 'member' check (role in ('admin', 'member')),
  status       text not null default 'active' check (status in ('pending', 'active', 'left')),
  is_guest     boolean not null default false,
  created_at   timestamptz not null default now(),
  unique (group_id, display_name),
  unique (group_id, profile_id)
);

create table public.group_invites (
  code       text primary key default substr(replace(gen_random_uuid()::text, '-', ''), 1, 10),
  group_id   uuid not null references public.groups(id) on delete cascade,
  created_by uuid not null default auth.uid() references public.profiles(id),
  expires_at timestamptz not null default now() + interval '7 days',
  created_at timestamptz not null default now()
);

create table public.games (
  id                uuid primary key default gen_random_uuid(),
  group_id          uuid not null references public.groups(id) on delete restrict,
  name              text not null default 'ערב פוקר',
  played_on         date not null default current_date,
  game_type         text not null default 'cash' check (game_type in ('cash', 'tournament')),
  settlement_mode   text not null default 'ledger' check (settlement_mode in ('cash_on_table', 'ledger')),
  buy_in_ils        integer not null check (buy_in_ils > 0),
  start_stack_chips integer check (start_stack_chips > 0),
  max_rebuys        integer not null default 3 check (max_rebuys between 3 and 7),
  rebuy_policy      text not null default 'all_night' check (rebuy_policy in ('all_night', 'until_time', 'none')),
  rebuy_until       timestamptz,
  quick_rebuys      integer[] not null default '{60,120,240}',
  payout_pct        integer[],
  status            text not null default 'open' check (status in ('open', 'counting', 'closed')),
  banker_profile_id uuid not null references public.profiles(id),
  created_by        uuid not null default auth.uid() references public.profiles(id),
  created_at        timestamptz not null default now(),
  closed_at         timestamptz,
  constraint cash_needs_stack  check (game_type <> 'cash' or start_stack_chips is not null),
  constraint until_needs_time  check (rebuy_policy <> 'until_time' or rebuy_until is not null),
  constraint tournament_payout check (
    game_type <> 'tournament'
    or (payout_pct is not null
        and cardinality(payout_pct) >= 1
        and public.int_array_sum(payout_pct) = 100
        and 0 < all (payout_pct)))
);

create table public.game_players (
  id           uuid primary key default gen_random_uuid(),
  game_id      uuid not null references public.games(id) on delete restrict,
  player_id    uuid not null references public.players(id) on delete restrict,
  seat_no      integer,
  finish_place integer check (finish_place > 0),
  joined_at    timestamptz not null default now(),
  left_at      timestamptz,
  unique (game_id, player_id),
  unique (game_id, finish_place)
);

create table public.ledger_entries (
  id                uuid primary key default gen_random_uuid(),  -- client may supply (offline idempotency)
  game_id           uuid not null references public.games(id) on delete restrict,
  player_id         uuid not null references public.players(id) on delete restrict,
  type              text not null check (type in ('buy_in', 'rebuy', 'cash_out', 'reversal', 'adjustment')),
  amount_ils        integer not null,
  chips_count       integer check (chips_count >= 0),
  reverses_entry_id uuid references public.ledger_entries(id),
  note              text,
  created_at        timestamptz not null default now(),
  created_by        uuid default auth.uid(),
  constraint amount_by_type check (
       (type in ('buy_in', 'rebuy') and amount_ils > 0)
    or (type = 'cash_out'   and amount_ils >= 0)
    or (type = 'adjustment' and amount_ils <> 0 and note is not null)
    or (type = 'reversal')),
  constraint reversal_ref check ((type = 'reversal') = (reverses_entry_id is not null))
);
-- an entry can be reversed once
create unique index ledger_one_reversal on public.ledger_entries (reverses_entry_id)
  where reverses_entry_id is not null;
create index ledger_by_game on public.ledger_entries (game_id, player_id);

create table public.settlements (
  id             uuid primary key default gen_random_uuid(),
  game_id        uuid not null references public.games(id) on delete restrict,
  from_player_id uuid references public.players(id),          -- null = paid from the pot
  to_player_id   uuid not null references public.players(id),
  amount_ils     integer not null check (amount_ils > 0),
  method         text not null check (method in ('from_pot', 'transfer')),
  created_at     timestamptz not null default now(),
  check ((method = 'from_pot') = (from_player_id is null)),
  check (from_player_id is distinct from to_player_id)
);

create table public.blind_levels (
  id           uuid primary key default gen_random_uuid(),
  game_id      uuid not null references public.games(id) on delete cascade,
  level_no     integer not null check (level_no > 0),
  small_blind  integer not null check (small_blind > 0),
  big_blind    integer not null check (big_blind >= small_blind),
  duration_min integer not null check (duration_min > 0),
  unique (game_id, level_no)
);

-- ---------- membership helpers (security definer: used inside RLS without recursion) ----------
create or replace function public.is_group_member(g uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from players
                 where group_id = g and profile_id = auth.uid() and status = 'active')
$$;

create or replace function public.is_group_admin(g uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from players
                 where group_id = g and profile_id = auth.uid() and status = 'active' and role = 'admin')
$$;

create or replace function public.game_group(gm uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select group_id from games where id = gm
$$;

create or replace function public.is_game_banker(gm uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from games where id = gm and banker_profile_id = auth.uid())
$$;

create or replace function public.shares_group(p uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from players a join players b on a.group_id = b.group_id
                 where a.profile_id = auth.uid() and a.status = 'active'
                   and b.profile_id = p and b.status = 'active')
$$;

-- ---------- triggers: profiles from auth ----------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, display_name)
  values (new.id, coalesce(nullif(btrim(new.raw_user_meta_data->>'full_name'), ''),
                           split_part(coalesce(new.email, 'player'), '@', 1)))
  on conflict (id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- creator of a group becomes its first admin
create or replace function public.group_add_creator()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into players (group_id, profile_id, display_name, role, status)
  select new.id, p.id, p.display_name, 'admin', 'active' from profiles p where p.id = new.created_by;
  return new;
end $$;
create trigger group_add_creator after insert on public.groups
  for each row execute function public.group_add_creator();

create or replace function public.groups_guard()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' and auth.uid() is not null then new.created_by := auth.uid(); end if;
  if tg_op = 'UPDATE' and new.created_by <> old.created_by then
    raise exception 'created_by is immutable';
  end if;
  return new;
end $$;
create trigger groups_guard before insert or update on public.groups
  for each row execute function public.groups_guard();

-- ---------- triggers: games ----------
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
    if auth.uid() is not null and not is_group_admin(old.group_id) then
      raise exception 'only a group admin can hand over the banker role';
    end if;
    if not exists (select 1 from players where group_id = old.group_id
                   and profile_id = new.banker_profile_id and status = 'active') then
      raise exception 'banker must be an active member of the group';
    end if;
  end if;
  return new;
end $$;
create trigger games_guard before insert or update on public.games
  for each row execute function public.games_guard();

create or replace function public.no_delete()
returns trigger language plpgsql as $$
begin
  raise exception '% rows are never deleted', tg_table_name;
end $$;
create trigger games_no_delete before delete on public.games
  for each row execute function public.no_delete();

-- ---------- triggers: game_players ----------
create or replace function public.game_players_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  gm games%rowtype;
begin
  select * into gm from games where id = new.game_id;
  if gm.status = 'closed' then
    raise exception 'game is closed';
  end if;
  if not exists (select 1 from players where id = new.player_id
                 and group_id = gm.group_id and status = 'active') then
    raise exception 'player is not an active member of this game''s group';
  end if;
  if tg_op = 'UPDATE' and (new.game_id <> old.game_id or new.player_id <> old.player_id) then
    raise exception 'game and player are immutable';
  end if;
  return new;
end $$;
create trigger game_players_guard before insert or update on public.game_players
  for each row execute function public.game_players_guard();
create trigger game_players_no_delete before delete on public.game_players
  for each row execute function public.no_delete();

-- ---------- triggers: ledger (the core) ----------
create or replace function public.ledger_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  gm      games%rowtype;
  target  ledger_entries%rowtype;
  n       integer;
  expect  integer;
begin
  if auth.uid() is not null then new.created_by := auth.uid(); end if;
  new.created_at := now();

  select * into gm from games where id = new.game_id;
  if not found then raise exception 'game not found'; end if;

  if gm.status = 'closed' then
    raise exception 'game is closed';
  end if;
  if not exists (select 1 from game_players where game_id = new.game_id and player_id = new.player_id) then
    raise exception 'player is not seated in this game';
  end if;

  if new.type = 'reversal' then
    select * into target from ledger_entries where id = new.reverses_entry_id;
    if not found or target.game_id <> new.game_id or target.player_id <> new.player_id then
      raise exception 'reversal must point to an entry of the same game and player';
    end if;
    if target.type = 'reversal' then
      raise exception 'a reversal cannot be reversed; enter the correct value instead';
    end if;
    new.amount_ils := target.amount_ils;
    new.chips_count := target.chips_count;
    return new;
  end if;

  if new.type in ('buy_in', 'rebuy') and gm.status <> 'open' then
    raise exception 'no buy-ins once counting started';
  end if;

  if new.type = 'buy_in' then
    select count(*) into n from active_entries
     where game_id = new.game_id and player_id = new.player_id and type = 'buy_in';
    if n > 0 then raise exception 'player already bought in; use rebuy'; end if;
  end if;

  if new.type = 'rebuy' then
    if gm.rebuy_policy = 'none' then
      raise exception 'rebuys are not allowed in this game';
    end if;
    if gm.rebuy_policy = 'until_time' and now() > gm.rebuy_until then
      raise exception 'rebuy window has closed';
    end if;
    select count(*) into n from active_entries
     where game_id = new.game_id and player_id = new.player_id and type = 'buy_in';
    if n = 0 then raise exception 'player must buy in before a rebuy'; end if;
    select count(*) into n from active_entries
     where game_id = new.game_id and player_id = new.player_id and type = 'rebuy';
    if n >= gm.max_rebuys then
      raise exception 'rebuy limit reached (%)', gm.max_rebuys;
    end if;
  end if;

  if new.type = 'cash_out' then
    select count(*) into n from active_entries
     where game_id = new.game_id and player_id = new.player_id and type = 'cash_out';
    if n > 0 then raise exception 'player already counted; reverse the count first'; end if;
    if gm.game_type = 'cash' then
      if new.chips_count is null then
        raise exception 'cash game count needs chips_count';
      end if;
      expect := round(new.chips_count::numeric * gm.buy_in_ils / gm.start_stack_chips);
      if new.amount_ils <> expect then
        raise exception 'amount % does not match % chips (expected %)', new.amount_ils, new.chips_count, expect;
      end if;
    end if;
  end if;

  return new;
end $$;

create or replace function public.append_only()
returns trigger language plpgsql as $$
begin
  raise exception '% is append-only: history is never changed', tg_table_name;
end $$;

-- ---------- views (security_invoker: RLS of the caller applies) ----------
create view public.active_entries with (security_invoker = true) as
select e.*
from public.ledger_entries e
where e.type <> 'reversal'
  and not exists (select 1 from public.ledger_entries r where r.reverses_entry_id = e.id);

create trigger ledger_guard before insert on public.ledger_entries
  for each row execute function public.ledger_guard();
create trigger ledger_append_only before update or delete on public.ledger_entries
  for each row execute function public.append_only();
create trigger settlements_append_only before update or delete on public.settlements
  for each row execute function public.append_only();

create view public.game_player_totals with (security_invoker = true) as
select gp.game_id,
       gp.player_id,
       p.display_name,
       gp.finish_place,
       coalesce(sum(e.amount_ils) filter (where e.type in ('buy_in', 'rebuy')), 0)::int    as total_in,
       count(e.id) filter (where e.type = 'rebuy')::int                                   as rebuys,
       coalesce(bool_or(e.type = 'cash_out'), false)                                      as counted,
       max(e.chips_count) filter (where e.type = 'cash_out')                               as chips_count,
       coalesce(sum(e.amount_ils) filter (where e.type in ('cash_out', 'adjustment')), 0)::int as total_out,
       (coalesce(sum(e.amount_ils) filter (where e.type in ('cash_out', 'adjustment')), 0)
        - coalesce(sum(e.amount_ils) filter (where e.type in ('buy_in', 'rebuy')), 0))::int    as net
from public.game_players gp
join public.players p on p.id = gp.player_id
left join public.active_entries e on e.game_id = gp.game_id and e.player_id = gp.player_id
group by gp.game_id, gp.player_id, p.display_name, gp.finish_place;

create view public.game_totals with (security_invoker = true) as
select g.id as game_id,
       g.group_id,
       g.status,
       count(t.player_id)::int                     as players,
       coalesce(sum(t.total_in), 0)::int           as pot,
       coalesce(sum(t.total_out), 0)::int          as total_out,
       (coalesce(sum(t.total_out), 0) - coalesce(sum(t.total_in), 0))::int as gap,
       coalesce(bool_and(t.counted), false)        as all_counted
from public.games g
left join public.game_player_totals t on t.game_id = g.id
group by g.id, g.group_id, g.status;

create view public.league_table with (security_invoker = true) as
with closed as (
  select t.*, g.group_id, g.game_type,
         rank() over (partition by t.game_id order by t.net desc) as net_rank
  from public.game_player_totals t
  join public.games g on g.id = t.game_id
  where g.status = 'closed'
)
select c.group_id,
       c.player_id,
       c.display_name,
       count(*)::int                                   as games_played,
       sum(c.net)::int                                 as net_total,
       round(avg(c.net))::int                          as net_avg,
       count(*) filter (where (c.game_type = 'cash' and c.net_rank = 1 and c.net > 0)
                           or (c.game_type = 'tournament' and c.finish_place = 1))::int as wins
from closed c
group by c.group_id, c.player_id, c.display_name;

-- ---------- RPCs ----------
-- join a group with an invite code; admin approval needed (status = pending)
create or replace function public.join_group(p_code text, p_display_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  inv group_invites%rowtype;
  pid uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into inv from group_invites where code = p_code and expires_at > now();
  if not found then raise exception 'invite code is invalid or expired'; end if;
  select id into pid from players where group_id = inv.group_id and profile_id = auth.uid();
  if pid is not null then return pid; end if;
  insert into players (group_id, profile_id, display_name, role, status)
  values (inv.group_id, auth.uid(), btrim(p_display_name), 'member', 'pending')
  returning id into pid;
  return pid;
end $$;

-- admin approves a pending member; optionally links them to an existing guest ("I am Ron")
create or replace function public.approve_member(p_pending uuid, p_link_guest uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  pend players%rowtype;
  guest players%rowtype;
begin
  select * into pend from players where id = p_pending and status = 'pending';
  if not found then raise exception 'no such pending member'; end if;
  if not is_group_admin(pend.group_id) then raise exception 'admins only'; end if;
  if p_link_guest is null then
    update players set status = 'active' where id = pend.id;
    return pend.id;
  end if;
  select * into guest from players where id = p_link_guest and group_id = pend.group_id
                                       and profile_id is null and status = 'active';
  if not found then raise exception 'guest player not found in this group'; end if;
  delete from players where id = pend.id;          -- pending rows are never referenced by games
  update players set profile_id = pend.profile_id, is_guest = false where id = guest.id;
  return guest.id;
end $$;

-- close a game: validates balance and settlements, writes them, locks the game
create or replace function public.close_game(p_game uuid, p_settlements jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  gm   games%rowtype;
  tot  record;
  bad  record;
begin
  select * into gm from games where id = p_game for update;
  if not found then raise exception 'game not found'; end if;
  if gm.banker_profile_id <> auth.uid() then raise exception 'only the banker closes the game'; end if;
  if gm.status = 'closed' then raise exception 'game already closed'; end if;

  select * into tot from game_totals where game_id = p_game;
  if tot.players < 2 then raise exception 'a game needs at least 2 players'; end if;
  if not tot.all_counted then raise exception 'every player must be counted first'; end if;
  if tot.gap <> 0 then raise exception 'pot is not balanced (gap % ILS)', tot.gap; end if;

  create temp table _s on commit drop as
  select (x->>'from_player_id')::uuid as from_player_id,
         (x->>'to_player_id')::uuid   as to_player_id,
         (x->>'amount_ils')::int      as amount_ils,
         x->>'method'                 as method
  from jsonb_array_elements(coalesce(p_settlements, '[]'::jsonb)) x;

  if exists (select 1 from _s where method <> case gm.settlement_mode
                                                 when 'cash_on_table' then 'from_pot' else 'transfer' end) then
    raise exception 'settlement method does not match the game''s settlement mode';
  end if;

  -- each player's settlements must equal exactly what the ledger says
  select t.display_name, t.net, t.total_out,
         coalesce((select sum(amount_ils) from _s where to_player_id = t.player_id), 0) as got,
         coalesce((select sum(amount_ils) from _s where from_player_id = t.player_id), 0) as gave
  into bad
  from game_player_totals t
  where t.game_id = p_game
    and (case gm.settlement_mode
           when 'cash_on_table' then
             coalesce((select sum(amount_ils) from _s where to_player_id = t.player_id), 0) <> t.total_out
           else
             coalesce((select sum(amount_ils) from _s where to_player_id = t.player_id), 0)
           - coalesce((select sum(amount_ils) from _s where from_player_id = t.player_id), 0) <> t.net
         end)
  limit 1;
  if found then
    raise exception 'settlements do not match the ledger for %', bad.display_name;
  end if;
  if exists (select 1 from _s s where s.to_player_id not in (select player_id from game_players where game_id = p_game)
                                   or (s.from_player_id is not null
                                       and s.from_player_id not in (select player_id from game_players where game_id = p_game))) then
    raise exception 'settlement refers to a player outside this game';
  end if;

  insert into settlements (game_id, from_player_id, to_player_id, amount_ils, method)
  select p_game, from_player_id, to_player_id, amount_ils, method from _s;

  perform set_config('app.closing', 'on', true);
  update games set status = 'closed', closed_at = now() where id = p_game;
  perform set_config('app.closing', 'off', true);
end $$;

-- ---------- privileges ----------
revoke update, delete, truncate on public.ledger_entries from anon, authenticated;
revoke insert, update, delete, truncate on public.settlements from anon, authenticated;
revoke delete, truncate on public.games, public.game_players from anon, authenticated;
revoke all on function public.close_game(uuid, jsonb), public.join_group(text, text),
                       public.approve_member(uuid, uuid) from public, anon;
grant execute on function public.close_game(uuid, jsonb), public.join_group(text, text),
                          public.approve_member(uuid, uuid) to authenticated;

-- ---------- RLS ----------
alter table public.profiles       enable row level security;
alter table public.groups         enable row level security;
alter table public.players        enable row level security;
alter table public.group_invites  enable row level security;
alter table public.games          enable row level security;
alter table public.game_players   enable row level security;
alter table public.ledger_entries enable row level security;
alter table public.settlements    enable row level security;
alter table public.blind_levels   enable row level security;

create policy profiles_read   on public.profiles for select to authenticated
  using (id = auth.uid() or public.shares_group(id));
create policy profiles_insert on public.profiles for insert to authenticated with check (id = auth.uid());
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- created_by: lets the creator read back the row it just inserted (insert ... returning)
create policy groups_read   on public.groups for select to authenticated
  using (public.is_group_member(id) or created_by = auth.uid());
create policy groups_insert on public.groups for insert to authenticated with check (created_by = auth.uid());
create policy groups_update on public.groups for update to authenticated
  using (public.is_group_admin(id)) with check (public.is_group_admin(id));

create policy players_read on public.players for select to authenticated
  using (public.is_group_member(group_id) or profile_id = auth.uid());
-- admins add anyone; members may add a guest (late arrival who has no account)
create policy players_insert on public.players for insert to authenticated
  with check (public.is_group_admin(group_id)
              or (public.is_group_member(group_id) and profile_id is null and role = 'member'
                  and status = 'active' and is_guest));
create policy players_update on public.players for update to authenticated
  using (public.is_group_admin(group_id)) with check (public.is_group_admin(group_id));

create policy invites_admin on public.group_invites for all to authenticated
  using (public.is_group_admin(group_id)) with check (public.is_group_admin(group_id));

create policy games_read   on public.games for select to authenticated using (public.is_group_member(group_id));
create policy games_insert on public.games for insert to authenticated with check (public.is_group_member(group_id));
create policy games_update on public.games for update to authenticated
  using (banker_profile_id = auth.uid() or public.is_group_admin(group_id))
  with check (public.is_group_member(group_id));

create policy gp_read  on public.game_players for select to authenticated
  using (public.is_group_member(public.game_group(game_id)));
create policy gp_write on public.game_players for insert to authenticated
  with check (public.is_game_banker(game_id));
create policy gp_update on public.game_players for update to authenticated
  using (public.is_game_banker(game_id)) with check (public.is_game_banker(game_id));

create policy ledger_read  on public.ledger_entries for select to authenticated
  using (public.is_group_member(public.game_group(game_id)));
create policy ledger_write on public.ledger_entries for insert to authenticated
  with check (public.is_game_banker(game_id));

create policy settlements_read on public.settlements for select to authenticated
  using (public.is_group_member(public.game_group(game_id)));

create policy blinds_read  on public.blind_levels for select to authenticated
  using (public.is_group_member(public.game_group(game_id)));
create policy blinds_write on public.blind_levels for all to authenticated
  using (public.is_game_banker(game_id)) with check (public.is_game_banker(game_id));

-- ---------- realtime: every member sees the table live ----------
alter publication supabase_realtime add table
  public.games, public.game_players, public.ledger_entries, public.settlements;
