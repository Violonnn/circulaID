-- =============================================================================
-- CirculaID — hire_contacts: names + phone numbers of a chat's two participants
-- =============================================================================
-- The locked job chat's pinned panel shows the worker's and client's phone
-- numbers so the two parties can coordinate. Phone numbers are private, so this
-- SECURITY DEFINER RPC returns them ONLY to a participant of that hire (verified
-- via is_hire_participant against the thread's hire_request). A non-participant
-- gets no rows — never another user's number.
-- =============================================================================

set check_function_bodies = off;

create or replace function public.hire_contacts(p_thread uuid)
returns table (
  worker_name  text,
  worker_phone text,
  client_name  text,
  client_phone text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  h_id uuid;
  h    public.hire_requests;
begin
  -- Resolve the thread to its hire request.
  select hire_request_id into h_id from public.chat_threads where id = p_thread;
  -- Guard: unknown thread -> return nothing.
  if h_id is null then
    return;
  end if;
  -- Guard: only the two participants of this hire may read the contacts.
  if not public.is_hire_participant(h_id) then
    return;
  end if;

  select * into h from public.hire_requests where id = h_id;

  return query
  select w.full_name, w.phone_number, c.full_name, c.phone_number
    from public.users w
    join public.users c on c.id = h.client_id
   where w.id = h.worker_id;
end;
$$;

grant execute on function public.hire_contacts(uuid) to authenticated;
