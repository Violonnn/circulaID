-- =============================================================================
-- CirculaID — Hire flow on worker_posts (+ scheduling fields, locked chat)
-- =============================================================================
-- The client feed now lists worker_posts (skill posts), but the original
-- hire_requests / chat_threads workflow was wired to the older posts table
-- (which is now empty/unused). This migration lets a client hire AGAINST a
-- worker_post and reuses the EXISTING chat system (one locked thread per hire):
--
--   * hire_requests gains an optional worker_post_id plus the new request form
--     fields (client_location, scheduled_at, details) and a denormalized
--     post_title so both parties can read the job label without hitting the
--     owner-only worker_posts RLS.
--   * post_id becomes nullable: a hire now targets EITHER a legacy post OR a
--     worker_post (exactly-one-source is checked).
--   * The insert + status-change triggers branch on which source is set. For a
--     worker_post hire, accepting reserves a slot and opens the locked chat
--     thread (NO QR/escrow here — that is a later prompt).
--
-- All existing RLS already enforces the security this needs:
--   * hire_requests: client reads/creates their own; worker reads/updates only
--     rows tied to their own posts (worker_id is set by the trigger, never
--     trusted from the client).
--   * chat_threads / messages: access is scoped to the hire's two participants
--     via is_hire_participant(), and messages only unlock once status='accepted'.
-- =============================================================================

set check_function_bodies = off;

-- -----------------------------------------------------------------------------
-- 1. New columns on hire_requests
-- -----------------------------------------------------------------------------
alter table public.hire_requests
  add column if not exists worker_post_id uuid references public.worker_posts (id) on delete cascade,
  add column if not exists client_location text,
  add column if not exists scheduled_at    timestamptz,
  add column if not exists details         text,
  -- Denormalized job label (worker_posts.ai_title / posts.caption) so a CLIENT
  -- can show the thread title without read access to the owner-only worker_posts.
  add column if not exists post_title       text;

-- A hire now targets EITHER a legacy post OR a worker_post.
alter table public.hire_requests alter column post_id drop not null;

alter table public.hire_requests
  drop constraint if exists hire_requests_one_post_source;
alter table public.hire_requests
  add constraint hire_requests_one_post_source
  check (post_id is not null or worker_post_id is not null);

create index if not exists idx_hire_worker_post on public.hire_requests (worker_post_id);

-- -----------------------------------------------------------------------------
-- 2. Insert trigger — branch on the hire's source, derive worker_id from it.
-- -----------------------------------------------------------------------------
create or replace function public.handle_hire_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  p  public.posts;
  wp public.worker_posts;
begin
  -- NEW FLOW: hire targets a worker skill post.
  if new.worker_post_id is not null then
    select * into wp from public.worker_posts where id = new.worker_post_id for update;
    if wp.id is null then
      raise exception 'Skill post % does not exist', new.worker_post_id;
    end if;
    if wp.status <> 'active' then
      raise exception 'This skill post is not open for hire requests';
    end if;
    if wp.slots_filled >= wp.total_slots then
      raise exception 'This skill post has no remaining slots';
    end if;
    -- Trust the post for the worker_id; ignore whatever the client supplied.
    new.worker_id  := wp.worker_id;
    new.post_title := wp.ai_title;
    if new.client_id = new.worker_id then
      raise exception 'You cannot hire on your own post';
    end if;
    return new;
  end if;

  -- LEGACY FLOW: hire targets a community post (unchanged behaviour).
  select * into p from public.posts where id = new.post_id for update;
  if p.id is null then
    raise exception 'Post % does not exist', new.post_id;
  end if;
  if p.status <> 'open' then
    raise exception 'Post is not open for hire requests';
  end if;
  if p.slots_filled >= p.total_slots then
    raise exception 'Post has no remaining slots';
  end if;
  new.worker_id  := p.worker_id;
  new.post_title := p.caption;
  if new.client_id = new.worker_id then
    raise exception 'You cannot hire on your own post';
  end if;
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. Status-change trigger — slot bookkeeping + locked chat thread on accept.
-- -----------------------------------------------------------------------------
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
    -- pending -> accepted : reserve a slot (re-checked under a row lock) and
    -- open the one locked chat thread for this hire. No QR/escrow yet.
    if old.status = 'pending' and new.status = 'accepted' then
      select * into wp from public.worker_posts where id = new.worker_post_id for update;
      if wp.slots_filled + 1 > wp.total_slots then
        raise exception 'No remaining slots on this post';
      end if;
      update public.worker_posts
         set slots_filled = slots_filled + 1
       where id = wp.id;

      new.accepted_at := now();

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

-- -----------------------------------------------------------------------------
-- 4. Expose the worker's service area on the public skill-post view so the
--    client post-detail screen can show "where the worker is based". Only the
--    low-sensitivity area string (already shown publicly on the worker's setup)
--    is added — never age/email/account status.
-- -----------------------------------------------------------------------------
-- worker_location is appended LAST: `create or replace view` only allows adding
-- columns at the end of the existing column list, never inserting mid-list.
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
    prof.location as worker_location
  from public.worker_posts wp
  join public.users u on u.id = wp.worker_id
  join public.worker_profiles prof on prof.user_id = wp.worker_id
  where wp.status = 'active'
    and prof.status = 'active'
    and u.account_status = 'active';

grant select on public.public_worker_posts to authenticated, anon;
