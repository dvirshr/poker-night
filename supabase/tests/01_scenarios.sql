-- Integration tests on a real Postgres with the Supabase stub.
-- Scenario = the sample evening from the mockups: 6 players, buy-in 120, pot 840.
\set ON_ERROR_STOP 1
\pset pager off

create schema if not exists test;
create or replace function test.ok(cond boolean, label text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FAIL: %', label; end if;
  raise notice 'ok   %', label;
end $$;
create or replace function test.fails(q text, pattern text, label text) returns void language plpgsql as $$
begin
  begin
    execute q;
  exception when others then
    if sqlerrm ilike '%' || pattern || '%' then
      raise notice 'ok   % (blocked: %)', label, sqlerrm;
      return;
    end if;
    raise exception 'FAIL: % (wrong error: %)', label, sqlerrm;
  end;
  raise exception 'FAIL: % (was not blocked)', label;
end $$;
grant usage on schema test to authenticated, anon;
grant execute on all functions in schema test to authenticated, anon;

-- users (as Supabase Auth would create them)
insert into auth.users (id, email, raw_user_meta_data) values
 ('00000000-0000-0000-0000-00000000000a', 'avi@x.com',  '{"full_name":"אבי"}'),
 ('00000000-0000-0000-0000-00000000000b', 'ron@x.com',  '{"full_name":"רון"}'),
 ('00000000-0000-0000-0000-00000000000c', 'ido@x.com',  '{"full_name":"עידו"}'),
 ('00000000-0000-0000-0000-00000000000d', 'gal@x.com',  '{"full_name":"גל"}'),
 ('00000000-0000-0000-0000-00000000000e', 'maya@x.com', '{"full_name":"מאיה"}'),
 ('00000000-0000-0000-0000-00000000000f', 'tal@x.com',  '{"full_name":"טל"}'),
 ('00000000-0000-0000-0000-000000000099', 'out@x.com',  '{"full_name":"זר"}');

select test.ok((select count(*) from public.profiles) = 7, 'profiles created from auth signup');

set role authenticated;

-- ---------- Avi creates a group ----------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
insert into public.groups (id, name) values ('10000000-0000-0000-0000-000000000001', 'החבר''ה של חמישי');
select test.ok((select role from public.players where profile_id = auth.uid()) = 'admin', 'group creator is admin');
insert into public.group_invites (code, group_id) values ('THURSDAY01', '10000000-0000-0000-0000-000000000001');

-- ---------- others join with the invite, pending until approved ----------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
select public.join_group('THURSDAY01', 'רון');
select test.ok((select count(*) from public.games) = 0 and not public.is_group_member('10000000-0000-0000-0000-000000000001'),
               'pending member sees nothing yet');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', false); select public.join_group('THURSDAY01', 'עידו');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000d', false); select public.join_group('THURSDAY01', 'גל');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000e', false); select public.join_group('THURSDAY01', 'מאיה');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000f', false); select public.join_group('THURSDAY01', 'טל');

reset role;
select id as ido_id from public.players where display_name = 'עידו' \gset
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
select test.fails(format('select public.approve_member(%L)', :'ido_id'),
                  'admins only', 'non-admin cannot approve members');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
select public.approve_member(id) from public.players where status = 'pending';
select test.ok((select count(*) from public.players where status = 'active') = 6, '6 active members after approval');

-- ---------- outsider sees nothing ----------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000099', false);
select test.ok((select count(*) from public.groups) = 0 and (select count(*) from public.players) = 0
               and (select count(*) from public.profiles) = 1, 'outsider sees no group, players or profiles');
select test.fails($$insert into public.games (group_id, buy_in_ils, start_stack_chips, banker_profile_id)
                    values ('10000000-0000-0000-0000-000000000001', 120, 1200, auth.uid())$$,
                  'not a member', 'outsider cannot open a game');

-- ---------- Avi opens a cash game (opener_is_banker) ----------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
insert into public.games (id, group_id, name, buy_in_ils, start_stack_chips, max_rebuys, settlement_mode, banker_profile_id)
values ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'ערב חמישי',
        120, 1200, 3, 'ledger', '00000000-0000-0000-0000-00000000000b');  -- tries to name Ron as banker
select test.ok((select banker_profile_id from public.games) = auth.uid(), 'opener becomes banker regardless of request');

insert into public.game_players (game_id, player_id)
select '20000000-0000-0000-0000-000000000001', id from public.players;

insert into public.ledger_entries (game_id, player_id, type, amount_ils)
select '20000000-0000-0000-0000-000000000001', id, 'buy_in', 120 from public.players;
insert into public.ledger_entries (game_id, player_id, type, amount_ils)
select '20000000-0000-0000-0000-000000000001', id, 'rebuy', 120 from public.players where display_name = 'רון';
select test.ok((select pot from public.game_totals) = 840, 'pot = 840 after 6 buy-ins and 1 rebuy');

-- ---------- non-banker cannot write, but sees live ----------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000f', false);
select test.ok((select pot from public.game_totals) = 840, 'Tal (viewer) sees the live pot');
select test.fails($$insert into public.ledger_entries (game_id, player_id, type, amount_ils)
                    select '20000000-0000-0000-0000-000000000001', id, 'rebuy', 120 from public.players where display_name='טל'$$,
                  'row-level security', 'viewer cannot add money');

-- ---------- integrity rules ----------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
select test.fails($$update public.ledger_entries set amount_ils = 1$$, 'permission denied', 'ledger cannot be updated');
select test.fails($$delete from public.ledger_entries$$, 'permission denied', 'ledger cannot be deleted');
select test.fails($$insert into public.ledger_entries (game_id, player_id, type, amount_ils)
                    select '20000000-0000-0000-0000-000000000001', id, 'buy_in', 120 from public.players where display_name='גל'$$,
                  'already bought in', 'second buy-in blocked');
-- typo: Gal rebuy 1200 instead of 120 -> reversal, then the right amount
insert into public.ledger_entries (id, game_id, player_id, type, amount_ils)
select '30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', id, 'rebuy', 1200
from public.players where display_name = 'גל';
insert into public.ledger_entries (game_id, player_id, type, amount_ils, reverses_entry_id)
select '20000000-0000-0000-0000-000000000001', id, 'reversal', 0, '30000000-0000-0000-0000-000000000001'
from public.players where display_name = 'גל';
select test.ok((select pot from public.game_totals) = 840, 'reversal cancels the typo, history kept');
select test.ok((select count(*) from public.ledger_entries) = 9, 'both typo and reversal remain in the ledger');
select test.fails($$insert into public.ledger_entries (game_id, player_id, type, amount_ils, reverses_entry_id)
                    select '20000000-0000-0000-0000-000000000001', id, 'reversal', 0, '30000000-0000-0000-0000-000000000001'
                    from public.players where display_name='גל'$$,
                  'ledger_one_reversal', 'an entry is reversed only once');
-- same idempotent insert twice (offline retry) -> second one is a no-op
insert into public.ledger_entries (id, game_id, player_id, type, amount_ils)
select '30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', id, 'rebuy', 120
from public.players where display_name = 'רון' on conflict (id) do nothing;
insert into public.ledger_entries (id, game_id, player_id, type, amount_ils)
select '30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', id, 'rebuy', 120
from public.players where display_name = 'רון' on conflict (id) do nothing;
select test.ok((select pot from public.game_totals) = 960, 'offline retry inserted once (pot 960)');
insert into public.ledger_entries (game_id, player_id, type, amount_ils, reverses_entry_id)
select '20000000-0000-0000-0000-000000000001', id, 'reversal', 0, '30000000-0000-0000-0000-000000000002'
from public.players where display_name = 'רון';
select test.ok((select pot from public.game_totals) = 840, 'back to 840');

-- rebuy cap (3): Ron already has 1 active rebuy
insert into public.ledger_entries (game_id, player_id, type, amount_ils)
select '20000000-0000-0000-0000-000000000001', id, 'rebuy', 60 from public.players where display_name = 'עידו';
insert into public.ledger_entries (game_id, player_id, type, amount_ils)
select '20000000-0000-0000-0000-000000000001', id, 'rebuy', 60 from public.players where display_name = 'עידו';
insert into public.ledger_entries (game_id, player_id, type, amount_ils)
select '20000000-0000-0000-0000-000000000001', id, 'rebuy', 60 from public.players where display_name = 'עידו';
select test.fails($$insert into public.ledger_entries (game_id, player_id, type, amount_ils)
                    select '20000000-0000-0000-0000-000000000001', id, 'rebuy', 60 from public.players where display_name='עידו'$$,
                  'rebuy limit reached', '4th rebuy blocked by max_rebuys = 3');
-- undo Ido's three test rebuys
insert into public.ledger_entries (game_id, player_id, type, amount_ils, reverses_entry_id)
select game_id, player_id, 'reversal', 0, id from public.active_entries
where type = 'rebuy' and player_id = (select id from public.players where display_name = 'עידו');
select test.ok((select pot from public.game_totals) = 840, 'pot 840 again');

-- ---------- counting ----------
update public.games set status = 'counting';
select test.fails($$insert into public.ledger_entries (game_id, player_id, type, amount_ils)
                    select '20000000-0000-0000-0000-000000000001', id, 'rebuy', 120 from public.players where display_name='טל'$$,
                  'no buy-ins once counting', 'no rebuy during counting');
select test.fails($$insert into public.ledger_entries (game_id, player_id, type, amount_ils, chips_count)
                    select '20000000-0000-0000-0000-000000000001', id, 'cash_out', 70, 600 from public.players where display_name='גל'$$,
                  'does not match', 'chips -> shekels mismatch rejected (600 chips = 60)');

insert into public.ledger_entries (game_id, player_id, type, amount_ils, chips_count)
select '20000000-0000-0000-0000-000000000001', p.id, 'cash_out', v.ils, v.chips
from public.players p join (values ('מאיה', 2800, 280), ('אבי', 1800, 180), ('טל', 1500, 150),
                                   ('עידו', 1100, 110), ('גל', 600, 60), ('רון', 600, 60)) v(n, chips, ils)
  on v.n = p.display_name;
select test.ok((select gap from public.game_totals) = 0 and (select all_counted from public.game_totals), 'counted and balanced');

select test.fails($$update public.games set status = 'closed'$$, 'use close_game', 'cannot close by plain update');

-- wrong settlements are rejected
select test.fails($$select public.close_game('20000000-0000-0000-0000-000000000001',
  jsonb_build_array(jsonb_build_object('from_player_id', (select id from public.players where display_name='רון'),
                                       'to_player_id',   (select id from public.players where display_name='מאיה'),
                                       'amount_ils', 180, 'method', 'transfer')))$$,
                  'do not match the ledger', 'settlements that do not match the ledger are rejected');

-- the transfers computed by src/core/settle.ts minTransfers() for this evening
select public.close_game('20000000-0000-0000-0000-000000000001', (
  select jsonb_agg(jsonb_build_object('from_player_id', f.id, 'to_player_id', t.id, 'amount_ils', s.amt, 'method', 'transfer'))
  from (values ('רון','מאיה',160), ('גל','אבי',60), ('רון','טל',20), ('עידו','טל',10)) s(fr, tt, amt)
  join public.players f on f.display_name = s.fr
  join public.players t on t.display_name = s.tt));
select test.ok((select status from public.games) = 'closed' and (select count(*) from public.settlements) = 4,
               'game closed with 4 transfers');

-- ---------- after close: frozen ----------
select test.fails($$insert into public.ledger_entries (game_id, player_id, type, amount_ils)
                    select '20000000-0000-0000-0000-000000000001', id, 'adjustment', 10 from public.players where display_name='טל'$$,
                  'game is closed', 'no writes after close');
select test.fails($$update public.games set name = 'x'$$, 'closed', 'closed game cannot be edited');

-- ---------- league ----------
select test.ok((select net_total from public.league_table where display_name = 'מאיה') = 160
               and (select wins from public.league_table where display_name = 'מאיה') = 1, 'league: Maya +160, 1 win');
select test.ok((select sum(net_total) from public.league_table) = 0, 'league nets sum to zero');

-- ---------- a second group stays invisible ----------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000099', false);
-- the app inserts with .select() (RETURNING): must work for the creator
insert into public.groups (id, name, banker_mode) values ('10000000-0000-0000-0000-000000000002', 'קבוצה אחרת', 'admin_assigns') returning id;
select test.ok((select count(*) from public.games) = 0 and (select count(*) from public.groups) = 1,
               'stranger sees only own group');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
select test.ok((select count(*) from public.groups) = 1, 'Avi does not see the other group');

-- ---------- cash on the table: payout from the pot ----------
insert into public.games (id, group_id, buy_in_ils, start_stack_chips, settlement_mode, banker_profile_id)
values ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 100, 1000, 'cash_on_table', auth.uid());
insert into public.game_players (game_id, player_id)
select '20000000-0000-0000-0000-000000000002', id from public.players where display_name in ('אבי', 'רון', 'גל');
insert into public.ledger_entries (game_id, player_id, type, amount_ils)
select '20000000-0000-0000-0000-000000000002', gp.player_id, 'buy_in', 100 from public.game_players gp
where gp.game_id = '20000000-0000-0000-0000-000000000002';
update public.games set status = 'counting' where id = '20000000-0000-0000-0000-000000000002';
-- miscount: 3,050 chips on a 300 pot -> proportional balancing via adjustments (computed by settle.ts)
insert into public.ledger_entries (game_id, player_id, type, amount_ils, chips_count)
select '20000000-0000-0000-0000-000000000002', p.id, 'cash_out', v.ils, v.chips
from public.players p join (values ('אבי', 2030, 203), ('רון', 1020, 102), ('גל', 0, 0)) v(n, chips, ils) on v.n = p.display_name;
select test.ok((select gap from public.game_totals where game_id = '20000000-0000-0000-0000-000000000002') = 5, 'gap of 5 detected');
select test.fails($$select public.close_game('20000000-0000-0000-0000-000000000002', '[]')$$, 'not balanced', 'unbalanced pot cannot close');
insert into public.ledger_entries (game_id, player_id, type, amount_ils, note)
select '20000000-0000-0000-0000-000000000002', p.id, 'adjustment', v.adj, 'איזון יחסי'
from public.players p join (values ('אבי', -3), ('רון', -2)) v(n, adj) on v.n = p.display_name;
select public.close_game('20000000-0000-0000-0000-000000000002', (
  select jsonb_agg(jsonb_build_object('to_player_id', t.id, 'amount_ils', s.amt, 'method', 'from_pot'))
  from (values ('אבי', 200), ('רון', 100)) s(tt, amt) join public.players t on t.display_name = s.tt));
select test.ok((select status from public.games where id = '20000000-0000-0000-0000-000000000002') = 'closed',
               'cash-on-table game closed with payouts from the pot');

reset role;
select 'ALL TESTS PASSED' as result;

-- ---------- invite_info (migration 2): anyone with a valid code sees group + inviter, nothing else ----------
set role anon;
select test.ok((select group_name from public.invite_info('THURSDAY01')) = 'החבר''ה של חמישי'
               and (select inviter from public.invite_info('THURSDAY01')) = 'אבי', 'invite_info shows group and inviter to a signed-out visitor');
select test.ok((select count(*) from public.invite_info('NOSUCHCODE')) = 0, 'invite_info reveals nothing for a wrong code');
select test.ok((select count(*) from public.groups) = 0 and (select count(*) from public.players) = 0
               and (select count(*) from public.ledger_entries) = 0, 'signed-out visitor still sees no groups, players or money');
reset role;
select 'INVITE TESTS PASSED' as result;

-- ---------- banker handover (migration 3) ----------
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
insert into public.games (id, group_id, buy_in_ils, start_stack_chips, banker_profile_id)
values ('20000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', 100, 1000, auth.uid());
insert into public.game_players (game_id, player_id)
select '20000000-0000-0000-0000-000000000003', id from public.players where display_name in ('אבי', 'רון', 'גל');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000d', false);  -- Gal: plain member, not banker
update public.games set banker_profile_id = auth.uid() where id = '20000000-0000-0000-0000-000000000003';  -- RLS: matches 0 rows
reset role;
select test.ok((select banker_profile_id from public.games where id = '20000000-0000-0000-0000-000000000003') = '00000000-0000-0000-0000-00000000000a',
               'a plain player cannot make himself banker (row untouched)');
set role authenticated;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);  -- Avi: banker (and admin)
update public.games set banker_profile_id = '00000000-0000-0000-0000-00000000000b' where id = '20000000-0000-0000-0000-000000000003';
select test.ok((select banker_profile_id from public.games where id = '20000000-0000-0000-0000-000000000003') = '00000000-0000-0000-0000-00000000000b',
               'banker hands over to Ron');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);  -- Ron: banker, NOT admin
update public.games set banker_profile_id = '00000000-0000-0000-0000-00000000000d' where id = '20000000-0000-0000-0000-000000000003';
select test.ok((select banker_profile_id from public.games where id = '20000000-0000-0000-0000-000000000003') = '00000000-0000-0000-0000-00000000000d',
               'a non-admin banker can hand over too (new rule)');
select test.fails($$insert into public.ledger_entries (game_id, player_id, type, amount_ils)
                    select '20000000-0000-0000-0000-000000000003', id, 'buy_in', 100 from public.players where display_name='רון'$$,
                  'row-level security', 'the old banker can no longer enter money');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);  -- Avi: admin takes it back
update public.games set banker_profile_id = auth.uid() where id = '20000000-0000-0000-0000-000000000003';
select test.ok((select banker_profile_id from public.games where id = '20000000-0000-0000-0000-000000000003') = auth.uid(),
               'group admin can always reassign the banker');
select test.fails($$update public.games set banker_profile_id = '00000000-0000-0000-0000-000000000099' where id = '20000000-0000-0000-0000-000000000003'$$,
                  'active member', 'banker must be a member of the group');
reset role;
select 'HANDOVER TESTS PASSED' as result;

-- ---------- early exit: count a player while the game is still open ----------
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);  -- Avi is banker of game 3 again
insert into public.ledger_entries (game_id, player_id, type, amount_ils)
select '20000000-0000-0000-0000-000000000003', id, 'buy_in', 100 from public.players where display_name in ('אבי', 'רון', 'גל');
insert into public.ledger_entries (game_id, player_id, type, amount_ils, chips_count, note)
select '20000000-0000-0000-0000-000000000003', id, 'cash_out', 75, 750, 'יציאה באמצע הערב' from public.players where display_name = 'גל';
select test.ok((select counted and total_out = 75 and net = -25 from public.game_player_totals t join public.players p on p.id = t.player_id
                where t.game_id = '20000000-0000-0000-0000-000000000003' and p.display_name = 'גל'), 'early exit recorded while the game is open (−25)');
select test.ok((select status from public.games where id = '20000000-0000-0000-0000-000000000003') = 'open', 'game stays open for everyone else');
select test.fails($$insert into public.ledger_entries (game_id, player_id, type, amount_ils, chips_count)
                    select '20000000-0000-0000-0000-000000000003', id, 'cash_out', 75, 750 from public.players where display_name='גל'$$,
                  'already counted', 'cannot count the same player twice');
reset role;
select 'EARLY EXIT TESTS PASSED' as result;
