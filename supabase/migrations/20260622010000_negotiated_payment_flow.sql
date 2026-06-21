-- =============================================================================
-- CirculaID — Negotiated, chat-driven payment flow (REPLACES the two-scan QR
-- escrow handshake on the locked job chat).
-- =============================================================================
-- ALL money here is SIMULATED test data — there is NO real payment gateway.
--
-- This REPLACES the prior chat escrow (start_hire / mark_job_done / complete_hire
-- two-scan QR handshake driven by the HIDDEN post price). The new flow is:
--   accepted (no price)        -> worker sends a NEGOTIATED final price
--   accepted (+ final_amount)  -> client pays (button OR worker's QR) => escrow held
--   in_progress (+ photo)      -> worker marks done with a required photo
--   in_progress (work_done_at) -> client confirms => escrow released + receipt
--   paid                       -> terminal ("completed"); client may rate
--
-- We REUSE the existing tables (held_transactions = "escrow holds",
-- wallets.balance = "test balance", receipts, ratings) rather than adding
-- parallel escrow_holds / users.test_balance, so every hold stays traceable.
--
-- The two "phase" statuses the spec named (pending_payment / pending_confirmation)
-- are DERIVED, not stored, to avoid an enum migration and keep status badges /
-- filters unchanged: pending_payment = (accepted + final_amount + no held row);
-- pending_confirmation = (in_progress + work_done_at set). Terminal stays 'paid'
-- (the real enum value) so the existing ratings RLS keeps working.
--
-- KNOWN, DELIBERATE MVP LIMITATION: there is no refund/cancellation path once
-- paid — the job proceeds to completion. Dispute handling is out of scope.
-- =============================================================================

set check_function_bodies = off;

-- 1. New columns -------------------------------------------------------------
alter table public.hire_requests
  add column if not exists final_amount numeric(12,2),   -- negotiated price (SIMULATED)
  add column if not exists work_done_at timestamptz;      -- set when worker marks done

-- Chat messages can now be plain text, a system note, or an image attachment.
alter table public.messages
  add column if not exists kind text not null default 'text',
  add column if not exists attachment_url text;
alter table public.messages drop constraint if exists messages_kind_check;
alter table public.messages
  add constraint messages_kind_check check (kind in ('text', 'system', 'image'));

-- 2. Storage for the "mark as done" job photos -------------------------------
-- Public bucket (mirrors avatars) so the photo renders in chat; writes are
-- limited to participants of the hire whose id namespaces the path.
insert into storage.buckets (id, name, public)
values ('job-photos', 'job-photos', true)
on conflict (id) do nothing;

drop policy if exists "job_photos_public_read" on storage.objects;
create policy "job_photos_public_read" on storage.objects
  for select using (bucket_id = 'job-photos');

drop policy if exists "job_photos_participant_insert" on storage.objects;
create policy "job_photos_participant_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'job-photos'
    and public.is_hire_participant(((storage.foldername(name))[1])::uuid)
  );

-- 3. send_final_price — WORKER proposes the negotiated price -----------------
create or replace function public.send_final_price(p_hire uuid, p_amount numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  h public.hire_requests;
  t_id uuid;
begin
  select * into h from public.hire_requests where id = p_hire for update;
  if h.id is null then raise exception 'Hire not found'; end if;
  -- Guard: only the assigned worker (verified via session) can set the price.
  if h.worker_id <> auth.uid() then
    raise exception 'Only the assigned worker can set the price';
  end if;
  if h.status <> 'accepted' then
    raise exception 'A price can only be set on an accepted job';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Amount must be greater than zero';
  end if;

  update public.hire_requests
     set final_amount = p_amount, updated_at = now()
   where id = p_hire;

  select id into t_id from public.chat_threads where hire_request_id = p_hire;
  if t_id is not null then
    insert into public.messages (thread_id, sender_id, content, kind)
    values (t_id, auth.uid(),
            'Worker proposed ₱' || trim(to_char(p_amount, 'FM999999990.00')) || ' for this job.',
            'system');
  end if;
end;
$$;

-- 4. pay_for_hire — CLIENT pays (shared by the button AND the QR scan) -------
create or replace function public.pay_for_hire(p_hire uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  h public.hire_requests;
  t_id uuid;
begin
  select * into h from public.hire_requests where id = p_hire for update;
  if h.id is null then raise exception 'Hire not found'; end if;
  -- Guard: only the hiring client (verified via session) can pay.
  if h.client_id <> auth.uid() then
    raise exception 'Only the hiring client can pay for this job';
  end if;
  -- Guard: must be awaiting payment (prevents paying a stale/cancelled request).
  if h.status <> 'accepted' then
    raise exception 'This job is not awaiting payment';
  end if;
  if h.final_amount is null then
    raise exception 'The worker has not set a final price yet';
  end if;
  -- Guard: never double-charge — a held escrow row already exists.
  if exists (select 1 from public.held_transactions
              where hire_request_id = p_hire and status = 'held') then
    raise exception 'Payment is already held for this job';
  end if;

  -- SIMULATED debit: only succeeds if the test balance covers the amount.
  update public.wallets
     set balance = balance - h.final_amount, updated_at = now()
   where user_id = h.client_id and balance >= h.final_amount;
  if not found then
    raise exception 'Insufficient test balance';
  end if;

  insert into public.held_transactions (hire_request_id, client_id, worker_id, amount, status)
  values (p_hire, h.client_id, h.worker_id, h.final_amount, 'held');

  update public.hire_requests
     set status = 'in_progress', started_at = now(), updated_at = now()
   where id = p_hire;

  select id into t_id from public.chat_threads where hire_request_id = p_hire;
  if t_id is not null then
    insert into public.messages (thread_id, sender_id, content, kind)
    values (t_id, auth.uid(),
            'Payment held — ₱' || trim(to_char(h.final_amount, 'FM999999990.00'))
              || ' in escrow. Job is now in progress.',
            'system');
  end if;
end;
$$;

-- 5. worker_mark_done — WORKER marks done with a REQUIRED photo --------------
create or replace function public.worker_mark_done(p_hire uuid, p_photo_url text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  h public.hire_requests;
  t_id uuid;
begin
  select * into h from public.hire_requests where id = p_hire for update;
  if h.id is null then raise exception 'Hire not found'; end if;
  -- Guard: only the assigned worker (verified via session) can mark it done.
  if h.worker_id <> auth.uid() then
    raise exception 'Only the assigned worker can mark this job done';
  end if;
  if h.status <> 'in_progress' then
    raise exception 'The job must be in progress to mark it done';
  end if;
  if h.work_done_at is not null then
    raise exception 'This job is already marked done';
  end if;
  -- Guard: a photo is required (the button is also disabled until one is added).
  if p_photo_url is null or length(trim(p_photo_url)) = 0 then
    raise exception 'A photo is required to mark the job done';
  end if;

  insert into public.proofs (hire_request_id, worker_id, photo_url)
  values (p_hire, h.worker_id, p_photo_url);

  update public.hire_requests
     set work_done_at = now(), updated_at = now()
   where id = p_hire;

  select id into t_id from public.chat_threads where hire_request_id = p_hire;
  if t_id is not null then
    insert into public.messages (thread_id, sender_id, content, kind, attachment_url)
    values (t_id, auth.uid(), 'Photo', 'image', p_photo_url);
    insert into public.messages (thread_id, sender_id, content, kind)
    values (t_id, auth.uid(),
            'Worker marked this job as done — please review and confirm.', 'system');
  end if;
end;
$$;

-- 6. confirm_satisfied — CLIENT releases escrow + generates the receipt ------
create or replace function public.confirm_satisfied(p_hire uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  h public.hire_requests;
  esc public.held_transactions;
  t_id uuid;
begin
  select * into h from public.hire_requests where id = p_hire for update;
  if h.id is null then raise exception 'Hire not found'; end if;
  -- Guard: only the hiring client (verified via session) can confirm.
  if h.client_id <> auth.uid() then
    raise exception 'Only the hiring client can confirm this job';
  end if;
  if h.status <> 'in_progress' then
    raise exception 'This job is not awaiting confirmation';
  end if;
  if h.work_done_at is null then
    raise exception 'The worker has not marked the job done yet';
  end if;

  select * into esc from public.held_transactions
   where hire_request_id = p_hire and status = 'held' for update;
  if esc.id is null then
    raise exception 'No held funds found for this job';
  end if;

  -- SIMULATED settlement: held -> worker balance.
  update public.held_transactions set status = 'released', released_at = now() where id = esc.id;
  update public.wallets set balance = balance + esc.amount, updated_at = now()
   where user_id = h.worker_id;
  update public.hire_requests
     set status = 'paid', completed_at = now(), paid_at = now(), updated_at = now()
   where id = p_hire;

  insert into public.receipts (hire_request_id, client_id, worker_id, amount, started_at, completed_at)
  values (p_hire, h.client_id, h.worker_id, esc.amount, h.started_at, now());

  select id into t_id from public.chat_threads where hire_request_id = p_hire;
  if t_id is not null then
    insert into public.messages (thread_id, sender_id, content, kind)
    values (t_id, auth.uid(),
            'Payment released — ₱' || trim(to_char(esc.amount, 'FM999999990.00')) || '. Job completed.',
            'system');
  end if;
end;
$$;

grant execute on function public.send_final_price(uuid, numeric) to authenticated;
grant execute on function public.pay_for_hire(uuid)             to authenticated;
grant execute on function public.worker_mark_done(uuid, text)   to authenticated;
grant execute on function public.confirm_satisfied(uuid)        to authenticated;

-- 7. Feed card price: expose the post's price as a PUBLIC STARTING rate. The
-- charged amount is negotiated separately (final_amount), so this is only a
-- reference. (Reverses the earlier "price hidden from clients" choice for the
-- skill-post feed — see the deliverable note.)
create or replace view public.public_worker_posts
with (security_invoker = false) as
  select
    wp.id,
    wp.worker_id,
    u.full_name as worker_name,
    wp.total_slots,
    wp.slots_filled,
    wp.description,
    wp.experience_length,
    wp.ai_title,
    wp.ai_short_description,
    wp.status,
    wp.created_at,
    prof.location as worker_location,
    u.avatar_url as worker_avatar_url,
    wp.pricing_rate as starting_rate
  from public.worker_posts wp
  join public.users u on u.id = wp.worker_id
  join public.worker_profiles prof on prof.user_id = wp.worker_id
  where wp.status = 'active'
    and prof.status = 'active'
    and u.account_status = 'active';

grant select on public.public_worker_posts to authenticated, anon;
