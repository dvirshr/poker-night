-- Cancel a night: frozen, never counted, nothing deleted.
\set ON_ERROR_STOP 1
\pset pager off

reset role;
insert into auth.users (id, email, raw_user_meta_data) values
 ('00000000-0000-0000-0000-0000000000c1', 'c-admin@x.com',  '{"full_name":"אדמין"}'),
 ('00000000-0000-0000-0000-0000000000c2', 'c-bank@x.com',   '{"full_name":"בנקאי"}'),
 ('00000000-0000-0000-0000-0000000000c3', 'c-member@x.com', '{"full_name":"חבר"}');

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', false);
insert into public.groups (id, name) values ('10000000-0000-0000-0000-0000000000c0', 'קבוצת ביטול');
insert into public.group_invites (code, group_id) values ('CANCEL0001', '10000000-0000-0000-0000-0000000000c0');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c2', false); select public.join_group('CANCEL0001', 'בנקאי');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c3', false); select public.join_group('CANCEL0001', 'חבר');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', false);
select public.approve_member(id) from public.players where group_id = '10000000-0000-0000-0000-0000000000c0' and status = 'pending';

-- the banker opens a tournament by mistake, seats everyone, takes buy-ins
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c2', false);
insert into public.games (id, group_id, name, game_type, buy_in_ils, start_stack_chips, payout_pct, banker_profile_id)
values ('20000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-0000000000c0', 'טורניר בטעות', 'tournament', 100, 5000, array[100], auth.uid());
insert into public.game_players (game_id, player_id)
select '20000000-0000-0000-0000-0000000000c1', id from public.players where group_id = '10000000-0000-0000-0000-0000000000c0';
insert into public.ledger_entries (game_id, player_id, type, amount_ils)
select '20000000-0000-0000-0000-0000000000c1', id, 'buy_in', 100 from public.players where group_id = '10000000-0000-0000-0000-0000000000c0';
reset role;
select count(*) as entries_before from public.ledger_entries where game_id = '20000000-0000-0000-0000-0000000000c1' \gset
set role authenticated;

-- ---------- who may cancel ----------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c3', false);
select test.fails($$select public.cancel_game('20000000-0000-0000-0000-0000000000c1')$$, 'only the banker or a group admin', 'a plain member cannot cancel');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c2', false);
select test.fails($$update public.games set status = 'cancelled' where id = '20000000-0000-0000-0000-0000000000c1'$$, 'use cancel_game()', 'the banker cannot cancel by direct update');
select public.cancel_game('20000000-0000-0000-0000-0000000000c1');
select test.ok((select status = 'cancelled' and cancelled_by = auth.uid() and cancelled_at is not null
                from public.games where id = '20000000-0000-0000-0000-0000000000c1'), 'banker cancels: status, who and when recorded');

-- ---------- frozen, nothing deleted ----------
select test.ok((select count(*) from public.ledger_entries where game_id = '20000000-0000-0000-0000-0000000000c1') = :entries_before,
               'every ledger line kept');
select test.fails($$insert into public.ledger_entries (game_id, player_id, type, amount_ils)
                    select '20000000-0000-0000-0000-0000000000c1', id, 'rebuy', 100 from public.players where display_name = 'חבר'$$,
                  'game is cancelled', 'no new money on a cancelled night');
select test.fails($$update public.games set name = 'x' where id = '20000000-0000-0000-0000-0000000000c1'$$, 'game is cancelled', 'a cancelled night cannot be edited');
select test.fails($$select public.cancel_game('20000000-0000-0000-0000-0000000000c1')$$, 'game is cancelled', 'cannot cancel twice');
select test.fails($$select public.close_tournament('20000000-0000-0000-0000-0000000000c1',
                      (select array_agg(id order by display_name) from public.players where group_id = '10000000-0000-0000-0000-0000000000c0'),
                      array[100], '[]'::jsonb)$$,
                  'cancel', 'a cancelled tournament cannot be closed');

-- ---------- not counted ----------
select test.ok(not exists (select 1 from public.league_table where group_id = '10000000-0000-0000-0000-0000000000c0'),
               'a cancelled night is not in the league');

-- ---------- the banker is free again (account deletion is not blocked) ----------
select test.ok(not exists (select 1 from public.games where status in ('open', 'counting')
                           and banker_profile_id = '00000000-0000-0000-0000-0000000000c2'), 'no open night left for the banker');

-- ---------- an admin may cancel a night someone else banks ----------
insert into public.games (id, group_id, name, buy_in_ils, start_stack_chips, settlement_mode, banker_profile_id)
values ('20000000-0000-0000-0000-0000000000c2', '10000000-0000-0000-0000-0000000000c0', 'קאש', 100, 1000, 'ledger', auth.uid());
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', false);
select public.cancel_game('20000000-0000-0000-0000-0000000000c2');
select test.ok((select status from public.games where id = '20000000-0000-0000-0000-0000000000c2') = 'cancelled', 'group admin can cancel');
reset role;
select 'CANCEL TESTS PASSED' as result;
