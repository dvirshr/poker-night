-- Operator overview and version control.
\set ON_ERROR_STOP 1
\pset pager off

-- ---------- version compare ----------
select test.ok(public.version_lt('1.0.0', '1.1.0') and public.version_lt('1.2.9', '1.2.10') and public.version_lt('1.9', '1.10.0')
               and not public.version_lt('1.10.0', '1.9.9') and not public.version_lt('1.1.0', '1.1.0') and not public.version_lt('2.0', '1.99.99'),
               'version_lt compares numerically');

-- ---------- pre-request gate ----------
set role authenticated;
select set_config('request.headers', '{"x-app-version":"0.1.5","x-app-platform":"android"}', false);
select public.check_request();
select test.ok(true, 'enforce off: everyone passes');
reset role;
update public.app_config set enforce = true, min_version = '0.1.8';
set role authenticated;
select test.fails('select public.check_request()', 'no longer supported', 'old version blocked when enforced');
select set_config('request.headers', '{"x-app-version":"0.1.8","x-app-platform":"android"}', false);
select public.check_request();
select set_config('request.headers', '{"x-app-version":"0.1.12","x-app-platform":"android"}', false);
select public.check_request();
select test.ok(true, 'current and newer versions pass');
select set_config('request.headers', '{}', false);
select public.check_request();
select test.ok(true, 'legacy app (no header) passes while allow_legacy');
reset role;
update public.app_config set allow_legacy = false;
set role authenticated;
select test.fails('select public.check_request()', 'no longer supported', 'legacy app blocked once allow_legacy is off');
select set_config('request.headers', '{"origin":"https://dvirshr.github.io"}', false);
select public.check_request();
select test.ok(true, 'the website is never blocked (always the latest build)');
select set_config('request.headers', 'not json', false);
select public.check_request();
select test.ok(true, 'a malformed header never locks anyone out');
set role anon;
select test.ok((select count(*) from public.app_config) = 1, 'the app can read the config before signing in');
reset role;
update public.app_config set enforce = false, allow_legacy = true, min_version = '0.0.0';
select set_config('request.headers', '', false);

-- ---------- operator overview ----------
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000099', false);
select test.fails('select * from public.admin_games()', 'operators only', 'a regular user cannot see other groups');
select test.fails('select public.admin_stats()', 'operators only', 'a regular user cannot see app stats');
select test.ok(not public.is_app_admin(), 'regular user is not an operator');
select test.fails($$insert into public.app_admins (profile_id) values ('00000000-0000-0000-0000-000000000099')$$, 'row-level security', 'nobody can make himself an operator');
reset role;
insert into public.app_admins (profile_id) values ('00000000-0000-0000-0000-000000000099');  -- from the dashboard
set role authenticated;
select test.ok(public.is_app_admin(), 'operator recognised');
select test.ok((select count(*) from public.admin_games(365)) > 0, 'operator sees nights of groups he is not in');
select test.ok((select bool_and(players >= 0 and group_name is not null and opened_by is not null) from public.admin_games(365)), 'overview has group, opener and player count');
select test.ok((public.admin_stats()->>'groups')::int >= 2, 'operator sees app-wide stats');
select test.ok((select count(*) from public.games) = 0, 'operator still has no direct access to group tables');
reset role;
select 'OPERATOR TESTS PASSED' as result;
