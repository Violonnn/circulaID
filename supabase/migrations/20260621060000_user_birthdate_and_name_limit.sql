-- =============================================================================
-- CirculaID — Birth date on the account + weekly name-change limit
-- =============================================================================
-- The profile screen now shows the user's birth month/year (and derived age) and
-- lets them edit their birth month/year, name and phone inline. To support that
-- we store the full birth_date (we already collect it at registration) and track
-- when the name was last changed so we can limit name edits to once per week.
-- =============================================================================

alter table public.users
  add column if not exists birth_date      date,
  add column if not exists name_updated_at timestamptz;

-- Enforce the "name editable once per 7 days" rule at the database level (the app
-- also guards it for a friendly message, but the DB is the real gate). The same
-- trigger stamps name_updated_at whenever the name actually changes, so the app
-- never has to set it by hand. Admins and the system (service_role, null uid) are
-- exempt.
create or replace function public.guard_user_name_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.full_name is distinct from old.full_name then
    if auth.uid() is not null and not public.is_admin(auth.uid()) then
      if old.name_updated_at is not null
         and old.name_updated_at > now() - interval '7 days' then
        raise exception 'NAME_CHANGE_TOO_SOON';
      end if;
    end if;
    new.name_updated_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_users_name_guard on public.users;
create trigger trg_users_name_guard
  before update on public.users
  for each row execute function public.guard_user_name_change();

-- Capture birth_date passed as auth metadata at sign-up. Everything else in the
-- trigger is unchanged from the previous version.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  insert into public.users (id, email, full_name, age, phone_number, birth_date, role, account_status)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(new.raw_user_meta_data ->> 'age', '')::smallint,
    nullif(new.raw_user_meta_data ->> 'phone_number', ''),
    nullif(new.raw_user_meta_data ->> 'birth_date', '')::date,
    'client',
    'active'
  );
  insert into public.wallets (user_id, balance) values (new.id, 0);
  return new;
end;
$$;
