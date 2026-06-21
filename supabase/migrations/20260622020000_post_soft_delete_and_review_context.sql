-- =============================================================================
-- CirculaID — Worker post SOFT DELETE + reviewer "hired for" context
-- =============================================================================
-- Two small, additive changes:
--
--   1. delete_worker_post(p_post): a SECURITY DEFINER RPC that SOFT-deletes a
--      skill post (sets status='archived' — never a hard DELETE). Ownership and
--      the "no active hires" rule are BOTH re-checked server-side here, so a
--      client-side guard can never be the only thing protecting the row. The
--      ratings / receipts / held_transactions tied to the post are untouched,
--      so reviews stay fully visible after a post is "deleted".
--
--      We reuse the existing 'archived' value of the worker_posts status check
--      (the enum is just check (status in ('active','archived')) — there is no
--      'deleted' value), so no enum/constraint migration is needed. The client
--      feed (public_worker_posts) and the worker's active Job list already show
--      only status='active', so an archived post disappears from both.
--
--   2. public_worker_reviews gains `hired_for`: the denormalized job title from
--      the rating's hire_request (hire_requests.post_title). This is PUBLIC post
--      copy only — it never exposes the reviewing client's identity, matching
--      the existing privacy of the reviews view.
-- =============================================================================

set check_function_bodies = off;

-- 1. Soft-delete RPC ----------------------------------------------------------
create or replace function public.delete_worker_post(p_post uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  wp public.worker_posts;
begin
  select * into wp from public.worker_posts where id = p_post for update;
  -- Guard: the post must exist.
  if wp.id is null then
    raise exception 'Post not found';
  end if;
  -- Guard: only the owning worker (verified via the session, not a param) may
  -- delete. RLS also restricts updates to the owner; this is defense in depth.
  if wp.worker_id <> auth.uid() then
    raise exception 'You can only delete your own posts';
  end if;
  -- Guard: block deletion while any NON-TERMINAL hire is tied to this post
  -- (pending / accepted / in_progress — which also covers the derived
  -- pending_payment + pending_confirmation phases). Hires that are only
  -- rejected / cancelled / paid are terminal, so the post is safe to delete.
  if exists (
    select 1 from public.hire_requests
     where worker_post_id = p_post
       and status in ('pending', 'accepted', 'in_progress')
  ) then
    raise exception 'This post has active hire requests and can''t be deleted yet';
  end if;

  -- Soft delete only: flip the status flag, keep the row (and everything that
  -- references it — ratings, receipts, held_transactions) intact.
  update public.worker_posts
     set status = 'archived', updated_at = now()
   where id = p_post;
end;
$$;

grant execute on function public.delete_worker_post(uuid) to authenticated;

-- 2. Reviews view + the job title each review was left for --------------------
create or replace view public.public_worker_reviews
with (security_invoker = false) as
  select
    r.id,
    r.worker_id,
    r.rating,
    r.comment,
    r.created_at,
    -- Denormalized, PUBLIC job label (no client identity) for "Hired for: …".
    hr.post_title as hired_for
  from public.ratings r
  join public.worker_profiles wp on wp.user_id = r.worker_id
  join public.hire_requests hr on hr.id = r.hire_request_id
  where wp.status = 'active';

grant select on public.public_worker_reviews to authenticated, anon;
