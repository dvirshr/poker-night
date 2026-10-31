-- Operator tools: (1) an app-wide overview for the app's operators, (2) control over which app versions may connect.

-- =====================================================================
-- 1. App operators and the overview
-- =====================================================================
create table if not exists public.app_admins (
  profile_id uuid primary key references public.profiles(id),
  added_at   timestamptz not null default now()
);
alter table public.app_admins enable row level security;
-- no policies: rows are added only from the Supabase dashboard (SQL editor)

create or replace function public.is_app_admin()
returns boolean language sql stable security definer set search_path = public as
$$ select exists (select 1 from app_admins where profile_id = auth.uid()) $$;
revoke all on function public.is_app_admin() from public, anon;
grant execute on function public.is_app_admin() to authenticated;

-- Every night in every group: who opened it, how many players, what state. No money, no emails.
create or replace function public.admin_games(p_days integer default 30)
returns table (
  game_id uuid, group_name text, game_name text, game_type text, status text,
  opened_by text, banker text, players integer, created_at timestamptz, closed_at timestamptz
) language plpgsql stable security definer set search_path = public as $$
begin
  if not is_app_admin() then raise exception 'operators only'; end if;
  return query
  select g.id, gr.name, g.name, g.game_type, g.status,
         op.display_name, bk.display_name,
         (select count(*)::int from game_players gp where gp.game_id = g.id),
         g.created_at, g.closed_at
  from games g
  join groups gr on gr.id = g.group_id
  left join profiles op on op.id = g.created_by
  left join profiles bk on bk.id = g.banker_profile_id
  where g.created_at >= now() - make_interval(days => greatest(p_days, 1))
  order by g.created_at desc
  limit 500;
end $$;
revoke all on function public.admin_games(integer) from public, anon;
grant execute on function public.admin_games(integer) to authenticated;

create or replace function public.admin_stats()
returns json language plpgsql stable security definer set search_path = public as $$
begin
  if not is_app_admin() then raise exception 'operators only'; end if;
  return json_build_object(
    'accounts',        (select count(*) from profiles where deleted_at is null),
    'groups',          (select count(*) from groups),
    'active_groups',   (select count(distinct group_id) from games where created_at >= now() - interval '30 days'),
    'open_now',        (select count(*) from games where status in ('open', 'counting')),
    'games_7d',        (select count(*) from games where created_at >= now() - interval '7 days' and status <> 'cancelled'),
    'games_30d',       (select count(*) from games where created_at >= now() - interval '30 days' and status <> 'cancelled'),
    'players_30d',     (select count(distinct gp.player_id) from game_players gp join games g on g.id = gp.game_id
                         where g.created_at >= now() - interval '30 days' and g.status <> 'cancelled')
  );
end $$;
revoke all on function public.admin_stats() from public, anon;
grant execute on function public.admin_stats() to authenticated;

-- =====================================================================
-- 2. Version control: which app versions may use the server
-- =====================================================================
-- One row, edited from the dashboard. Installed apps send their version in the x-app-version header
-- (the Android APK is 0.1.<build number>). The website sends no extra header (no CORS change needed).
create table if not exists public.app_config (
  id            boolean primary key default true check (id),
  min_version   text    not null default '0.0.0',   -- versions below this are blocked (when enforce = true)
  enforce       boolean not null default false,     -- master switch for blocking
  allow_legacy  boolean not null default true,      -- versions too old to send a version header at all
  message       text    not null default 'יצאה גרסה חדשה. צריך לעדכן כדי להמשיך.',
  updated_at    timestamptz not null default now()
);
insert into public.app_config (id) values (true) on conflict (id) do nothing;
alter table public.app_config enable row level security;
drop policy if exists app_config_read on public.app_config;
create policy app_config_read on public.app_config for select to anon, authenticated using (true);

-- "1.2.10" < "1.10.0"; non-numeric parts count as 0
create or replace function public.version_lt(a text, b text)
returns boolean language sql immutable as $$
  select coalesce(
    (select x < y from (
       select coalesce(nullif(regexp_replace(split_part(a, '.', i), '\D', '', 'g'), '')::int, 0) as x,
              coalesce(nullif(regexp_replace(split_part(b, '.', i), '\D', '', 'g'), '')::int, 0) as y, i
       from generate_series(1, 4) i) t
     where x <> y order by i limit 1),
    false)
$$;

-- Runs before every Data API request (PostgREST pre-request hook).
-- Blocks only when enforce = true and the app is older than min_version. Any doubt: let it through.
create or replace function public.check_request()
returns void language plpgsql stable security definer set search_path = public as $$
declare
  cfg app_config%rowtype;
  v   text;
begin
  select * into cfg from app_config where id;
  if not found or not cfg.enforce then return; end if;
  -- the website always runs the latest build (a reload brings it), so only installed apps are checked.
  -- Browsers always send Origin; the installed app never does.
  if coalesce(current_setting('request.headers', true)::json->>'origin', '') <> '' then return; end if;
  v := nullif(btrim(coalesce(current_setting('request.headers', true)::json->>'x-app-version', '')), '');
  if (v is null and not cfg.allow_legacy) or (v is not null and version_lt(v, cfg.min_version)) then
    raise sqlstate 'PGRST' using
      message = json_build_object('code', 'APP_VERSION', 'message', cfg.message || ' (app version is no longer supported)')::text,
      detail  = json_build_object('status', 426, 'status_text', 'Upgrade Required')::text;
  end if;
exception
  when sqlstate 'PGRST' then raise;
  when others then return;  -- never lock everyone out because of a bug here
end $$;
grant execute on function public.check_request() to anon, authenticated;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'authenticator') then
    execute 'alter role authenticator set pgrst.db_pre_request = ''public.check_request''';
    perform pg_notify('pgrst', 'reload config');
  end if;
end $$;
