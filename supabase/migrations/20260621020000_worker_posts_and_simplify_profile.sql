-- =============================================================================
-- CirculaID — Worker skill posts + simplified worker profile
-- =============================================================================
-- This migration supports the revised "client becomes a worker" flow:
--   * worker_profiles is simplified to bio + location only. The old setup-form
--     columns (category, years_experience) are removed from the profile level;
--     "experience length" now lives PER skill post instead.
--   * worker_posts: up to 3 active skill/job offers per worker. Each row carries
--     an AI-generated (or fallback) title + short description used to render a
--     feed card, plus the per-post slots, experience length and (SIMULATED)
--     pricing rate.
--
-- All money here is SIMULATED test data (no real payment), consistent with the
-- rest of the schema.
-- =============================================================================

set check_function_bodies = off;

-- -----------------------------------------------------------------------------
-- 1. Simplify worker_profiles — category + years_experience are gone.
-- -----------------------------------------------------------------------------
-- Idempotent so a later `supabase db push` is safe. `location` and `bio` stay.
alter table public.worker_profiles
  drop column if exists category,
  drop column if exists years_experience;

-- -----------------------------------------------------------------------------
-- 2. worker_posts — a worker's skill/job offers (max 3 active, enforced in app).
-- -----------------------------------------------------------------------------
-- status is a small text domain ('active' / 'archived') rather than the existing
-- post_status enum: this is a separate, simpler lifecycle (archiving/deleting is
-- a future prompt). pricing_rate is SIMULATED test money.
create table if not exists public.worker_posts (
  id                   uuid primary key default gen_random_uuid(),
  worker_id            uuid not null references public.users (id) on delete cascade,
  -- Per-post capacity (1..5), independent of the 3-active-posts cap.
  total_slots          integer not null check (total_slots between 1 and 5),
  slots_filled         integer not null default 0 check (slots_filled >= 0),
  -- The worker's own words: what they offer + why they're credible.
  description          text not null check (length(trim(description)) > 0),
  -- Human-readable experience band chosen from a fixed dropdown.
  experience_length    text not null,
  -- SIMULATED price the worker is charging. Owner/admin-readable only (see RLS).
  pricing_rate         numeric(12,2) not null check (pricing_rate >= 0),
  -- AI-generated (or non-AI fallback) feed-card copy. Both always populated so a
  -- Gemini outage never blocks posting (the app writes a fallback instead).
  ai_title             text not null,
  ai_short_description text not null,
  status               text not null default 'active' check (status in ('active', 'archived')),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint worker_posts_slots_not_exceeded check (slots_filled <= total_slots)
);

create index if not exists idx_worker_posts_worker on public.worker_posts (worker_id);
create index if not exists idx_worker_posts_status_created on public.worker_posts (status, created_at desc);

-- updated_at touch (reuses the generic trigger function from the initial schema).
drop trigger if exists trg_worker_posts_touch on public.worker_posts;
create trigger trg_worker_posts_touch
  before update on public.worker_posts
  for each row execute function public.touch_updated_at();

-- -----------------------------------------------------------------------------
-- 3. Row Level Security
-- -----------------------------------------------------------------------------
alter table public.worker_posts enable row level security;

-- READ: for now only the owning worker + admins. The CLIENT-facing browse feed
-- is intentionally NOT given read access here yet — exposing these rows to all
-- clients (without leaking pricing_rate) is a separate follow-up that should add
-- a price-free public view, mirroring public_profiles / post_owner_prices.
drop policy if exists worker_posts_select_owner_or_admin on public.worker_posts;
create policy worker_posts_select_owner_or_admin on public.worker_posts
  for select to authenticated
  using (worker_id = auth.uid() or public.is_admin());

-- INSERT: only an ACTIVE worker, only for themselves (mirrors posts_insert).
drop policy if exists worker_posts_insert_active_worker on public.worker_posts;
create policy worker_posts_insert_active_worker on public.worker_posts
  for insert to authenticated
  with check (
    worker_id = auth.uid()
    and public.is_active(auth.uid())
    and public.is_active_worker(auth.uid())
  );

-- UPDATE: owner (while active) or admin (e.g. future archive flow, slot changes).
drop policy if exists worker_posts_update_owner_or_admin on public.worker_posts;
create policy worker_posts_update_owner_or_admin on public.worker_posts
  for update to authenticated
  using (public.is_admin() or (worker_id = auth.uid() and public.is_active(auth.uid())))
  with check (public.is_admin() or (worker_id = auth.uid() and public.is_active(auth.uid())));

-- DELETE: owner or admin (not used by the app yet; defense in depth).
drop policy if exists worker_posts_delete_owner_or_admin on public.worker_posts;
create policy worker_posts_delete_owner_or_admin on public.worker_posts
  for delete to authenticated
  using (public.is_admin() or worker_id = auth.uid());

-- RLS gates WHICH rows; the role still needs base table privileges per command.
grant select, insert, update, delete on public.worker_posts to authenticated;
