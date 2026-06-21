-- =============================================================================
-- client_names_for_worker — let a WORKER read the display names of the clients
-- who have hired them (and ONLY those clients).
--
-- WHY: RLS on public.users hides every other user's row, and public_profiles
-- only exposes ACTIVE WORKERS. So a worker viewing their incoming hire requests
-- could previously only see a generic "Client #1234abcd" label. This function
-- returns full_name for a client ONLY when that client has at least one
-- hire_request whose worker_id is the calling worker. It can never be used to
-- enumerate arbitrary users: rows are filtered by an EXISTS check against the
-- caller's own hires (auth.uid()).
--
-- SECURITY DEFINER so it can read users.full_name past the column-level RLS,
-- but the WHERE clause keeps disclosure scoped to the caller's own clients.
-- =============================================================================
create or replace function public.client_names_for_worker(p_client_ids uuid[])
returns table (id uuid, full_name text)
language sql
stable
security definer
set search_path = public
as $$
  select u.id, u.full_name
  from public.users u
  where u.id = any (p_client_ids)
    and exists (
      select 1
      from public.hire_requests hr
      where hr.client_id = u.id
        and hr.worker_id = auth.uid()
    );
$$;

grant execute on function public.client_names_for_worker(uuid[]) to authenticated;
