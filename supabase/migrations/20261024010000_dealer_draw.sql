-- Dealer draw: the server picks, so nobody (the banker included) can steer the result.
-- Every draw is kept; a redraw is a new numbered row that everyone sees.

create table if not exists public.game_draws (
  id        uuid primary key default gen_random_uuid(),
  game_id   uuid not null references public.games(id) on delete restrict,
  player_id uuid not null references public.players(id) on delete restrict,
  draw_no   integer not null check (draw_no > 0),
  pool      integer not null check (pool > 0),   -- how many players were in the draw
  drawn_by  uuid not null default auth.uid() references public.profiles(id),
  drawn_at  timestamptz not null default now(),
  unique (game_id, draw_no)
);
alter table public.game_draws enable row level security;

drop policy if exists draws_read on public.game_draws;
create policy draws_read on public.game_draws for select to authenticated
  using (public.is_group_member(public.game_group(game_id)));
-- no insert/update/delete policies: rows are written only by draw_dealer()
revoke insert, update, delete, truncate on public.game_draws from anon, authenticated;

drop trigger if exists game_draws_append_only on public.game_draws;
create trigger game_draws_append_only before update or delete on public.game_draws
  for each row execute function public.append_only();

-- uniform pick among the players still at the table (not counted out, not eliminated).
-- gen_random_uuid() uses the server's cryptographic random source.
create or replace function public.draw_dealer(p_game uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  gm   games%rowtype;
  pick uuid;
  n    integer;
  no   integer;
begin
  select * into gm from games where id = p_game for update;
  if not found then raise exception 'game not found'; end if;
  if gm.banker_profile_id <> auth.uid() then raise exception 'only the banker can draw the dealer'; end if;
  if gm.status = 'closed' then raise exception 'game is closed'; end if;

  select count(*) into n
    from game_players gp
   where gp.game_id = p_game and gp.eliminated_at is null
     and not exists (select 1 from active_entries e where e.game_id = p_game and e.player_id = gp.player_id and e.type = 'cash_out');
  if n < 2 then raise exception 'need at least 2 players at the table to draw'; end if;

  select gp.player_id into pick
    from game_players gp
   where gp.game_id = p_game and gp.eliminated_at is null
     and not exists (select 1 from active_entries e where e.game_id = p_game and e.player_id = gp.player_id and e.type = 'cash_out')
   order by gen_random_uuid()
   limit 1;

  select coalesce(max(draw_no), 0) + 1 into no from game_draws where game_id = p_game;
  insert into game_draws (game_id, player_id, draw_no, pool) values (p_game, pick, no, n);
  return pick;
end $$;

revoke all on function public.draw_dealer(uuid) from public, anon;
grant execute on function public.draw_dealer(uuid) to authenticated;
grant select on public.game_draws to authenticated;

-- every phone at the table sees the draw live
do $$ begin
  alter publication supabase_realtime add table public.game_draws;
exception when duplicate_object then null; end $$;

-- check: should return true, true
select exists (select 1 from pg_tables where tablename = 'game_draws') as draws_ok,
       exists (select 1 from pg_proc where proname = 'draw_dealer') as draw_fn_ok;
