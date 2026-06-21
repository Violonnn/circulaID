-- =============================================================================
-- CirculaID — Expose avatar_url through the public views + worker→client RPC
-- =============================================================================
-- Profile photos (users.avatar_url) need to be readable wherever a person is
-- shown: the client feed, post detail, hires, and chat. We surface it through
-- the same safe, privacy-preserving surfaces that already expose names:
--   * public_profiles        (active workers — used for worker avatars)
--   * public_worker_posts     (feed cards — the poster's avatar)
--   * client_names_for_worker (a worker may see avatars of THEIR clients only)
-- =============================================================================

-- Active-worker public profile now carries the avatar URL too.
create or replace view public.public_profiles
with (security_invoker = false) as
  select
    u.id,
    u.full_name,
    wp.bio,
    wp.rating_avg,
    wp.rating_count,
    u.avatar_url
  from public.users u
  left join public.worker_profiles wp on wp.user_id = u.id
  where wp.status = 'active' and u.account_status = 'active';

grant select on public.public_profiles to authenticated, anon;

-- Feed cards carry the poster's avatar (price still intentionally omitted).
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
    u.avatar_url as worker_avatar_url
  from public.worker_posts wp
  join public.users u on u.id = wp.worker_id
  join public.worker_profiles prof on prof.user_id = wp.worker_id
  where wp.status = 'active'
    and prof.status = 'active'
    and u.account_status = 'active';

grant select on public.public_worker_posts to authenticated, anon;

-- A worker may read the avatar of a client who has hired them (same disclosure
-- rule as the name). Return type changes, so drop + recreate.
drop function if exists public.client_names_for_worker(uuid[]);
create function public.client_names_for_worker(p_client_ids uuid[])
returns table (id uuid, full_name text, avatar_url text)
language sql
stable
security definer
set search_path = public
as $$
  select u.id, u.full_name, u.avatar_url
  from public.users u
  where u.id = any (p_client_ids)
    and exists (
      select 1
      from public.hire_requests hr
      where hr.client_id = u.id
        and hr.worker_id = auth.uid()
    );
$$;

grant execute on function public.client_names_for_worker(uuid[]) to authenticated;
