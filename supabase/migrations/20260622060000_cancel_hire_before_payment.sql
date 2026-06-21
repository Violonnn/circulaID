-- =============================================================================
-- CirculaID — Cancel a hire during the pre-payment ("send final price") phase
-- =============================================================================
-- Either participant (client OR worker) can cancel a hire while it is still in
-- the 'accepted' phase — i.e. after acceptance and during price negotiation,
-- BEFORE the client has paid. Once payment is held (status flips to
-- 'in_progress'), the hire can no longer be cancelled here.
--
-- Setting status='cancelled' re-uses the existing status-change trigger, which
-- releases the reserved slot (accepted -> cancelled). A system message is posted
-- to the chat so both sides see it. SECURITY DEFINER + a participant check, so a
-- non-participant can never cancel someone else's hire.
-- =============================================================================

set check_function_bodies = off;

create or replace function public.cancel_hire(p_hire uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  h    public.hire_requests;
  t_id uuid;
begin
  select * into h from public.hire_requests where id = p_hire for update;
  -- Guard: the hire must exist.
  if h.id is null then
    raise exception 'Hire not found';
  end if;
  -- Guard: only the two participants (client or worker) may cancel.
  if auth.uid() <> h.client_id and auth.uid() <> h.worker_id then
    raise exception 'You are not part of this hire';
  end if;
  -- Guard: cancellation is only allowed BEFORE payment — the 'accepted' phase.
  if h.status <> 'accepted' then
    raise exception 'This hire can no longer be cancelled';
  end if;
  -- Guard: defense in depth — never cancel a hire that already holds escrow.
  if exists (
    select 1 from public.held_transactions
     where hire_request_id = p_hire and status = 'held'
  ) then
    raise exception 'This hire can no longer be cancelled';
  end if;

  -- Flip to cancelled; the status-change trigger frees the reserved slot.
  update public.hire_requests
     set status = 'cancelled', updated_at = now()
   where id = p_hire;

  -- Let both sides see it in the chat.
  select id into t_id from public.chat_threads where hire_request_id = p_hire;
  if t_id is not null then
    insert into public.messages (thread_id, sender_id, content, kind)
    values (t_id, auth.uid(), 'Hire cancelled.', 'system');
  end if;
end;
$$;

grant execute on function public.cancel_hire(uuid) to authenticated;
