-- =============================================================================
-- CirculaID — Free a skill-post slot when a hire is COMPLETED (paid)
-- =============================================================================
-- slots_filled is meant to track a worker_post's CURRENT active engagements:
--   * pending            -> does NOT hold a slot (only the insert is validated)
--   * accepted / in_progress -> holds a slot (reserved on accept)
--   * cancelled / rejected   -> releases the slot (already handled)
--   * completed / paid       -> releases the slot  <-- ADDED HERE
--
-- Previously a finished (paid) job kept its slot forever, so a worker who filled
-- every slot could never be hired again even after the work was done. Now the
-- slot frees on completion, so the count reflects who the worker is CURRENTLY
-- engaged with. Hiring when full stays blocked by handle_hire_insert (which
-- already raises "This skill post has no remaining slots"). Pure slot bookkeeping
-- — no change to any escrow/payment logic.
-- =============================================================================

set check_function_bodies = off;

create or replace function public.handle_hire_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  p  public.posts;
  wp public.worker_posts;
begin
  if new.status = old.status then
    return new;
  end if;

  -- WORKER_POST FLOW ----------------------------------------------------------
  if new.worker_post_id is not null then
    -- pending -> accepted : reserve a slot (re-checked under a row lock), open
    -- the locked chat thread AND the QR session for the escrow flow.
    if old.status = 'pending' and new.status = 'accepted' then
      select * into wp from public.worker_posts where id = new.worker_post_id for update;
      if wp.slots_filled + 1 > wp.total_slots then
        raise exception 'No remaining slots on this post';
      end if;
      update public.worker_posts
         set slots_filled = slots_filled + 1
       where id = wp.id;

      new.accepted_at := now();

      insert into public.qr_sessions (hire_request_id)
      values (new.id)
      on conflict (hire_request_id) do nothing;

      insert into public.chat_threads (hire_request_id)
      values (new.id)
      on conflict (hire_request_id) do nothing;
    end if;

    -- Release the reserved slot if a previously-accepted hire is undone.
    if old.status in ('accepted', 'in_progress')
       and new.status in ('cancelled', 'rejected') then
      update public.worker_posts
         set slots_filled = greatest(slots_filled - 1, 0)
       where id = new.worker_post_id;
    end if;

    -- Release the slot once the job is FINISHED (completed/paid), so the worker
    -- frees capacity to take new clients. old.status guards against a double
    -- release (a row that already left accepted/in_progress won't decrement).
    if old.status in ('accepted', 'in_progress')
       and new.status in ('completed', 'paid') then
      update public.worker_posts
         set slots_filled = greatest(slots_filled - 1, 0)
       where id = new.worker_post_id;
    end if;

    return new;
  end if;

  -- LEGACY posts FLOW (unchanged) ---------------------------------------------
  if old.status = 'pending' and new.status = 'accepted' then
    select * into p from public.posts where id = new.post_id for update;
    if p.slots_filled + 1 > p.total_slots then
      raise exception 'No remaining slots on this post';
    end if;
    update public.posts
       set slots_filled = slots_filled + 1,
           status = case when slots_filled + 1 >= total_slots then 'full' else status end
     where id = p.id;

    new.accepted_at := now();

    insert into public.qr_sessions (hire_request_id)
    values (new.id)
    on conflict (hire_request_id) do nothing;

    insert into public.chat_threads (hire_request_id)
    values (new.id)
    on conflict (hire_request_id) do nothing;
  end if;

  if old.status in ('accepted', 'in_progress')
     and new.status in ('cancelled', 'rejected') then
    update public.posts
       set slots_filled = greatest(slots_filled - 1, 0),
           status = case when status = 'full' then 'open' else status end
     where id = new.post_id;
  end if;

  return new;
end;
$$;
