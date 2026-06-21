-- =============================================================================
-- CirculaID — Show the reviewer's name + photo on a worker's reviews
-- =============================================================================
-- Product decision: reviews on the skill-post detail screen now show WHO left
-- them (the reviewing client's name + avatar), instead of being anonymous. We
-- add the client's full_name + avatar_url to the public_worker_reviews view.
-- New columns are appended at the end (create-or-replace view only allows that).
-- =============================================================================

set check_function_bodies = off;

create or replace view public.public_worker_reviews
with (security_invoker = false) as
  select
    r.id,
    r.worker_id,
    r.rating,
    r.comment,
    r.created_at,
    hr.post_title as hired_for,
    cu.full_name  as reviewer_name,
    cu.avatar_url as reviewer_avatar_url
  from public.ratings r
  join public.worker_profiles wp on wp.user_id = r.worker_id
  join public.hire_requests hr on hr.id = r.hire_request_id
  join public.users cu on cu.id = r.client_id
  where wp.status = 'active';

grant select on public.public_worker_reviews to authenticated, anon;
