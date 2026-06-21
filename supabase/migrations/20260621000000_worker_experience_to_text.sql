-- =============================================================================
-- CirculaID — Worker experience stored as a text range label
-- =============================================================================
-- The setup form now collects experience as a human-readable range (e.g.
-- 'Less than 3 months', '5 years') chosen from a dropdown, instead of a raw
-- integer. Store it as text so the exact choice is preserved for display and for
-- the AI bio prompt. Drop the old non-negative integer check first.
-- =============================================================================

alter table public.worker_profiles
  drop constraint if exists worker_profiles_years_experience_check;

alter table public.worker_profiles
  alter column years_experience type text using years_experience::text;
