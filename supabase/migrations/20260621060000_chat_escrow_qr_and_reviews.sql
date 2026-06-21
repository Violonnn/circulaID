-- =============================================================================
-- CirculaID — Two-stage SIMULATED escrow QR + public reviews on the locked chat
-- =============================================================================
-- Extends the worker_posts (skill-post) hire flow with the SAME two-scan QR
-- escrow handshake the legacy posts flow already had. ALL money here is
-- SIMULATED — there is NO real payment gateway. We deliberately REUSE the
-- existing wallets / qr_sessions / held_transactions / receipts / ratings tables
-- (instead of adding parallel escrow_holds / users.test_balance) so every hold
-- stays traceable and reversible, exactly like the rest of the schema.
--
-- Changes:
--   1. handle_hire_status_change: a worker_post hire now ALSO opens a qr_session
--      on accept (previously only the legacy posts flow created one).
--   2. start_hire: reads the held amount from worker_posts.pricing_rate when the
--      hire targets a skill post (post_id is null); legacy posts are unchanged.
--   3. mark_job_done(p_hire): NEW worker-only RPC. The chat flow has no photo
--      proof step, so this just advances the QR from work_in_progress ->
--      completion_pending (rotating the token) so the client can scan to finish.
--   4. public_worker_reviews: NEW safe view exposing each rating's stars/comment/
--      date per worker (NO client identity), so any client can read a worker's
--      reviews before hiring. The base ratings RLS stays private to the parties.
-- =============================================================================

set check_function_bodies = off;

-- -----------------------------------------------------------------------------
-- 1. Status-change trigger — open a QR session for worker_post hires on accept.
--    (Reproduces the current function and adds ONE insert in the skill-post
--    accept branch; the legacy posts branch is unchanged.)
-- -----------------------------------------------------------------------------
create or replace function public.handle_hire_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  p  public.posts;
  wp public.worker_posts;
begin
  if new.status = old.status then
    return new;
  end if;

  -- WORKER_POST FLOW ----------------------------------------------------------
  if new.worker_post_id is not null then
    -- pending -> accepted : reserve a slot (re-checked under a row lock), open
    -- the locked chat thread AND the two-scan QR session for the escrow flow.
    if old.status = 'pending' and new.status = 'accepted' then
      select * into wp from public.worker_posts where id = new.worker_post_id for update;
      if wp.slots_filled + 1 > wp.total_slots then
        raise exception 'No remaining slots on this post';
      end if;
      update public.worker_posts
         set slots_filled = slots_filled + 1
       where id = wp.id;

      new.accepted_at := now();

      insert into public.qr_sessions (hire_request_id)
      values (new.id)
      on conflict (hire_request_id) do nothing;

      insert into public.chat_threads (hire_request_id)
      values (new.id)
      on conflict (hire_request_id) do nothing;
    end if;

    -- Release the reserved slot if a previously-accepted hire is undone.
    if old.status in ('accepted', 'in_progress')
       and new.status in ('cancelled', 'rejected') then
      update public.worker_posts
         set slots_filled = greatest(slots_filled - 1, 0)
       where id = new.worker_post_id;
    end if;

    return new;
  end if;

  -- LEGACY posts FLOW (unchanged) ---------------------------------------------
  if old.status = 'pending' and new.status = 'accepted' then
    select * into p from public.posts where id = new.post_id for update;
    if p.slots_filled + 1 > p.total_slots then
      raise exception 'No remaining slots on this post';
    end if;
    update public.posts
       set slots_filled = slots_filled + 1,
           status = case when slots_filled + 1 >= total_slots then 'full' else status end
     where id = p.id;

    new.accepted_at := now();

    insert into public.qr_sessions (hire_request_id)
    values (new.id)
    on conflict (hire_request_id) do nothing;

    insert into public.chat_threads (hire_request_id)
    values (new.id)
    on conflict (hire_request_id) do nothing;
  end if;

  if old.status in ('accepted', 'in_progress')
     and new.status in ('cancelled', 'rejected') then
    update public.posts
       set slots_filled = greatest(slots_filled - 1, 0),
           status = case when status = 'full' then 'open' else status end
     where id = new.post_id;
  end if;

  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- 2. start_hire — source the SIMULATED hold amount from whichever post the hire
--    targets. Everything else (auth check, escrow hold, status flip) unchanged.
-- -----------------------------------------------------------------------------
create or replace function public.start_hire(p_hire uuid, p_token uuid)
returns public.qr_sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  h public.hire_requests;
  q public.qr_sessions;
  amt numeric(12,2);
begin
  select * into h from public.hire_requests where id = p_hire for update;
  if h.id is null then raise exception 'Hire not found'; end if;
  -- Guard: only the hiring client (verified via session) can start the job.
  if h.client_id <> auth.uid() then
    raise exception 'Only the hiring client can start this job';
  end if;
  if h.status <> 'accepted' then
    raise exception 'Hire must be accepted before it can start';
  end if;

  select * into q from public.qr_sessions where hire_request_id = p_hire for update;
  if q.token <> p_token or q.stage <> 'start_pending' then
    raise exception 'Invalid or already-used QR code';
  end if;

  -- SIMULATED escrow: read the (hidden) price from the hire's source post.
  if h.worker_post_id is not null then
    select pricing_rate into amt from public.worker_posts where id = h.worker_post_id;
  else
    select price into amt from public.posts where id = h.post_id;
  end if;
  if amt is null then
    raise exception 'Could not determine the job price';
  end if;

  update public.wallets
     set balance = balance - amt, updated_at = now()
   where user_id = h.client_id and balance >= amt;
  if not found then
    raise exception 'Insufficient simulated balance';
  end if;

  insert into public.held_transactions (hire_request_id, client_id, worker_id, amount, status)
  values (p_hire, h.client_id, h.worker_id, amt, 'held');

  update public.hire_requests
     set status = 'in_progress', started_at = now()
   where id = p_hire;

  update public.qr_sessions
     set state = 'closed', stage = 'work_in_progress', started_at = now(),
         token = gen_random_uuid()         -- rotate so the code can't be reused
   where hire_request_id = p_hire
  returning * into q;

  return q;
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. mark_job_done — worker says the job is finished (no photo proof in the chat
--    flow). Advances the QR to completion_pending so the client can scan #2.
-- -----------------------------------------------------------------------------
create or replace function public.mark_job_done(p_hire uuid)
returns public.qr_sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  h public.hire_requests;
  q public.qr_sessions;
begin
  select * into h from public.hire_requests where id = p_hire for update;
  if h.id is null then raise exception 'Hire not found'; end if;
  -- Guard: only the assigned worker (verified via session) can mark it done.
  if h.worker_id <> auth.uid() then
    raise exception 'Only the assigned worker can mark the job done';
  end if;
  -- Guard: the job must be running (escrow already held) to be marked done.
  if h.status <> 'in_progress' then
    raise exception 'Job must be in progress to mark it done';
  end if;

  select * into q from public.qr_sessions where hire_request_id = p_hire for update;
  -- Guard: only advance from the work_in_progress stage.
  if q.stage <> 'work_in_progress' then
    raise exception 'Job is not ready to be marked done';
  end if;

  update public.qr_sessions
     set state = 'open', stage = 'completion_pending', proof_submitted_at = now(),
         token = gen_random_uuid()   -- rotate so the start QR can't pass as finish
   where hire_request_id = p_hire
  returning * into q;

  return q;
end;
$$;

grant execute on function public.mark_job_done(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 4. public_worker_reviews — safe, client-facing list of a worker's reviews.
--    Exposes only stars / comment / date (never the reviewing client's id).
--    SECURITY DEFINER view, mirroring public_profiles / public_worker_posts.
-- -----------------------------------------------------------------------------
create or replace view public.public_worker_reviews
with (security_invoker = false) as
  select
    r.id,
    r.worker_id,
    r.rating,
    r.comment,
    r.created_at
  from public.ratings r
  join public.worker_profiles wp on wp.user_id = r.worker_id
  where wp.status = 'active';

grant select on public.public_worker_reviews to authenticated, anon;
