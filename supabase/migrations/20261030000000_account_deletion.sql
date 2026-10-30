-- Account deletion (required by Google Play and the App Store).
--
-- The login is deleted for real (auth.users row, identities, sessions).
-- The group's history is NOT changed: every night, buy-in and settlement stays as it was,
-- under the same player name, which becomes a guest (no account), exactly like unlink_member.
-- The profile row stays as a tombstone, because closed games point to it (banker, created_by).

-- 1. profiles no longer depend on auth.users, so the login can go while the history stays.
do $$
declare c text;
begin
  for c in
    select con.conname from pg_constraint con
    join pg_class t on t.oid = con.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public' and t.relname = 'profiles' and con.contype = 'f'
  loop
    execute format('alter table public.profiles drop constraint %I', c);
  end loop;
end $$;

alter table public.profiles add column if not exists deleted_at timestamptz;

-- 2. The admin guard: a group still needs an admin, but only while another account is in it
--    to be that admin. The last account leaving a group leaves a history-only group.
create or replace function public.players_role_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.role = 'admin' and new.profile_id is null then
    raise exception 'a guest cannot be an admin';
  end if;
  if old.role = 'admin' and old.status = 'active'
     and (new.role <> 'admin' or new.status <> 'active')
     and not exists (select 1 from players
                     where group_id = old.group_id and id <> old.id and role = 'admin' and status = 'active')
     and exists (select 1 from players
                 where group_id = old.group_id and id <> old.id and status = 'active' and profile_id is not null) then
    raise exception 'a group needs at least one admin';
  end if;
  return new;
end $$;

-- 3. delete_account: the signed-in user deletes their own account.
create or replace function public.delete_account()
returns void language plpgsql security definer set search_path = public, auth as $$
declare
  me uuid := auth.uid();
  g  record;
begin
  if me is null then raise exception 'not signed in'; end if;

  -- an open night needs its banker: hand it over (or close it) first
  if exists (select 1 from games where status <> 'closed' and banker_profile_id = me) then
    raise exception 'account is the banker of an open game';
  end if;

  -- the only admin of a group that still has other accounts: appoint another admin first
  for g in
    select p.group_id from players p
    where p.profile_id = me and p.status = 'active' and p.role = 'admin'
      and not exists (select 1 from players o where o.group_id = p.group_id and o.id <> p.id
                      and o.role = 'admin' and o.status = 'active')
      and exists (select 1 from players o where o.group_id = p.group_id and o.id <> p.id
                  and o.status = 'active' and o.profile_id is not null)
  loop
    raise exception 'account is the only admin of a group';
  end loop;

  -- active memberships: the player (and all its history) stays, as a guest
  update players set role = 'member' where profile_id = me and role = 'admin';
  update players set profile_id = null, is_guest = true where profile_id = me and status = 'active';
  -- pending requests: no history, just withdrawn
  update players set profile_id = null, status = 'left' where profile_id = me;

  -- invite codes the account created stop working (the rows stay: they record who invited)
  update group_invites set expires_at = least(expires_at, now()) where created_by = me;

  update profiles set deleted_at = now() where id = me;
  delete from auth.users where id = me;
end $$;

revoke all on function public.delete_account() from public, anon;
grant execute on function public.delete_account() to authenticated;
