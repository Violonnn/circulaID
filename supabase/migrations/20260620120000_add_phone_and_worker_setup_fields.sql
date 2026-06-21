-- =============================================================================
-- CirculaID — Phone number + worker setup fields
-- =============================================================================
-- Adds the account phone number (collected at registration, stored normalized to
-- the +63 format) and the extra worker_profiles columns filled in by the
-- "become a worker" setup flow (category / years of experience / location).
-- =============================================================================

-- Phone number on the account (normalized +63 format, set at registration).
-- Nullable so any pre-existing row is not invalidated; the app enforces it as
-- required on the registration form going forward.
alter table public.users
  add column if not exists phone_number text;

-- Worker setup fields collected by the "become a worker" flow. Kept nullable so
-- the existing bio-only worker_profiles shape stays valid; the setup form fills
-- them in. years_experience is a whole, non-negative count of years.
alter table public.worker_profiles
  add column if not exists category        text,
  add column if not exists years_experience integer check (years_experience is null or years_experience >= 0),
  add column if not exists location         text;

-- Capture the phone number passed as auth metadata at sign-up. We only touch the
-- INSERT body to read raw_user_meta_data ->> 'phone_number'; everything else in
-- the trigger is unchanged from the initial schema.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  insert into public.users (id, email, full_name, age, phone_number, role, account_status)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(new.raw_user_meta_data ->> 'age', '')::smallint,
    nullif(new.raw_user_meta_data ->> 'phone_number', ''),
    'client',
    'active'
  );
  insert into public.wallets (user_id, balance) values (new.id, 0);  -- SIMULATED
  return new;
end;
$$;
