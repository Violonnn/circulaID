-- =============================================================================
-- CirculaID — Include the worker's name in the review summary.
-- =============================================================================
-- The first version produced generic copy ("workers generally..."). The summary
-- should name the specific worker. We return the worker's display name
-- (title-cased) from public.users alongside the review text so summarize-reviews
-- can put it in the prompt. The name is read here (definer), not trusted from the
-- client. Existing generic summaries are invalidated so they regenerate.
-- =============================================================================

set check_function_bodies = off;

-- Return type changes, so drop + recreate.
drop function if exists public.get_or_check_review_summary(uuid);

create or replace function public.get_or_check_review_summary(p_worker uuid)
returns table(needs_refresh boolean, summary text, worker_name text, review_texts text[])
language plpgsql
security definer
set search_path = public
as $$
declare
  v_summary text;
  v_updated timestamptz;
  v_name text;
begin
  -- Guard: no worker id -> nothing to do.
  if p_worker is null then
    return query select false, null::text, null::text, null::text[];
    return;
  end if;

  select ai_review_summary, ai_summary_updated_at
    into v_summary, v_updated
    from public.worker_profiles
   where user_id = p_worker;

  -- Fresh cache (< 7 days) -> hand it back, no Gemini call needed.
  if v_summary is not null and v_updated is not null
     and v_updated > now() - interval '7 days' then
    return query select false, v_summary, null::text, null::text[];
    return;
  end if;

  -- The worker's display name, title-cased (e.g. "Maria Santos").
  select initcap(full_name) into v_name from public.users where id = p_worker;

  -- Stale/missing -> return the real, non-empty review comments to summarize.
  return query
    select true,
           null::text,
           v_name,
           array(
             select trim(r.comment)
               from public.ratings r
              where r.worker_id = p_worker
                and r.comment is not null
                and length(trim(r.comment)) > 0
           );
end;
$$;

grant execute on function public.get_or_check_review_summary(uuid) to authenticated;

-- Invalidate existing generic summaries so they regenerate with the worker name.
update public.worker_profiles
   set ai_review_summary = null, ai_summary_updated_at = null
 where ai_review_summary is not null;
