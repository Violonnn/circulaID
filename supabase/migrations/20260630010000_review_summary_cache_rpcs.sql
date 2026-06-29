-- =============================================================================
-- CirculaID — SECURITY DEFINER helpers for the AI review summary cache.
-- =============================================================================
-- Edge Functions in this project receive the NEW short API keys
-- (sb_secret / sb_publishable). The injected SUPABASE_SERVICE_ROLE_KEY does NOT
-- grant PostgREST table access here — a service-role client read of `ratings`
-- fails with "permission denied for table ratings". So rather than rely on a
-- service-role client, the `summarize-reviews` function calls these definer RPCs
-- with the user's normal authenticated token.
--
-- They run as the owner (bypassing RLS/grants) and read the review text from the
-- database itself (never from the client), so the shared cache can't be poisoned
-- with fake review text. This mirrors the app's existing definer-RPC pattern
-- (delete_worker_post, send_final_price, etc.).
-- =============================================================================

set check_function_bodies = off;

-- Returns whether a refresh is needed. When the cache is fresh (< 7 days) it
-- returns the cached summary and needs_refresh=false. Otherwise it returns the
-- worker's real review comments so the caller can summarize them.
create or replace function public.get_or_check_review_summary(p_worker uuid)
returns table(needs_refresh boolean, summary text, review_texts text[])
language plpgsql
security definer
set search_path = public
as $$
declare
  v_summary text;
  v_updated timestamptz;
begin
  -- Guard: no worker id -> nothing to do (no refresh, no summary).
  if p_worker is null then
    return query select false, null::text, null::text[];
    return;
  end if;

  select ai_review_summary, ai_summary_updated_at
    into v_summary, v_updated
    from public.worker_profiles
   where user_id = p_worker;

  -- Fresh cache (< 7 days) -> hand it back, no Gemini call needed.
  if v_summary is not null and v_updated is not null
     and v_updated > now() - interval '7 days' then
    return query select false, v_summary, null::text[];
    return;
  end if;

  -- Stale/missing -> return the real, non-empty review comments to summarize.
  return query
    select true,
           null::text,
           array(
             select trim(r.comment)
               from public.ratings r
              where r.worker_id = p_worker
                and r.comment is not null
                and length(trim(r.comment)) > 0
           );
end;
$$;

-- Persists a freshly generated summary onto the worker's profile (definer, so it
-- bypasses the owner-only RLS on worker_profiles).
create or replace function public.set_review_summary(p_worker uuid, p_summary text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Guard: need both a worker and a non-empty summary to store.
  if p_worker is null or p_summary is null or length(trim(p_summary)) = 0 then
    return;
  end if;

  update public.worker_profiles
     set ai_review_summary = p_summary,
         ai_summary_updated_at = now()
   where user_id = p_worker;
end;
$$;

grant execute on function public.get_or_check_review_summary(uuid) to authenticated;
grant execute on function public.set_review_summary(uuid, text) to authenticated;
