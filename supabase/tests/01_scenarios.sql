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

-- ---------- name conflicts (migration 4) ----------
-- Avi (admin) adds guests "משה" and "דני" by hand; both later sign up with the same names
insert into auth.users (id, email, raw_user_meta_data) values
 ('00000000-0000-0000-0000-000000000071', 'moshe@x.com', '{"full_name":"משה"}'),
 ('00000000-0000-0000-0000-000000000072', 'dani2@x.com', '{"full_name":"דני"}'),
 ('00000000-0000-0000-0000-000000000073', 'ron2@x.com',  '{"full_name":"רון"}');
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
insert into public.players (group_id, display_name, is_guest) values
  ('10000000-0000-0000-0000-000000000001', 'משה', true),
  ('10000000-0000-0000-0000-000000000001', 'דני', true);

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000071', false);
select public.join_group('THURSDAY01', 'משה');
select test.ok((select count(*) from public.players where display_name = 'משה') = 1, 'joiner sees only his own request');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000072', false);
select public.join_group('THURSDAY01', 'דני');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000073', false);
select test.fails($$select public.join_group('THURSDAY01', 'רון')$$, 'name taken by another member',
                  'same name as a member with an account: asked to pick another name');
select public.join_group('THURSDAY01', 'רון כהן');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
reset role;
select id as moshe_pending from public.players where display_name = 'משה' and status = 'pending' \gset
select id as moshe_guest   from public.players where display_name = 'משה' and status = 'active' \gset
select id as dani_pending  from public.players where display_name = 'דני' and status = 'pending' \gset
set role authenticated;
-- Moshe is the same person: link to the guest's history
select public.approve_member(:'moshe_pending', :'moshe_guest');
reset role;
select test.ok((select profile_id from public.players where id = :'moshe_guest') = '00000000-0000-0000-0000-000000000071'
               and (select count(*) from public.players where display_name = 'משה') = 1, 'same person: linked to the guest, no duplicate');
set role authenticated;
-- Dani is a different person: approving with the same name is refused, with a new name it works
select test.fails(format('select public.approve_member(%L)', :'dani_pending'), 'name already in use',
                  'different person with the same name must be renamed');
select public.approve_member(:'dani_pending', null, 'דני לוי');
reset role;
select test.ok((select status from public.players where id = :'dani_pending') = 'active'
               and (select display_name from public.players where id = :'dani_pending') = 'דני לוי', 'different person approved under a new name');
select 'NAME CONFLICT TESTS PASSED' as result;

-- ---------- group settings (migration 5) ----------
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);  -- Ron: plain member
update public.groups set banker_mode = 'admin_assigns' where id = '10000000-0000-0000-0000-000000000001';
reset role;
select test.ok((select banker_mode from public.groups where id = '10000000-0000-0000-0000-000000000001') = 'opener_is_banker',
               'a plain member cannot change group settings');
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);  -- Avi: admin
update public.groups set banker_mode = 'admin_assigns' where id = '10000000-0000-0000-0000-000000000001';
select test.ok((select banker_mode from public.groups where id = '10000000-0000-0000-0000-000000000001') = 'admin_assigns',
               'admin switches to "admin assigns"');
update public.groups set banker_mode = 'opener_is_banker' where id = '10000000-0000-0000-0000-000000000001';

update public.players set role = 'admin' where display_name = 'רון' and group_id = '10000000-0000-0000-0000-000000000001';
select test.ok((select role from public.players where display_name = 'רון' and group_id = '10000000-0000-0000-0000-000000000001') = 'admin',
               'admin promotes Ron to admin');
insert into public.players (group_id, display_name, is_guest) values ('10000000-0000-0000-0000-000000000001', 'אורח מנהל', true);
select test.fails($$update public.players set role = 'admin' where display_name = 'אורח מנהל'$$, 'guest cannot be an admin',
                  'a guest cannot be made admin');
-- Ron demotes Avi: fine, Ron is still admin
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
update public.players set role = 'member' where profile_id = '00000000-0000-0000-0000-00000000000a' and group_id = '10000000-0000-0000-0000-000000000001';
select test.fails($$update public.players set role = 'member' where profile_id = '00000000-0000-0000-0000-00000000000b' and group_id = '10000000-0000-0000-0000-000000000001'$$,
                  'at least one admin', 'the last admin cannot step down');
update public.players set role = 'admin' where profile_id = '00000000-0000-0000-0000-00000000000a' and group_id = '10000000-0000-0000-0000-000000000001';
reset role;
select 'SETTINGS TESTS PASSED' as result;

-- ---------- wave 1 (migration 6): unlink + theme ----------
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);  -- Avi admin
reset role;
select id as moshe_row from public.players where profile_id = '00000000-0000-0000-0000-000000000071' \gset
set role authenticated;
select public.unlink_member(:'moshe_row');
reset role;
select test.ok((select profile_id is null and is_guest from public.players where id = :'moshe_row'), 'unlinked row is a guest again, history kept');
select test.ok((select status from public.players where profile_id = '00000000-0000-0000-0000-000000000071') = 'pending', 'account is back in the approval queue');
set role authenticated;
select test.fails($$select public.unlink_member((select id from public.players where profile_id = auth.uid() limit 1))$$, 'cannot unlink yourself', 'admin cannot unlink himself');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000d', false);  -- Gal: member
select test.fails(format('select public.unlink_member(%L)', :'moshe_row'), '', 'a member cannot unlink anyone');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
update public.groups set table_theme = 'vegas' where id = '10000000-0000-0000-0000-000000000001';
select test.ok((select table_theme from public.groups where id = '10000000-0000-0000-0000-000000000001') = 'vegas', 'admin sets table theme');
select test.fails($$update public.groups set table_theme = 'pink' where id = '10000000-0000-0000-0000-000000000001'$$, 'check', 'unknown theme rejected');
-- re-approve Moshe, linked to his guest row again
reset role;
select id as moshe_pend from public.players where profile_id = '00000000-0000-0000-0000-000000000071' \gset
set role authenticated;
select public.approve_member(:'moshe_pend', :'moshe_row');
reset role;
select test.ok((select profile_id from public.players where id = :'moshe_row') = '00000000-0000-0000-0000-000000000071', 're-approved and linked correctly');
select 'WAVE1 TESTS PASSED' as result;

-- ---------- tournament (migration 7) ----------
select test.ok(public.tournament_prizes(500, array[60,30,10]) = array[300,150,50], 'prizes 60/30/10 of 500');
select test.ok(public.tournament_prizes(333, array[50,30,20]) = array[166,100,67], 'prizes: largest remainder, whole shekels, sum kept');
select test.ok(public.tournament_prizes(7, array[34,33,33]) = array[3,2,2], 'prizes: tie in remainder goes to the better place');
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
select test.fails($$insert into public.games (group_id, game_type, buy_in_ils, banker_profile_id)
                    values ('10000000-0000-0000-0000-000000000001', 'tournament', 100, auth.uid())$$,
                  'tournament_payout', 'tournament needs a payout split');
insert into public.games (id, group_id, name, game_type, buy_in_ils, start_stack_chips, max_rebuys, payout_pct, settlement_mode, banker_profile_id)
values ('20000000-0000-0000-0000-0000000000f1', '10000000-0000-0000-0000-000000000001', 'טורניר', 'tournament', 100, 5000, 3, '{50,50}', 'ledger', auth.uid());
reset role;
select id as t_avi from public.players where display_name = 'אבי' and group_id = '10000000-0000-0000-0000-000000000001' \gset
select id as t_ron from public.players where display_name = 'רון' and group_id = '10000000-0000-0000-0000-000000000001' \gset
select id as t_gal from public.players where display_name = 'גל' and group_id = '10000000-0000-0000-0000-000000000001' \gset
select id as t_maya from public.players where display_name = 'מאיה' and group_id = '10000000-0000-0000-0000-000000000001' \gset
set role authenticated;
insert into public.game_players (game_id, player_id, seat_no) values
 ('20000000-0000-0000-0000-0000000000f1', :'t_avi', 1), ('20000000-0000-0000-0000-0000000000f1', :'t_ron', 2),
 ('20000000-0000-0000-0000-0000000000f1', :'t_gal', 3), ('20000000-0000-0000-0000-0000000000f1', :'t_maya', 4);
insert into public.ledger_entries (game_id, player_id, type, amount_ils)
select '20000000-0000-0000-0000-0000000000f1', player_id, 'buy_in', 100 from public.game_players where game_id = '20000000-0000-0000-0000-0000000000f1';
insert into public.ledger_entries (game_id, player_id, type, amount_ils) values ('20000000-0000-0000-0000-0000000000f1', :'t_ron', 'rebuy', 100);
insert into public.blind_levels (game_id, level_no, small_blind, big_blind, duration_min) values
 ('20000000-0000-0000-0000-0000000000f1', 1, 25, 50, 15), ('20000000-0000-0000-0000-0000000000f1', 2, 50, 100, 15);
update public.games set clock_anchor = now(), blinds_rev = blinds_rev + 1 where id = '20000000-0000-0000-0000-0000000000f1';
select test.ok((select clock_anchor is not null from public.games where id = '20000000-0000-0000-0000-0000000000f1'), 'banker starts the clock');
update public.game_players set eliminated_at = now() - interval '2 min' where game_id = '20000000-0000-0000-0000-0000000000f1' and player_id = :'t_gal';
update public.game_players set eliminated_at = now() - interval '1 min' where game_id = '20000000-0000-0000-0000-0000000000f1' and player_id = :'t_ron';
select test.ok((select count(*) from public.game_players where game_id = '20000000-0000-0000-0000-0000000000f1' and eliminated_at is not null) = 2, 'banker marks eliminations');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000d', false);  -- Gal, not the banker
update public.games set clock_paused_at = now() where id = '20000000-0000-0000-0000-0000000000f1';
select test.ok((select clock_paused_at is null from public.games where id = '20000000-0000-0000-0000-0000000000f1'), 'a player cannot pause the clock');
select test.ok((select count(*) from public.blind_levels where game_id = '20000000-0000-0000-0000-0000000000f1') = 2, 'players see the blind structure');
select test.fails(format($$select public.close_tournament('20000000-0000-0000-0000-0000000000f1', array[%L,%L,%L,%L]::uuid[], '{60,30,10}', '[]')$$, :'t_maya', :'t_avi', :'t_ron', :'t_gal'),
                  'only the banker', 'only the banker closes a tournament');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
select test.fails(format($$select public.close_tournament('20000000-0000-0000-0000-0000000000f1', array[%L,%L,%L]::uuid[], '{60,30,10}', '[]')$$, :'t_maya', :'t_avi', :'t_ron'),
                  'every player exactly once', 'finish order must contain every player');
select test.fails(format($$select public.close_tournament('20000000-0000-0000-0000-0000000000f1', array[%L,%L,%L,%L]::uuid[], '{60,30}', '[]')$$, :'t_maya', :'t_avi', :'t_ron', :'t_gal'),
                  'sum to 100', 'payout must sum to 100');
select test.fails(format($$select public.close_tournament('20000000-0000-0000-0000-0000000000f1', array[%L,%L,%L,%L]::uuid[], '{60,30,10}', '[]')$$, :'t_maya', :'t_avi', :'t_ron', :'t_gal'),
                  'do not match the ledger', 'wrong settlements roll back everything');
select test.ok((select count(*) from public.ledger_entries where game_id = '20000000-0000-0000-0000-0000000000f1' and type = 'cash_out') = 0, 'failed close left no prize rows');
-- maya 1st (+200), avi 2nd (+50), ron 3rd (50-200 = -150), gal 4th (-100)
select public.close_tournament('20000000-0000-0000-0000-0000000000f1', array[:'t_maya', :'t_avi', :'t_ron', :'t_gal']::uuid[], '{60,30,10}',
  jsonb_build_array(
    jsonb_build_object('from_player_id', :'t_ron', 'to_player_id', :'t_maya', 'amount_ils', 150, 'method', 'transfer'),
    jsonb_build_object('from_player_id', :'t_gal', 'to_player_id', :'t_maya', 'amount_ils', 50, 'method', 'transfer'),
    jsonb_build_object('from_player_id', :'t_gal', 'to_player_id', :'t_avi', 'amount_ils', 50, 'method', 'transfer')));
select test.ok((select status from public.games where id = '20000000-0000-0000-0000-0000000000f1') = 'closed', 'tournament closed');
select test.ok((select string_agg(display_name || ':' || finish_place || ':' || net, ',' order by finish_place) from public.game_player_totals
                where game_id = '20000000-0000-0000-0000-0000000000f1') = 'מאיה:1:200,אבי:2:50,רון:3:-150,גל:4:-100', 'places and nets recorded');
select test.ok((select payout_pct from public.games where id = '20000000-0000-0000-0000-0000000000f1') = '{60,30,10}', 'final payout split recorded');
select test.fails(format($$update public.game_players set eliminated_at = null where game_id = '20000000-0000-0000-0000-0000000000f1' and player_id = %L$$, :'t_ron'),
                  'game is closed', 'closed tournament cannot be changed');
reset role;
select 'TOURNAMENT TESTS PASSED' as result;
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000d', false);
select test.ok((select wins from public.league_by_type where game_type = 'tournament' and display_name = 'מאיה') = 1, 'tournament league: winner by place');
select test.ok((select count(*) from public.league_by_type where game_type = 'tournament') = 4, 'tournament league has the 4 players');
reset role;
select 'LEAGUE BY TYPE PASSED' as result;

-- ---------- dealer draw (migration 8) ----------
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
insert into public.games (id, group_id, name, buy_in_ils, start_stack_chips, banker_profile_id)
values ('20000000-0000-0000-0000-0000000000d1', '10000000-0000-0000-0000-000000000001', 'ערב הגרלה', 100, 1000, auth.uid());
insert into public.game_players (game_id, player_id, seat_no) values
 ('20000000-0000-0000-0000-0000000000d1', :'t_avi', 1), ('20000000-0000-0000-0000-0000000000d1', :'t_ron', 2),
 ('20000000-0000-0000-0000-0000000000d1', :'t_gal', 3), ('20000000-0000-0000-0000-0000000000d1', :'t_maya', 4);
select public.draw_dealer('20000000-0000-0000-0000-0000000000d1');
select test.ok((select count(*) from public.game_draws where game_id = '20000000-0000-0000-0000-0000000000d1') = 1, 'banker draws a dealer, the draw is recorded');
select public.draw_dealer('20000000-0000-0000-0000-0000000000d1');
select test.ok((select max(draw_no) from public.game_draws where game_id = '20000000-0000-0000-0000-0000000000d1') = 2, 'a redraw is a new numbered row, the first one stays');
select test.fails($$insert into public.game_draws (game_id, player_id, draw_no, pool) values ('20000000-0000-0000-0000-0000000000d1', (select player_id from public.game_players where game_id = '20000000-0000-0000-0000-0000000000d1' limit 1), 9, 4)$$,
                  'permission denied', 'nobody writes a draw by hand');
select test.fails($$delete from public.game_draws where game_id = '20000000-0000-0000-0000-0000000000d1'$$, 'permission denied', 'draws cannot be deleted');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000d', false);  -- Gal
select test.fails($$select public.draw_dealer('20000000-0000-0000-0000-0000000000d1')$$, 'only the banker', 'only the banker can draw');
select test.ok((select count(*) from public.game_draws where game_id = '20000000-0000-0000-0000-0000000000d1') = 2, 'players see the draws');
-- fairness: 2,000 draws over 4 players, each should land near 500
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
do $$ begin
  for i in 1..2000 loop perform public.draw_dealer('20000000-0000-0000-0000-0000000000d1'); end loop;
end $$;
select test.ok((select min(c) > 420 and max(c) < 580 from (select count(*) c from public.game_draws where game_id = '20000000-0000-0000-0000-0000000000d1' group by player_id) x),
               'draw is uniform: each of 4 players got 420..580 of 2,002 draws');
select player_id, count(*) from public.game_draws where game_id = '20000000-0000-0000-0000-0000000000d1' group by player_id;
select 'DRAW TESTS PASSED' as result;
