-- =============================================================================
-- CirculaID — Uniqueness validation for email + phone number
-- =============================================================================
-- RLS hides every other user's row, so the app cannot SELECT public.users to
-- see if an email/phone is already taken. These SECURITY DEFINER functions
-- answer a single yes/no question ("is this value already in use?") without
-- exposing any other user data, so the register + edit-profile screens can warn
-- the user BEFORE submitting.
--
-- NOTE (account enumeration): exposing "email/phone in use" to anon does allow
-- probing whether a value is registered. That is the explicit product request
-- (block duplicate registrations with a clear message); the functions reveal
-- nothing beyond the boolean.
--
-- A unique index on lower(email) is added as the real guarantee. A matching
-- unique index on phone_number is intentionally NOT added here because the
-- existing test data already contains a duplicate phone; the phone_in_use()
-- check below is the enforced guard until those rows use distinct numbers.
-- =============================================================================

-- Real DB guarantee for email (no duplicates exist today, so this is safe).
create unique index if not exists users_email_unique
  on public.users (lower(email))
  where email is not null;

-- Is this email already attached to an account? Case-insensitive.
create or replace function public.email_in_use(p_email text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.users
    where lower(email) = lower(trim(p_email))
  );
$$;

grant execute on function public.email_in_use(text) to anon, authenticated;

-- Is this phone number already attached to ANOTHER account? When called by a
-- signed-in user (editing their details), their own row is excluded so saving
-- their existing number back is never flagged. For anonymous callers
-- (registration) auth.uid() is null, so every match counts.
create or replace function public.phone_in_use(p_phone text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.users
    where phone_number = p_phone
      and id <> coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid)
  );
$$;

grant execute on function public.phone_in_use(text) to anon, authenticated;
