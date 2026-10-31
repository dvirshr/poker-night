-- Operator tools, part 2: groups and users overview, operator actions (logged), and a phone alert
-- (Telegram) when a night opens. Operators only; nothing is ever erased.

create schema if not exists private;  -- not exposed through the API

-- every operator action, for the record
create table if not exists public.operator_log (
  id         bigint generated always as identity primary key,
  at         timestamptz not null default now(),
  operator   uuid not null references public.profiles(id),
  action     text not null,
  group_id   uuid references public.groups(id),
  game_id    uuid references public.games(id)
);
alter table public.operator_log enable row level security;  -- no policies: read through op_log()

-- ---------- overviews ----------
create or replace function public.op_groups()
returns table (
  group_id uuid, name text, created_at timestamptz, archived_at timestamptz, deleted_at timestamptz,
  members integer, accounts integer, admins text, games integer, last_game timestamptz, open_now boolean
) language plpgsql stable security definer set search_path = public as $$
begin
  if not is_app_admin() then raise exception 'operators only'; end if;
  return query
  select gr.id, gr.name, gr.created_at, gr.archived_at, gr.deleted_at,
         (select count(*)::int from players p where p.group_id = gr.id and p.status = 'active'),
         (select count(*)::int from players p where p.group_id = gr.id and p.status = 'active' and p.profile_id is not null),
         (select string_agg(p.display_name, ', ' order by p.display_name) from players p
           where p.group_id = gr.id and p.status = 'active' and p.role = 'admin'),
         (select count(*)::int from games g where g.group_id = gr.id and g.status <> 'cancelled'),
         (select max(g.created_at) from games g where g.group_id = gr.id and g.status <> 'cancelled'),
         exists (select 1 from games g where g.group_id = gr.id and g.status in ('open', 'counting'))
  from groups gr
  order by coalesce((select max(g.created_at) from games g where g.group_id = gr.id), gr.created_at) desc;
end $$;
revoke all on function public.op_groups() from public, anon;
grant execute on function public.op_groups() to authenticated;

create or replace function public.op_users()
returns table (
  profile_id uuid, display_name text, created_at timestamptz, deleted_at timestamptz,
  groups integer, admin_of text, last_game timestamptz, is_operator boolean
) language plpgsql stable security definer set search_path = public as $$
begin
  if not is_app_admin() then raise exception 'operators only'; end if;
  return query
  select pr.id, pr.display_name, pr.created_at, pr.deleted_at,
         (select count(*)::int from players p where p.profile_id = pr.id and p.status = 'active'),
         (select string_agg(gr.name, ', ' order by gr.name) from players p join groups gr on gr.id = p.group_id
           where p.profile_id = pr.id and p.status = 'active' and p.role = 'admin'),
         (select max(g.created_at) from players p join game_players gp on gp.player_id = p.id
           join games g on g.id = gp.game_id where p.profile_id = pr.id and g.status <> 'cancelled'),
         exists (select 1 from app_admins a where a.profile_id = pr.id)
  from profiles pr
  order by pr.created_at desc;
end $$;
revoke all on function public.op_users() from public, anon;
grant execute on function public.op_users() to authenticated;

create or replace function public.op_log(p_limit integer default 50)
returns table (at timestamptz, operator text, action text, group_name text, game_name text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_app_admin() then raise exception 'operators only'; end if;
  return query
  select l.at, pr.display_name, l.action, gr.name, g.name
  from operator_log l
  join profiles pr on pr.id = l.operator
  left join groups gr on gr.id = l.group_id
  left join games g on g.id = l.game_id
  order by l.at desc limit greatest(p_limit, 1);
end $$;
revoke all on function public.op_log(integer) from public, anon;
grant execute on function public.op_log(integer) to authenticated;

-- ---------- actions ----------
-- archive / unarchive / delete / restore any group (same rules as a group admin: no open night for archive/delete)
create or replace function public.op_set_group_state(p_group uuid, p_action text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_app_admin() then raise exception 'operators only'; end if;
  if not exists (select 1 from groups where id = p_group) then raise exception 'no such group'; end if;
  if p_action in ('archive', 'delete')
     and exists (select 1 from games where group_id = p_group and status in ('open', 'counting')) then
    raise exception 'group has an open game';
  end if;
  perform set_config('app.group_state', 'on', true);
  if p_action = 'archive' then
    update groups set archived_at = coalesce(archived_at, now()) where id = p_group;
  elsif p_action = 'unarchive' then
    update groups set archived_at = null where id = p_group;
  elsif p_action = 'delete' then
    update groups set deleted_at = now(), deleted_by = auth.uid() where id = p_group;
  elsif p_action = 'restore' then
    update groups set deleted_at = null, deleted_by = null where id = p_group;
  else
    raise exception 'unknown action';
  end if;
  perform set_config('app.group_state', 'off', true);
  insert into operator_log (operator, action, group_id) values (auth.uid(), 'group_' || p_action, p_group);
end $$;
revoke all on function public.op_set_group_state(uuid, text) from public, anon;
grant execute on function public.op_set_group_state(uuid, text) to authenticated;

-- cancel any open night (nothing deleted; same freeze as cancel_game)
create or replace function public.op_cancel_game(p_game uuid)
returns void language plpgsql security definer set search_path = public as $$
declare gm games%rowtype;
begin
  if not is_app_admin() then raise exception 'operators only'; end if;
  select * into gm from games where id = p_game for update;
  if not found then raise exception 'no such game'; end if;
  if gm.status = 'closed' then raise exception 'game is closed and cannot be changed'; end if;
  if gm.status = 'cancelled' then raise exception 'game is cancelled'; end if;
  perform set_config('app.cancelling', 'on', true);
  update games set status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid() where id = p_game;
  perform set_config('app.cancelling', 'off', true);
  insert into operator_log (operator, action, group_id, game_id) values (auth.uid(), 'game_cancel', gm.group_id, p_game);
end $$;
revoke all on function public.op_cancel_game(uuid) from public, anon;
grant execute on function public.op_cancel_game(uuid) to authenticated;

-- ---------- phone alert when a night opens (Telegram) ----------
-- Settings live in the private schema, out of the API's reach. Fill them from the SQL editor:
--   update private.operator_settings set telegram_token = '<bot token>', telegram_chat_id = '<chat id>';
create table if not exists private.operator_settings (
  id               boolean primary key default true check (id),
  telegram_token   text,
  telegram_chat_id text,
  notify_new_game  boolean not null default true
);
insert into private.operator_settings (id) values (true) on conflict (id) do nothing;

create or replace function private.notify_new_game()
returns trigger language plpgsql security definer set search_path = public, private as $$
declare
  s   private.operator_settings%rowtype;
  msg text;
begin
  select * into s from private.operator_settings where id;
  if not found or not s.notify_new_game or s.telegram_token is null or s.telegram_chat_id is null then return new; end if;
  select format(E'🃏 נפתח ערב חדש\nקבוצה: %s\nערב: %s (%s)\nפתח: %s',
                gr.name, new.name, case when new.game_type = 'tournament' then 'טורניר' else 'קאש' end,
                coalesce((select display_name from profiles where id = new.created_by), '?'))
    into msg from groups gr where gr.id = new.group_id;
  perform net.http_post(
    url     := 'https://api.telegram.org/bot' || s.telegram_token || '/sendMessage',
    body    := jsonb_build_object('chat_id', s.telegram_chat_id, 'text', msg),
    headers := '{"Content-Type": "application/json"}'::jsonb
  );
  return new;
exception when others then
  return new;  -- an alert must never stop a night from opening
end $$;
drop trigger if exists games_notify_operator on public.games;
create trigger games_notify_operator after insert on public.games
  for each row execute function private.notify_new_game();
