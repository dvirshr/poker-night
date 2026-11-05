-- Rename in the account and in all groups at once; a name taken in a group is skipped there.
\set ON_ERROR_STOP 1
\pset pager off
reset role;
insert into auth.users (id, email, raw_user_meta_data) values
 ('00000000-0000-0000-0000-0000000000b1', 'r1@x.com', '{"full_name":"שחר"}'),
 ('00000000-0000-0000-0000-0000000000b2', 'r2@x.com', '{"full_name":"אחר"}');
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', false);
insert into public.groups (id, name) values ('10000000-0000-0000-0000-0000000000b1', 'קבוצה א'), ('10000000-0000-0000-0000-0000000000b2', 'קבוצה ב');
insert into public.group_invites (code, group_id) values ('RENAMEB002', '10000000-0000-0000-0000-0000000000b2');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b2', false);
select public.join_group('RENAMEB002', 'הפטיש');            -- someone already uses the name in group ב
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', false);
select public.approve_member(id) from public.players where group_id = '10000000-0000-0000-0000-0000000000b2' and status = 'pending';

select test.fails($$select * from public.rename_everywhere('   ')$$, '1-40', 'empty name rejected');
create temp table r as select * from public.rename_everywhere('הפטיש', true);
select test.ok((select display_name from public.profiles where id = auth.uid()) = 'הפטיש', 'account name changed');
select test.ok((select display_name from public.players where profile_id = auth.uid() and group_id = '10000000-0000-0000-0000-0000000000b1') = 'הפטיש', 'renamed in a free group');
select test.ok((select display_name from public.players where profile_id = auth.uid() and group_id = '10000000-0000-0000-0000-0000000000b2') = 'שחר', 'kept in a group where the name is taken');
select test.ok((select count(*) from r where not renamed) = 1 and (select count(*) from r where renamed) = 1, 'result says where it was skipped');
select test.ok((select count(*) from public.rename_everywhere('שחר הפטיש', false)) = 0
               and (select display_name from public.players where profile_id = auth.uid() and group_id = '10000000-0000-0000-0000-0000000000b1') = 'הפטיש',
               'account only: groups untouched');
-- ---------- a group admin cannot rename a registered member; guests yes ----------
-- b1 is admin of group ב; b2 (registered) is a member there
select test.fails($$update public.players set display_name = 'כינוי שלי' where profile_id = '00000000-0000-0000-0000-0000000000b2'$$,
                  'only the player', 'group admin cannot rename a registered member');
insert into public.players (group_id, display_name, is_guest) values ('10000000-0000-0000-0000-0000000000b2', 'אורח', true);
update public.players set display_name = 'אורח טוב' where display_name = 'אורח';
select test.ok(exists (select 1 from public.players where display_name = 'אורח טוב'), 'group admin renames a guest');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b2', false);
select public.rename_me('10000000-0000-0000-0000-0000000000b2', 'הפטיש האמיתי');
select test.ok((select display_name from public.players where profile_id = auth.uid()) = 'הפטיש האמיתי', 'the member renames himself');
-- ---------- the operator renames anyone, logged ----------
select test.fails($$select * from public.op_rename_user('00000000-0000-0000-0000-0000000000b1', 'x')$$, 'operators only', 'a regular user cannot use the operator rename');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000099', false);
select * from public.op_rename_user('00000000-0000-0000-0000-0000000000b2', 'שם מהמפעיל', true);
reset role;
select test.ok((select display_name from public.players where profile_id = '00000000-0000-0000-0000-0000000000b2') = 'שם מהמפעיל'
               and (select display_name from public.profiles where id = '00000000-0000-0000-0000-0000000000b2') = 'שם מהמפעיל', 'operator renames a user everywhere');
set role authenticated;
select test.ok((select action from public.op_log() limit 1) = 'user_rename', 'operator rename is logged');
reset role;
select 'RENAME TESTS PASSED' as result;
