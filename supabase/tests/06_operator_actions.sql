-- Operator: groups and users overview, logged actions, new-night alert never blocks.
\set ON_ERROR_STOP 1
\pset pager off

reset role;
insert into auth.users (id, email, raw_user_meta_data) values
 ('00000000-0000-0000-0000-0000000000f1', 'op-adm@x.com', '{"full_name":"מנהל קבוצה"}');
-- alert configured but pg_net absent here: opening a night must still work
update private.operator_settings set telegram_token = 'TEST', telegram_chat_id = '1';
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000f1', false);
insert into public.groups (id, name) values ('10000000-0000-0000-0000-00000000f0f0', 'קבוצה של מישהו');
insert into public.games (id, group_id, name, buy_in_ils, start_stack_chips, settlement_mode, banker_profile_id)
values ('20000000-0000-0000-0000-00000000f0f1', '10000000-0000-0000-0000-00000000f0f0', 'ערב פתוח', 100, 1000, 'ledger', auth.uid());
select test.ok(true, 'a night opens even when the alert cannot be sent');

-- ---------- a regular user ----------
select test.fails('select * from public.op_groups()', 'operators only', 'regular user: no groups overview');
select test.fails('select * from public.op_users()', 'operators only', 'regular user: no users overview');
select test.fails($$select public.op_set_group_state('10000000-0000-0000-0000-00000000f0f0', 'archive')$$, 'operators only', 'regular user: no operator actions');
select test.fails($$select * from private.operator_settings$$, 'permission denied', 'nobody reads the alert settings');

-- ---------- the operator (…099, from 04) ----------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000099', false);
select test.ok((select open_now and admins = 'מנהל קבוצה' and accounts = 1 from public.op_groups() where group_id = '10000000-0000-0000-0000-00000000f0f0'),
               'operator sees the group: admins, accounts, open night');
select test.ok((select groups = 1 and admin_of = 'קבוצה של מישהו' from public.op_users() where profile_id = '00000000-0000-0000-0000-0000000000f1'),
               'operator sees the user and what he manages');
select test.ok((select is_operator from public.op_users() where profile_id = '00000000-0000-0000-0000-000000000099'), 'operators are marked');
select test.fails($$select public.op_set_group_state('10000000-0000-0000-0000-00000000f0f0', 'delete')$$, 'open game', 'operator cannot delete a group with an open night');
select public.op_cancel_game('20000000-0000-0000-0000-00000000f0f1');
select public.op_set_group_state('10000000-0000-0000-0000-00000000f0f0', 'delete');
reset role;
select test.ok((select deleted_at is not null from public.groups where id = '10000000-0000-0000-0000-00000000f0f0')
               and (select status from public.games where id = '20000000-0000-0000-0000-00000000f0f1') = 'cancelled',
               'operator cancels a night and deletes a group he is not in');
set role authenticated;
select public.op_set_group_state('10000000-0000-0000-0000-00000000f0f0', 'restore');
select test.ok((select count(*) from public.op_log()) = 3, 'every operator action is logged');
select test.ok((select action from public.op_log() limit 1) = 'group_restore', 'log is newest first');
-- ---------- the alert itself (pg_net stand-in that records the call) ----------
reset role;
create schema if not exists net;
create table if not exists test.sent (url text, body jsonb);
create or replace function net.http_post(url text, body jsonb default '{}', params jsonb default '{}', headers jsonb default '{}', timeout_milliseconds integer default 5000)
returns bigint language sql as $$ insert into test.sent values (url, body); select 1::bigint $$;
grant usage on schema net to authenticated; grant execute on all functions in schema net to authenticated;
grant insert on test.sent to authenticated;
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000f1', false);
insert into public.games (group_id, name, game_type, buy_in_ils, start_stack_chips, payout_pct, banker_profile_id)
values ('10000000-0000-0000-0000-00000000f0f0', 'טורניר שישי', 'tournament', 100, 5000, array[100], auth.uid());
reset role;
select test.ok((select url = 'https://api.telegram.org/botTEST/sendMessage' and body->>'chat_id' = '1'
                       and body->>'text' like '%קבוצה של מישהו%' and body->>'text' like '%טורניר שישי (טורניר)%' and body->>'text' like '%פתח: מנהל קבוצה%'
                from test.sent), 'a new night sends one alert: group, night, type, opener');
update private.operator_settings set notify_new_game = false;
set role authenticated;
insert into public.games (group_id, name, buy_in_ils, start_stack_chips, settlement_mode, banker_profile_id)
values ('10000000-0000-0000-0000-00000000f0f0', 'עוד ערב', 100, 1000, 'ledger', auth.uid());
reset role;
select test.ok((select count(*) from test.sent) = 1, 'alerts switch off');
drop schema net cascade;
update private.operator_settings set telegram_token = null, telegram_chat_id = null, notify_new_game = true;
select 'OPERATOR ACTIONS TESTS PASSED' as result;
