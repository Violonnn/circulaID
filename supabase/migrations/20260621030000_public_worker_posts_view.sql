-- =============================================================================
-- CirculaID — Public (client-facing) view of worker skill posts
-- =============================================================================
-- The client browse feed needs to read other workers' active skill posts, but
-- worker_posts RLS is owner/admin-only AND pricing_rate must never reach a
-- client. This view exposes only the safe, price-free fields for ACTIVE posts of
-- ACTIVE workers — mirroring the existing public_profiles / post_owner_prices
-- pattern. pricing_rate is intentionally omitted (clients never see it).
-- =============================================================================

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
    wp.created_at
  from public.worker_posts wp
  join public.users u on u.id = wp.worker_id
  join public.worker_profiles prof on prof.user_id = wp.worker_id
  where wp.status = 'active'
    and prof.status = 'active'
    and u.account_status = 'active';

grant select on public.public_worker_posts to authenticated, anon;
