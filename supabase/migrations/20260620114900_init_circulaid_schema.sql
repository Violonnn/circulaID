-- =============================================================================
-- CirculaID — Initial schema (Supabase / PostgreSQL)
-- =============================================================================
-- Capstone project. IMPORTANT: All money/wallet/escrow values in this schema
-- are SIMULATED test values only. There is NO real payment gateway. Balances,
-- held (escrow) amounts, receipts and "paid" states are bookkeeping rows that
-- the app moves around for demonstration purposes.
--
-- Conventions:
--   * public.users 1:1 extends auth.users (id = auth.users.id).
--   * Every account is a "client" by default and may ALSO attach a worker
--     profile (Shopee-style buyer->seller upgrade) without losing client use.
--   * RLS is enabled on every table. SECURITY DEFINER helpers are used in
--     policies to avoid recursive RLS lookups on public.users.
--   * The Supabase `service_role` (used by trusted server code / Edge
--     Functions) bypasses RLS and is treated as "the system".
-- =============================================================================

create extension if not exists pgcrypto;   -- gen_random_uuid()

-- Helper functions below are defined before the tables they reference, so we
-- defer body validation until runtime for this migration.
set check_function_bodies = off;

-- -----------------------------------------------------------------------------
-- ENUM TYPES
-- -----------------------------------------------------------------------------
create type public.user_role          as enum ('client', 'worker', 'admin');
create type public.account_status      as enum ('active', 'suspended');
create type public.post_status         as enum ('open', 'full', 'archived', 'deleted');
create type public.hire_status         as enum ('pending', 'accepted', 'in_progress', 'completed', 'paid', 'cancelled', 'rejected');
create type public.qr_state            as enum ('open', 'closed');
create type public.qr_stage            as enum ('start_pending', 'work_in_progress', 'completion_pending', 'completed');
create type public.escrow_status       as enum ('held', 'released', 'refunded');

-- -----------------------------------------------------------------------------
-- HELPER FUNCTIONS (SECURITY DEFINER so RLS policies don't recurse on users)
-- -----------------------------------------------------------------------------
create or replace function public.is_admin(uid uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.users u
    where u.id = uid and u.role = 'admin'
  );
$$;

create or replace function public.is_active(uid uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.users u
    where u.id = uid and u.account_status = 'active'
  );
$$;

create or replace function public.is_active_worker(uid uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.worker_profiles wp
    join public.users u on u.id = wp.user_id
    where wp.user_id = uid
      and wp.status = 'active'
      and u.account_status = 'active'
  );
$$;

-- Is `uid` the client or worker tied to a given hire request?
create or replace function public.is_hire_participant(hire uuid, uid uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.hire_requests h
    where h.id = hire
      and (h.client_id = uid or h.worker_id = uid)
  );
$$;

-- =============================================================================
-- CORE TABLES
-- =============================================================================

-- public.users — 1:1 extension of auth.users -------------------------------
-- email/password live in auth.users (Supabase Auth). We never store the
-- password here. `email` is mirrored for convenience only.
create table public.users (
  id              uuid primary key references auth.users (id) on delete cascade,
  full_name       text        not null default '',
  age             smallint     check (age is null or (age between 13 and 120)),
  email           text,
  -- Whole-account role. Everyone starts 'client'. Becomes 'worker' once a
  -- worker profile is attached (they keep all client abilities). 'admin' is
  -- assigned manually / out-of-band.
  role            public.user_role       not null default 'client',
  -- Account-level status used by RLS to block writes from suspended users.
  account_status  public.account_status  not null default 'active',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- public.worker_profiles — optional seller profile attached to a user -------
create table public.worker_profiles (
  user_id       uuid primary key references public.users (id) on delete cascade,
  bio           text,                                   -- caption / about
  -- Denormalized rating summary (kept in sync by trigger on ratings).
  rating_avg    numeric(3,2) not null default 0 check (rating_avg between 0 and 5),
  rating_count  integer      not null default 0 check (rating_count >= 0),
  -- Worker-specific status (a user can be suspended as a worker only).
  status        public.account_status not null default 'active',
  created_at    timestamptz  not null default now(),
  updated_at    timestamptz  not null default now()
);

-- public.wallets — SIMULATED balances (NOT real money) ----------------------
-- balance: spendable test funds. Created automatically for every user.
create table public.wallets (
  user_id     uuid primary key references public.users (id) on delete cascade,
  balance     numeric(12,2) not null default 0 check (balance >= 0),  -- SIMULATED
  updated_at  timestamptz   not null default now()
);

-- public.posts — community feed entries (created by active workers only) ----
create table public.posts (
  id            uuid primary key default gen_random_uuid(),
  worker_id     uuid not null references public.users (id) on delete cascade,
  caption       text not null,
  total_slots   integer not null check (total_slots > 0),
  slots_filled  integer not null default 0 check (slots_filled >= 0),
  -- SIMULATED price. Hidden from client-side reads (see column privileges +
  -- public.post_owner_prices view below). Only the owning worker, admins and
  -- the system (service_role / SECURITY DEFINER functions) can read it.
  price         numeric(12,2) not null check (price >= 0),
  status        public.post_status not null default 'open',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint posts_slots_not_exceeded check (slots_filled <= total_slots)
);

-- =============================================================================
-- HIRE / TRANSACTION WORKFLOW
-- =============================================================================

-- public.hire_requests — a client asks to be hired on a worker's post -------
-- Lifecycle: pending -> accepted -> in_progress -> completed -> paid
--            (or pending/accepted -> cancelled | rejected)
create table public.hire_requests (
  id          uuid primary key default gen_random_uuid(),
  post_id     uuid not null references public.posts (id) on delete cascade,
  client_id   uuid not null references public.users (id) on delete cascade,
  -- Denormalized from the post for fast RLS checks. Kept correct by trigger.
  worker_id   uuid not null references public.users (id) on delete cascade,
  status      public.hire_status not null default 'pending',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  accepted_at   timestamptz,
  started_at    timestamptz,    -- first QR scan
  completed_at  timestamptz,    -- second QR scan
  paid_at       timestamptz,
  -- A client cannot hire on their own post.
  constraint hire_client_not_worker check (client_id <> worker_id)
);

-- public.qr_sessions — one QR handshake per accepted hire -------------------
-- State machine (two scans by the client, one proof submit by the worker):
--   start_pending     (state=open)   <- created on accept
--   work_in_progress  (state=closed) <- client scans #1 (job starts, escrow)
--   completion_pending(state=open)   <- worker submits proof of work
--   completed         (state=closed) <- client scans #2 (release escrow)
create table public.qr_sessions (
  id                  uuid primary key default gen_random_uuid(),
  hire_request_id     uuid not null unique references public.hire_requests (id) on delete cascade,
  -- Opaque token embedded in the QR code; rotate by issuing a new value.
  token               uuid not null unique default gen_random_uuid(),
  state               public.qr_state not null default 'open',
  stage               public.qr_stage not null default 'start_pending',
  started_at          timestamptz,
  proof_submitted_at  timestamptz,
  completed_at        timestamptz,
  created_at          timestamptz not null default now(),
  -- Keep state/stage consistent with the documented machine.
  constraint qr_state_stage_consistent check (
    (stage = 'start_pending'      and state = 'open')   or
    (stage = 'work_in_progress'   and state = 'closed') or
    (stage = 'completion_pending' and state = 'open')   or
    (stage = 'completed'          and state = 'closed')
  )
);

-- public.held_transactions — SIMULATED escrow tied to a hire ----------------
-- On job start (QR scan #1) funds leave the client wallet and sit here as
-- 'held'. On confirmation (QR scan #2) they are 'released' to the worker.
-- 'refunded' covers cancellation after holding. NOT real money.
create table public.held_transactions (
  id               uuid primary key default gen_random_uuid(),
  hire_request_id  uuid not null unique references public.hire_requests (id) on delete cascade,
  client_id        uuid not null references public.users (id) on delete cascade,
  worker_id        uuid not null references public.users (id) on delete cascade,
  amount           numeric(12,2) not null check (amount >= 0),   -- SIMULATED
  status           public.escrow_status not null default 'held',
  held_at          timestamptz not null default now(),
  released_at      timestamptz
);

-- public.proofs — worker's proof-of-work photo before payment release --------
create table public.proofs (
  id               uuid primary key default gen_random_uuid(),
  hire_request_id  uuid not null references public.hire_requests (id) on delete cascade,
  worker_id        uuid not null references public.users (id) on delete cascade,
  photo_url        text not null,   -- Supabase Storage object path / URL
  note             text,
  created_at       timestamptz not null default now()
);

-- public.receipts — e-invoice generated on completion ------------------------
create table public.receipts (
  id               uuid primary key default gen_random_uuid(),
  hire_request_id  uuid not null unique references public.hire_requests (id) on delete cascade,
  client_id        uuid not null references public.users (id) on delete cascade,
  worker_id        uuid not null references public.users (id) on delete cascade,
  amount           numeric(12,2) not null check (amount >= 0),   -- SIMULATED
  started_at       timestamptz not null,
  completed_at     timestamptz not null,
  created_at       timestamptz not null default now()
);

-- =============================================================================
-- CHAT
-- =============================================================================

-- public.chat_threads — exactly one thread per hire, unlocked on accept ------
create table public.chat_threads (
  id               uuid primary key default gen_random_uuid(),
  hire_request_id  uuid not null unique references public.hire_requests (id) on delete cascade,
  archived         boolean not null default false,
  created_at       timestamptz not null default now()
);

-- public.messages ------------------------------------------------------------
create table public.messages (
  id          uuid primary key default gen_random_uuid(),
  thread_id   uuid not null references public.chat_threads (id) on delete cascade,
  sender_id   uuid not null references public.users (id) on delete cascade,
  content     text not null check (length(trim(content)) > 0),
  created_at  timestamptz not null default now()
);

-- =============================================================================
-- RATINGS
-- =============================================================================

-- public.ratings — client rates worker once per completed+paid hire ----------
create table public.ratings (
  id               uuid primary key default gen_random_uuid(),
  -- UNIQUE guarantees a client cannot rate the same job twice.
  hire_request_id  uuid not null unique references public.hire_requests (id) on delete cascade,
  client_id        uuid not null references public.users (id) on delete cascade,
  worker_id        uuid not null references public.users (id) on delete cascade,
  rating           smallint not null check (rating between 1 and 5),
  comment          text,
  created_at       timestamptz not null default now()
);

-- =============================================================================
-- TRIGGERS & FUNCTIONS
-- =============================================================================

-- generic updated_at touch ---------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger trg_users_touch         before update on public.users           for each row execute function public.touch_updated_at();
create trigger trg_worker_touch        before update on public.worker_profiles for each row execute function public.touch_updated_at();
create trigger trg_posts_touch         before update on public.posts           for each row execute function public.touch_updated_at();
create trigger trg_hire_touch          before update on public.hire_requests   for each row execute function public.touch_updated_at();

-- On new auth user: create the public.users row + an empty wallet ------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  insert into public.users (id, email, full_name, age, role, account_status)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(new.raw_user_meta_data ->> 'age', '')::smallint,
    'client',
    'active'
  );
  insert into public.wallets (user_id, balance) values (new.id, 0);  -- SIMULATED
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Guard privileged columns on public.users -----------------------------------
-- Only admins may change `role` or `account_status` (suspend/reactivate).
-- This protects against a user escalating their own role or un-suspending.
create or replace function public.guard_user_privileged_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (new.role is distinct from old.role
      or new.account_status is distinct from old.account_status)
     and not public.is_admin(auth.uid())
     and auth.uid() is not null      -- service_role (null uid) is the system
  then
    raise exception 'Only admins can change role or account_status';
  end if;
  return new;
end;
$$;

create trigger trg_users_guard
  before update on public.users
  for each row execute function public.guard_user_privileged_columns();

-- Guard worker_profiles.status (suspension is an admin action) ---------------
create or replace function public.guard_worker_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is distinct from old.status
     and not public.is_admin(auth.uid())
     and auth.uid() is not null
  then
    raise exception 'Only admins can change worker account status';
  end if;
  return new;
end;
$$;

create trigger trg_worker_guard
  before update on public.worker_profiles
  for each row execute function public.guard_worker_status();

-- When a worker profile is created, promote role client -> worker -------------
create or replace function public.handle_worker_profile_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.users
     set role = 'worker'
   where id = new.user_id and role = 'client';  -- never demote an admin
  return new;
end;
$$;

create trigger trg_worker_profile_created
  after insert on public.worker_profiles
  for each row execute function public.handle_worker_profile_created();

-- Validate new hire_requests: populate worker_id from post & ensure open -----
create or replace function public.handle_hire_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.posts;
begin
  select * into p from public.posts where id = new.post_id for update;
  if p.id is null then
    raise exception 'Post % does not exist', new.post_id;
  end if;
  if p.status <> 'open' then
    raise exception 'Post is not open for hire requests';
  end if;
  if p.slots_filled >= p.total_slots then
    raise exception 'Post has no remaining slots';
  end if;
  -- Trust the post for the worker_id; ignore whatever the client supplied.
  new.worker_id := p.worker_id;
  if new.client_id = new.worker_id then
    raise exception 'You cannot hire on your own post';
  end if;
  return new;
end;
$$;

create trigger trg_hire_insert
  before insert on public.hire_requests
  for each row execute function public.handle_hire_insert();

-- Handle hire status transitions: slot bookkeeping, QR + chat creation -------
create or replace function public.handle_hire_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.posts;
begin
  if new.status = old.status then
    return new;
  end if;

  -- pending -> accepted : reserve a slot, open a QR session and chat thread.
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

  -- Release the reserved slot if a previously-accepted hire is cancelled.
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

create trigger trg_hire_status_change
  before update on public.hire_requests
  for each row execute function public.handle_hire_status_change();

-- Keep worker rating summary in sync -----------------------------------------
create or replace function public.handle_rating_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target uuid := coalesce(new.worker_id, old.worker_id);
begin
  update public.worker_profiles wp
     set rating_count = sub.cnt,
         rating_avg   = coalesce(sub.avg, 0)
    from (
      select count(*)::int as cnt, avg(rating)::numeric(3,2) as avg
      from public.ratings where worker_id = target
    ) sub
   where wp.user_id = target;
  return null;
end;
$$;

create trigger trg_rating_change
  after insert or update or delete on public.ratings
  for each row execute function public.handle_rating_change();

-- =============================================================================
-- RPCs (SECURITY DEFINER) — the "system" actions that move SIMULATED money
-- =============================================================================
-- These run with the caller validated inside the function body, so they can be
-- exposed safely to `authenticated` while still enforcing ownership rules.

-- QR scan #1 by the client: start the job & move funds into escrow -----------
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

  -- SIMULATED escrow: read the (hidden) post price and hold it.
  select price into amt from public.posts where id = h.post_id;

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

-- Worker submits proof of work: re-opens the QR for the client's final scan --
create or replace function public.submit_proof(p_hire uuid, p_photo_url text, p_note text default null)
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
  if h.worker_id <> auth.uid() then
    raise exception 'Only the assigned worker can submit proof';
  end if;
  if h.status <> 'in_progress' then
    raise exception 'Job must be in progress to submit proof';
  end if;

  insert into public.proofs (hire_request_id, worker_id, photo_url, note)
  values (p_hire, h.worker_id, p_photo_url, p_note);

  update public.qr_sessions
     set state = 'open', stage = 'completion_pending', proof_submitted_at = now(),
         token = gen_random_uuid()
   where hire_request_id = p_hire
  returning * into q;

  return q;
end;
$$;

-- QR scan #2 by the client: release escrow, pay worker, write receipt --------
create or replace function public.complete_hire(p_hire uuid, p_token uuid)
returns public.receipts
language plpgsql
security definer
set search_path = public
as $$
declare
  h public.hire_requests;
  q public.qr_sessions;
  esc public.held_transactions;
  r public.receipts;
begin
  select * into h from public.hire_requests where id = p_hire for update;
  if h.id is null then raise exception 'Hire not found'; end if;
  if h.client_id <> auth.uid() then
    raise exception 'Only the hiring client can confirm completion';
  end if;

  select * into q from public.qr_sessions where hire_request_id = p_hire for update;
  if q.token <> p_token or q.stage <> 'completion_pending' then
    raise exception 'Invalid QR code or proof of work not yet submitted';
  end if;

  select * into esc from public.held_transactions
   where hire_request_id = p_hire and status = 'held' for update;
  if esc.id is null then
    raise exception 'No held funds found for this hire';
  end if;

  -- SIMULATED settlement: held -> worker balance.
  update public.held_transactions
     set status = 'released', released_at = now()
   where id = esc.id;

  update public.wallets
     set balance = balance + esc.amount, updated_at = now()
   where user_id = h.worker_id;

  update public.hire_requests
     set status = 'paid', completed_at = now(), paid_at = now()
   where id = p_hire;

  update public.qr_sessions
     set state = 'closed', stage = 'completed', completed_at = now()
   where hire_request_id = p_hire;

  insert into public.receipts (hire_request_id, client_id, worker_id, amount, started_at, completed_at)
  values (p_hire, h.client_id, h.worker_id, esc.amount, h.started_at, now())
  returning * into r;

  return r;
end;
$$;

-- =============================================================================
-- ROW LEVEL SECURITY
-- =============================================================================
alter table public.users              enable row level security;
alter table public.worker_profiles    enable row level security;
alter table public.wallets            enable row level security;
alter table public.posts              enable row level security;
alter table public.hire_requests      enable row level security;
alter table public.qr_sessions        enable row level security;
alter table public.held_transactions  enable row level security;
alter table public.proofs             enable row level security;
alter table public.receipts           enable row level security;
alter table public.chat_threads       enable row level security;
alter table public.messages           enable row level security;
alter table public.ratings            enable row level security;

-- ---- users -----------------------------------------------------------------
-- A user sees only their own row; admins see everyone. No cross-user reads of
-- private data (age/email/etc). Public worker info is exposed via the
-- public_profiles view further below.
create policy users_select_self_or_admin on public.users
  for select to authenticated
  using (id = auth.uid() or public.is_admin());

-- Users edit their own profile; admins edit anyone. Privileged columns
-- (role, account_status) are additionally guarded by trg_users_guard.
create policy users_update_self_or_admin on public.users
  for update to authenticated
  using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());
-- (No INSERT/DELETE policies: rows are created by the auth trigger and
--  removed via auth.users cascade. service_role bypasses RLS for admin tooling.)

-- ---- worker_profiles -------------------------------------------------------
create policy worker_select_self_or_admin on public.worker_profiles
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- A user attaches their own worker profile (must be an active account).
create policy worker_insert_self on public.worker_profiles
  for insert to authenticated
  with check (user_id = auth.uid() and public.is_active(auth.uid()));

create policy worker_update_self_or_admin on public.worker_profiles
  for update to authenticated
  using (user_id = auth.uid() or public.is_admin())
  with check (user_id = auth.uid() or public.is_admin());

-- ---- wallets (SIMULATED) ---------------------------------------------------
-- Read-only to the owner + admins. All mutations go through SECURITY DEFINER
-- RPCs / service_role, so there are deliberately NO write policies here.
create policy wallets_select_self_or_admin on public.wallets
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- ---- posts -----------------------------------------------------------------
-- Visible: own posts (any status), admins (any), and open/full posts to all.
-- Archived/deleted posts are hidden from non-owners.
create policy posts_select on public.posts
  for select to authenticated
  using (
    public.is_admin()
    or worker_id = auth.uid()
    or status in ('open', 'full')
  );

-- Only an ACTIVE worker can create a post, and only for themselves.
create policy posts_insert_active_worker on public.posts
  for insert to authenticated
  with check (
    worker_id = auth.uid()
    and public.is_active(auth.uid())
    and public.is_active_worker(auth.uid())
  );

-- Owner (while active) can edit their post; admin can edit/archive any post.
create policy posts_update_owner_or_admin on public.posts
  for update to authenticated
  using (public.is_admin() or (worker_id = auth.uid() and public.is_active(auth.uid())))
  with check (public.is_admin() or (worker_id = auth.uid() and public.is_active(auth.uid())));

-- Owner or admin can delete a post.
create policy posts_delete_owner_or_admin on public.posts
  for delete to authenticated
  using (public.is_admin() or worker_id = auth.uid());

-- ---- hire_requests ---------------------------------------------------------
create policy hire_select_participant_or_admin on public.hire_requests
  for select to authenticated
  using (client_id = auth.uid() or worker_id = auth.uid() or public.is_admin());

-- Clients create hire requests (NOT posts). worker_id is overwritten by the
-- insert trigger, so the value supplied here is irrelevant.
create policy hire_insert_client on public.hire_requests
  for insert to authenticated
  with check (
    client_id = auth.uid()
    and status = 'pending'
    and public.is_active(auth.uid())
  );

-- Worker advances/accepts/rejects; client may cancel; admin may do anything.
-- (Status-transition side effects are handled by trg_hire_status_change.)
create policy hire_update_parties_or_admin on public.hire_requests
  for update to authenticated
  using (
    public.is_admin()
    or ((client_id = auth.uid() or worker_id = auth.uid()) and public.is_active(auth.uid()))
  )
  with check (
    public.is_admin()
    or ((client_id = auth.uid() or worker_id = auth.uid()) and public.is_active(auth.uid()))
  );

-- ---- qr_sessions -----------------------------------------------------------
-- Participants + admin can read; state changes only via RPCs / service_role.
create policy qr_select_participant_or_admin on public.qr_sessions
  for select to authenticated
  using (public.is_hire_participant(hire_request_id) or public.is_admin());

-- ---- held_transactions (SIMULATED escrow) ----------------------------------
create policy escrow_select_parties_or_admin on public.held_transactions
  for select to authenticated
  using (client_id = auth.uid() or worker_id = auth.uid() or public.is_admin());

-- ---- proofs ----------------------------------------------------------------
create policy proofs_select_participant_or_admin on public.proofs
  for select to authenticated
  using (public.is_hire_participant(hire_request_id) or public.is_admin());

-- Direct read access only; proof rows are written by submit_proof(). The worker
-- may also insert directly (e.g. if not using the RPC) provided they own the hire.
create policy proofs_insert_worker on public.proofs
  for insert to authenticated
  with check (
    worker_id = auth.uid()
    and public.is_active(auth.uid())
    and public.is_hire_participant(hire_request_id)
  );

-- ---- receipts --------------------------------------------------------------
create policy receipts_select_parties_or_admin on public.receipts
  for select to authenticated
  using (client_id = auth.uid() or worker_id = auth.uid() or public.is_admin());

-- ---- chat_threads ----------------------------------------------------------
create policy chat_select_participant_or_admin on public.chat_threads
  for select to authenticated
  using (public.is_hire_participant(hire_request_id) or public.is_admin());

-- Only admins archive threads (they update the `archived` flag).
create policy chat_update_admin on public.chat_threads
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ---- messages --------------------------------------------------------------
-- Read: participants of the hire + admins.
create policy messages_select_participant_or_admin on public.messages
  for select to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.chat_threads t
      where t.id = messages.thread_id
        and public.is_hire_participant(t.hire_request_id)
    )
  );

-- Send: must be a participant, the account must be active, the thread must not
-- be archived, and the underlying hire must be accepted (chat unlocked).
create policy messages_insert_participant on public.messages
  for insert to authenticated
  with check (
    sender_id = auth.uid()
    and public.is_active(auth.uid())
    and exists (
      select 1
      from public.chat_threads t
      join public.hire_requests h on h.id = t.hire_request_id
      where t.id = messages.thread_id
        and t.archived = false
        and (h.client_id = auth.uid() or h.worker_id = auth.uid())
        and h.status in ('accepted', 'in_progress', 'completed', 'paid')
    )
  );

-- ---- ratings ---------------------------------------------------------------
create policy ratings_select_parties_or_admin on public.ratings
  for select to authenticated
  using (client_id = auth.uid() or worker_id = auth.uid() or public.is_admin());

-- Client rates the worker only after the hire is paid; UNIQUE(hire_request_id)
-- blocks rating the same job twice.
create policy ratings_insert_client on public.ratings
  for insert to authenticated
  with check (
    client_id = auth.uid()
    and public.is_active(auth.uid())
    and exists (
      select 1 from public.hire_requests h
      where h.id = ratings.hire_request_id
        and h.client_id = auth.uid()
        and h.worker_id = ratings.worker_id
        and h.status = 'paid'
    )
  );

-- =============================================================================
-- PRICE HIDING  (column-level privileges + owner/admin-only view)
-- =============================================================================
-- RLS is row-level, so to hide a single COLUMN we use column privileges:
-- revoke all column access, then grant every column EXCEPT `price` to clients.
-- Clients literally cannot SELECT posts.price. The owning worker / admins read
-- it through public.post_owner_prices, and the system uses service_role.
revoke all on public.posts from anon, authenticated;
grant select (id, worker_id, caption, total_slots, slots_filled, status, created_at, updated_at)
  on public.posts to authenticated;
grant insert (worker_id, caption, total_slots, price, status)
  on public.posts to authenticated;
grant update (caption, total_slots, slots_filled, price, status, updated_at)
  on public.posts to authenticated;
grant delete on public.posts to authenticated;

-- Owner/admin-only window onto the price. This view is SECURITY DEFINER (runs
-- as its owner, bypassing the column revoke) and gates access in its WHERE.
create or replace view public.post_owner_prices
with (security_invoker = false) as
  select p.id as post_id, p.worker_id, p.price
  from public.posts p
  where p.worker_id = auth.uid() or public.is_admin();

grant select on public.post_owner_prices to authenticated;

-- =============================================================================
-- PUBLIC PROFILE VIEW (safe, non-private worker info for the feed)
-- =============================================================================
-- Exposes only id / display name / worker bio + rating for ACTIVE workers.
-- Keeps age, email and account status private. SECURITY DEFINER + filtered.
create or replace view public.public_profiles
with (security_invoker = false) as
  select
    u.id,
    u.full_name,
    wp.bio,
    wp.rating_avg,
    wp.rating_count
  from public.users u
  left join public.worker_profiles wp on wp.user_id = u.id
  where wp.status = 'active' and u.account_status = 'active';

grant select on public.public_profiles to authenticated, anon;

-- =============================================================================
-- INDEXES
-- =============================================================================
-- Feed listing: filter by status, newest first.
create index idx_posts_status_created on public.posts (status, created_at desc);
create index idx_posts_worker         on public.posts (worker_id);

-- Hire requests by either party and by post; quick status filtering.
create index idx_hire_client  on public.hire_requests (client_id);
create index idx_hire_worker  on public.hire_requests (worker_id);
create index idx_hire_post    on public.hire_requests (post_id);
create index idx_hire_status  on public.hire_requests (status);

-- Chat: messages by thread (newest first) and by hire; thread by hire.
create index idx_messages_thread_created on public.messages (thread_id, created_at desc);
create index idx_messages_created        on public.messages (created_at desc);  -- admin: this week vs older
create index idx_chat_threads_hire       on public.chat_threads (hire_request_id);
create index idx_chat_threads_created    on public.chat_threads (created_at desc);

-- Escrow / receipts / ratings lookups.
create index idx_escrow_hire    on public.held_transactions (hire_request_id);
create index idx_escrow_client  on public.held_transactions (client_id);
create index idx_escrow_worker  on public.held_transactions (worker_id);
create index idx_receipts_client on public.receipts (client_id);
create index idx_receipts_worker on public.receipts (worker_id);
create index idx_ratings_worker  on public.ratings (worker_id);
create index idx_proofs_hire     on public.proofs (hire_request_id);

-- =============================================================================
-- FUNCTION EXECUTE GRANTS
-- =============================================================================
grant execute on function public.start_hire(uuid, uuid)            to authenticated;
grant execute on function public.submit_proof(uuid, text, text)    to authenticated;
grant execute on function public.complete_hire(uuid, uuid)         to authenticated;
grant execute on function public.is_admin(uuid)                    to authenticated;
grant execute on function public.is_active(uuid)                   to authenticated;
grant execute on function public.is_active_worker(uuid)            to authenticated;
grant execute on function public.is_hire_participant(uuid, uuid)   to authenticated;

-- =============================================================================
-- TABLE PRIVILEGE GRANTS
-- =============================================================================
-- RLS decides WHICH ROWS a user can touch, but the `authenticated` role still
-- needs base table privileges for each command, or every query fails with
-- "permission denied for table ...". The grants below mirror each table's RLS
-- policies above. (public.posts is intentionally omitted — it uses the
-- column-level grants in the PRICE HIDING section to keep `price` private.)
grant select, update         on public.users             to authenticated;
grant select, insert, update on public.worker_profiles   to authenticated;
grant select                 on public.wallets           to authenticated;
grant select, insert, update on public.hire_requests     to authenticated;
grant select                 on public.qr_sessions       to authenticated;
grant select                 on public.held_transactions to authenticated;
grant select, insert         on public.proofs            to authenticated;
grant select                 on public.receipts          to authenticated;
grant select, update         on public.chat_threads      to authenticated;
grant select, insert         on public.messages          to authenticated;
grant select, insert         on public.ratings           to authenticated;
