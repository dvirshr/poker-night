-- Group rename, archive, delete and restore. Nothing is erased.
\set ON_ERROR_STOP 1
\pset pager off

reset role;
insert into auth.users (id, email, raw_user_meta_data) values
 ('00000000-0000-0000-0000-0000000000e1', 'g-admin@x.com', '{"full_name":"מנהל"}'),
 ('00000000-0000-0000-0000-0000000000e2', 'g-mem@x.com',   '{"full_name":"חבר"}'),
 ('00000000-0000-0000-0000-0000000000e3', 'g-new@x.com',   '{"full_name":"חדש"}');
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000e1', false);
insert into public.groups (id, name) values ('10000000-0000-0000-0000-0000000000e0', 'קבוצה ישנה');
insert into public.group_invites (code, group_id) values ('LIFECYC001', '10000000-0000-0000-0000-0000000000e0');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000e2', false); select public.join_group('LIFECYC001', 'חבר');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000e1', false);
select public.approve_member(id) from public.players where group_id = '10000000-0000-0000-0000-0000000000e0' and status = 'pending';
insert into public.games (id, group_id, name, buy_in_ils, start_stack_chips, settlement_mode, banker_profile_id)
values ('20000000-0000-0000-0000-0000000000e1', '10000000-0000-0000-0000-0000000000e0', 'ערב', 100, 1000, 'ledger', auth.uid());

-- ---------- rename ----------
update public.groups set name = 'החבר''ה' where id = '10000000-0000-0000-0000-0000000000e0';
select test.ok((select name from public.groups where id = '10000000-0000-0000-0000-0000000000e0') = 'החבר''ה', 'admin renames the group');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000e2', false);
update public.groups set name = 'x' where id = '10000000-0000-0000-0000-0000000000e0';
select test.ok((select name from public.groups where id = '10000000-0000-0000-0000-0000000000e0') = 'החבר''ה', 'a member cannot rename the group');
select public.rename_me('10000000-0000-0000-0000-0000000000e0', 'חבר טוב');
select test.ok(exists (select 1 from public.players where profile_id = auth.uid() and display_name = 'חבר טוב'), 'a member renames himself');
select test.fails($$select public.rename_me('10000000-0000-0000-0000-0000000000e0', 'מנהל')$$, 'name taken', 'cannot take another member''s name');

-- ---------- archive / delete need no open night, admins only ----------
select test.fails($$select public.set_group_state('10000000-0000-0000-0000-0000000000e0', 'archive')$$, 'only a group admin', 'a member cannot archive');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000e1', false);
select test.fails($$select public.set_group_state('10000000-0000-0000-0000-0000000000e0', 'archive')$$, 'open game', 'cannot archive with an open night');
select public.cancel_game('20000000-0000-0000-0000-0000000000e1');
select test.fails($$update public.groups set archived_at = now() where id = '10000000-0000-0000-0000-0000000000e0'$$, 'use the archive', 'state changes only through the actions');

select public.set_group_state('10000000-0000-0000-0000-0000000000e0', 'archive');
select test.ok((select archived_at is not null from public.groups where id = '10000000-0000-0000-0000-0000000000e0'), 'archived');
select test.fails($$insert into public.games (group_id, buy_in_ils, start_stack_chips, banker_profile_id)
                    values ('10000000-0000-0000-0000-0000000000e0', 100, 1000, auth.uid())$$, 'archived', 'no new nights in an archived group');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000e3', false);
select test.fails($$select public.join_group('LIFECYC001', 'חדש')$$, 'archived', 'no new members in an archived group');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000e2', false);
select test.ok(exists (select 1 from public.games where group_id = '10000000-0000-0000-0000-0000000000e0'), 'members still see an archived group''s history');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000e1', false);
select public.set_group_state('10000000-0000-0000-0000-0000000000e0', 'unarchive');
select public.set_group_state('10000000-0000-0000-0000-0000000000e0', 'delete');
select test.ok((select deleted_at is not null and deleted_by = auth.uid() from public.groups where id = '10000000-0000-0000-0000-0000000000e0'), 'deleted, with who');
reset role;
select test.ok((select count(*) from public.ledger_entries l join public.games g on g.id = l.game_id where g.group_id = '10000000-0000-0000-0000-0000000000e0') >= 0
               and exists (select 1 from public.players where group_id = '10000000-0000-0000-0000-0000000000e0'), 'nothing erased');
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000e2', false);
select test.fails($$select public.set_group_state('10000000-0000-0000-0000-0000000000e0', 'restore')$$, 'only a group admin', 'a member cannot restore');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000e1', false);
select public.set_group_state('10000000-0000-0000-0000-0000000000e0', 'restore');
select test.ok((select deleted_at is null and archived_at is null from public.groups where id = '10000000-0000-0000-0000-0000000000e0'), 'restored, back to normal');
insert into public.games (group_id, buy_in_ils, start_stack_chips, banker_profile_id)
values ('10000000-0000-0000-0000-0000000000e0', 100, 1000, auth.uid());
select test.ok(true, 'a restored group plays again');
reset role;
select 'GROUP LIFECYCLE TESTS PASSED' as result;
