-- =============================================================================
-- CirculaID — Cache for the AI-generated summary of a worker's reviews.
-- =============================================================================
-- Reviews are tied to the WORKER (across all their skill posts), not to a single
-- post (see public_worker_reviews / lib/ratings.fetchReviews). So the summary and
-- its freshness timestamp live on worker_profiles (one per worker), NOT per post.
--
-- Both columns are nullable: a worker with fewer than 2 reviews simply has no
-- summary. These columns are written ONLY by the `summarize-reviews` Edge
-- Function using the service role (it builds the prompt, calls Gemini, and caches
-- the result), so no additional RLS policy is required — clients never read or
-- write these columns directly; they receive the summary from the function.
-- =============================================================================

alter table public.worker_profiles
  add column if not exists ai_review_summary text,
  add column if not exists ai_summary_updated_at timestamptz;
