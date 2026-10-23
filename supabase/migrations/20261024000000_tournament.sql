-- Tournament mode: blind clock, eliminations, places and prize payout.
--
-- Clock model (every phone computes the same picture from two timestamps):
--   clock_anchor    = the moment level 1 would have started if the clock never paused
--   clock_paused_at = set while paused; elapsed = (paused_at ?? now) - anchor
-- Pause / resume / skip level only move these two values. No ticking on the server.

alter table public.games
  add column if not exists clock_anchor    timestamptz,
  add column if not exists clock_paused_at timestamptz,
  add column if not exists blinds_rev      integer not null default 0;  -- bumped when the blind structure changes, so every phone reloads

-- elimination order while playing; finish_place is written once, when the tournament closes
alter table public.game_players
  add column if not exists eliminated_at timestamptz;

-- prizes by place: largest remainder on whole shekels, ties go to the better place.
-- Integer arithmetic only, identical to tournamentPrizes() in the app.
create or replace function public.tournament_prizes(p_pot integer, p_pct integer[])
returns integer[] language plpgsql immutable as $$
declare
  n    integer := cardinality(p_pct);
  base integer[] := array[]::integer[];
  rem  integer[] := array[]::integer[];
  lft  integer;
  i    integer;
begin
  for i in 1..n loop
    base := base || ((p_pot * p_pct[i]) / 100);
    rem  := rem  || ((p_pot * p_pct[i]) % 100);
  end loop;
  lft := p_pot - public.int_array_sum(base);
  for i in select k from generate_subscripts(rem, 1) k order by rem[k] desc, k asc limit greatest(lft, 0) loop
    base[i] := base[i] + 1;
  end loop;
  return base;
end $$;

-- close a tournament in one transaction: places, prize rows in the ledger, settlements, lock.
--   p_order       = player ids from 1st place to last
--   p_payout      = percentages per paid place, sum 100
--   p_settlements = same shape as close_game()
create or replace function public.close_tournament(p_game uuid, p_order uuid[], p_payout integer[], p_settlements jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  gm     games%rowtype;
  n      integer;
  pot    integer;
  prizes integer[];
  i      integer;
begin
  select * into gm from games where id = p_game for update;
  if not found then raise exception 'game not found'; end if;
  if gm.banker_profile_id <> auth.uid() then raise exception 'only the banker closes the game'; end if;
  if gm.status = 'closed' then raise exception 'game already closed'; end if;
  if gm.game_type <> 'tournament' then raise exception 'not a tournament'; end if;

  select count(*) into n from game_players where game_id = p_game;
  if coalesce(cardinality(p_order), 0) <> n
     or (select count(distinct x) from unnest(p_order) x) <> n
     or exists (select 1 from unnest(p_order) x
                where x not in (select player_id from game_players where game_id = p_game)) then
    raise exception 'finish order must list every player exactly once';
  end if;
  if p_payout is null or cardinality(p_payout) < 1 or cardinality(p_payout) > n
     or public.int_array_sum(p_payout) <> 100 or not (0 < all (p_payout)) then
    raise exception 'payout percentages must be positive, sum to 100 and not exceed the number of players';
  end if;
  if exists (select 1 from active_entries where game_id = p_game and type in ('cash_out', 'adjustment')) then
    raise exception 'tournament already has counts; reverse them first';
  end if;

  select coalesce(sum(amount_ils), 0)::int into pot
    from active_entries where game_id = p_game and type in ('buy_in', 'rebuy');
  prizes := public.tournament_prizes(pot, p_payout);

  update games set payout_pct = p_payout where id = p_game;
  update game_players set finish_place = null where game_id = p_game;
  for i in 1..n loop
    update game_players set finish_place = i where game_id = p_game and player_id = p_order[i];
    insert into ledger_entries (game_id, player_id, type, amount_ils, note)
    values (p_game, p_order[i], 'cash_out', case when i <= cardinality(prizes) then prizes[i] else 0 end, 'מקום ' || i);
  end loop;

  perform public.close_game(p_game, p_settlements);
end $$;

revoke all on function public.close_tournament(uuid, uuid[], integer[], jsonb) from public, anon;
grant execute on function public.close_tournament(uuid, uuid[], integer[], jsonb) to authenticated;
grant execute on function public.tournament_prizes(integer, integer[]) to authenticated;

-- league split by game type (cash nights vs tournaments); league_table stays the overall one
create or replace view public.league_by_type with (security_invoker = true) as
with closed as (
  select t.*, g.group_id, g.game_type,
         rank() over (partition by t.game_id order by t.net desc) as net_rank
  from public.game_player_totals t
  join public.games g on g.id = t.game_id
  where g.status = 'closed'
)
select c.group_id,
       c.game_type,
       c.player_id,
       c.display_name,
       count(*)::int                                   as games_played,
       sum(c.net)::int                                 as net_total,
       round(avg(c.net))::int                          as net_avg,
       count(*) filter (where (c.game_type = 'cash' and c.net_rank = 1 and c.net > 0)
                           or (c.game_type = 'tournament' and c.finish_place = 1))::int as wins,
       count(*) filter (where c.game_type = 'tournament' and c.finish_place <= 3)::int as podiums
from closed c
group by c.group_id, c.game_type, c.player_id, c.display_name;
grant select on public.league_by_type to authenticated;
