-- Account deletion: the login goes, the group's history stays exactly as it was.
\set ON_ERROR_STOP 1
\pset pager off

reset role;
insert into auth.users (id, email, raw_user_meta_data) values
 ('00000000-0000-0000-0000-0000000000a1', 'del-admin@x.com',  '{"full_name":"שמעון"}'),
 ('00000000-0000-0000-0000-0000000000a2', 'del-member@x.com', '{"full_name":"לוי"}'),
 ('00000000-0000-0000-0000-0000000000a3', 'del-solo@x.com',   '{"full_name":"בודד"}'),
 ('00000000-0000-0000-0000-0000000000a4', 'del-pending@x.com','{"full_name":"ממתין"}');

set role authenticated;
-- Shimon creates a group, Levi joins and is approved, a 4th account only asks to join
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
insert into public.groups (id, name) values ('10000000-0000-0000-0000-0000000000d0', 'קבוצת מחיקה');
insert into public.group_invites (code, group_id) values ('DELETE0001', '10000000-0000-0000-0000-0000000000d0');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', false);
select public.join_group('DELETE0001', 'לוי');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a4', false);
select public.join_group('DELETE0001', 'ממתין');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
select public.approve_member(id) from public.players
 where group_id = '10000000-0000-0000-0000-0000000000d0' and display_name = 'לוי';

-- a night with money on it: Shimon is the banker, Levi bought in
insert into public.games (id, group_id, name, buy_in_ils, start_stack_chips, settlement_mode, banker_profile_id)
values ('20000000-0000-0000-0000-0000000000d0', '10000000-0000-0000-0000-0000000000d0', 'ערב מחיקה', 100, 1000, 'ledger', auth.uid());
insert into public.game_players (game_id, player_id)
select '20000000-0000-0000-0000-0000000000d0', id from public.players
 where group_id = '10000000-0000-0000-0000-0000000000d0' and status = 'active';
insert into public.ledger_entries (game_id, player_id, type, amount_ils)
select '20000000-0000-0000-0000-0000000000d0', id, 'buy_in', 100 from public.players
 where group_id = '10000000-0000-0000-0000-0000000000d0' and status = 'active';

-- ---------- blocked cases ----------
select test.fails('select public.delete_account()', 'banker of an open game', 'banker of an open night cannot delete the account');
reset role;
update public.games set banker_profile_id = '00000000-0000-0000-0000-0000000000a2' where id = '20000000-0000-0000-0000-0000000000d0';
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
select test.fails('select public.delete_account()', 'only admin of a group', 'the only admin of a group with other accounts is blocked');

-- ---------- Levi deletes his account (he is now the banker: hand back first) ----------
reset role;
update public.games set banker_profile_id = '00000000-0000-0000-0000-0000000000a1' where id = '20000000-0000-0000-0000-0000000000d0';
select id as levi_player from public.players where display_name = 'לוי' and group_id = '10000000-0000-0000-0000-0000000000d0' \gset
select count(*) as ledger_before from public.ledger_entries where game_id = '20000000-0000-0000-0000-0000000000d0' \gset
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', false);
select public.delete_account();
reset role;
select test.ok(not exists (select 1 from auth.users where id = '00000000-0000-0000-0000-0000000000a2'), 'login is deleted');
select test.ok((select deleted_at is not null from public.profiles where id = '00000000-0000-0000-0000-0000000000a2'), 'profile kept as a deleted tombstone');
select test.ok((select profile_id is null and is_guest and status = 'active' and display_name = 'לוי'
                from public.players where id = :'levi_player'), 'player row stays under the same name, as a guest');
select test.ok((select count(*) from public.ledger_entries where game_id = '20000000-0000-0000-0000-0000000000d0') = :ledger_before
               and exists (select 1 from public.ledger_entries where player_id = :'levi_player'), 'ledger untouched: history stays');

-- ---------- now Shimon is the only account left: deleting is allowed, the group keeps its history ----------
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
select test.fails('select public.delete_account()', 'banker of an open game', 'still blocked while banker of the open night');
reset role;
-- test shortcut: mark the night closed without the full count/close flow (covered in 01_scenarios)
set session_replication_role = replica;
update public.games set status = 'closed', closed_at = now() where id = '20000000-0000-0000-0000-0000000000d0';
set session_replication_role = origin;
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
select public.delete_account();
reset role;
select test.ok((select count(*) from public.players where group_id = '10000000-0000-0000-0000-0000000000d0' and status = 'active' and profile_id is not null) = 0,
               'no active account left in the group');
select test.ok((select banker_profile_id from public.games where id = '20000000-0000-0000-0000-0000000000d0') = '00000000-0000-0000-0000-0000000000a1',
               'closed night still names its banker');
select test.ok((select status = 'pending' and profile_id is not null from public.players where display_name = 'ממתין'),
               'another account''s pending request is untouched');
select test.ok((select expires_at <= now() from public.group_invites where code = 'DELETE0001'), 'invite codes of a deleted account stop working');

-- ---------- a pending request is withdrawn on deletion ----------
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a4', false);
select public.delete_account();
reset role;
select test.ok((select status = 'left' and profile_id is null from public.players where display_name = 'ממתין'),
               'pending request withdrawn');

-- ---------- solo account with its own group ----------
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a3', false);
insert into public.groups (id, name) values ('10000000-0000-0000-0000-0000000000d3', 'סולו');
select public.delete_account();
reset role;
select test.ok(not exists (select 1 from auth.users where id = '00000000-0000-0000-0000-0000000000a3'), 'solo admin can delete');

-- ---------- not signed in ----------
set role authenticated;
select set_config('request.jwt.claim.sub', '', false);
select test.fails('select public.delete_account()', 'not signed in', 'anonymous call rejected');
reset role;
select 'ACCOUNT DELETION TESTS PASSED' as result;
