-- Lets an invite link show WHO invited you and to WHICH group, before you sign up.
-- Reveals only the group name and the inviter's display name, and only for a valid, unexpired code.
create or replace function public.invite_info(p_code text)
returns table (group_name text, inviter text)
language sql stable security definer set search_path = public as $$
  select g.name, p.display_name
  from group_invites i
  join groups g   on g.id = i.group_id
  join profiles p on p.id = i.created_by
  where i.code = p_code and i.expires_at > now()
$$;
revoke all on function public.invite_info(text) from public;
grant execute on function public.invite_info(text) to anon, authenticated;
