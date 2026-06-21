-- =============================================================================
-- CirculaID — Allow the client -> worker self-upgrade
-- =============================================================================
-- Becoming a worker was blocked: handle_worker_profile_created() promotes
-- users.role from 'client' to 'worker' when a worker_profiles row is inserted,
-- but guard_user_privileged_columns() rejected ALL non-admin role changes,
-- aborting the insert with "Only admins can change role or account_status".
--
-- We now allow this one specific, intended upgrade while still blocking
-- escalation to 'admin', demotion, and any account_status (suspend/reactivate)
-- change by non-admins.
-- =============================================================================

create or replace function public.guard_user_privileged_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- account_status is admin-only (blocks self-unsuspend).
  if new.account_status is distinct from old.account_status
     and not public.is_admin(auth.uid())
     and auth.uid() is not null
  then
    raise exception 'Only admins can change account_status';
  end if;

  -- role changes are admin-only, EXCEPT the intended one-way client -> worker
  -- self-upgrade (a worker keeps all client abilities). This lets the
  -- become-a-worker flow / promote-on-insert trigger work without admin rights,
  -- while still blocking escalation to 'admin' and any other role change.
  if new.role is distinct from old.role
     and not (old.role = 'client' and new.role = 'worker')
     and not public.is_admin(auth.uid())
     and auth.uid() is not null
  then
    raise exception 'Only admins can change role';
  end if;

  return new;
end;
$$;
