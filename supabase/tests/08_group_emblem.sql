-- group emblem: admin sets, member cannot, length checked
\set ON_ERROR_STOP 1
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
update public.groups set emblem = '🦈' where id = '10000000-0000-0000-0000-000000000001';
select test.ok((select emblem from public.groups where id = '10000000-0000-0000-0000-000000000001') = '🦈', 'admin sets emblem');
select test.fails($$update public.groups set emblem = 'זה ארוך מדי בהחלט' where id = '10000000-0000-0000-0000-000000000001'$$, 'check', 'long emblem rejected');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000d', false);
update public.groups set emblem = '🐍' where id = '10000000-0000-0000-0000-000000000001';
reset role;
select test.ok((select emblem from public.groups where id = '10000000-0000-0000-0000-000000000001') = '🦈', 'member cannot change emblem');
