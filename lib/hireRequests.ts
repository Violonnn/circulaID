import { supabase } from './supabase';
import { HIRE_STATUS, NON_TERMINAL_HIRE_STATUSES, type HireStatus } from './constants';

// Client-side hire flow for SKILL POSTS (worker_posts) shown in the feed. This
// reuses the existing hire_requests + chat_threads tables: a hire row now points
// at a worker_post, and accepting it opens the one locked chat thread for that
// hire (the database trigger does the slot reservation + thread creation
// atomically — see migration 20260621040000).
//
// SECURITY: every action derives the acting user from the authenticated session
// (auth.getUser), never from a navigation param. The worker_id on a hire is set
// by a database trigger from the post, so a client can never pick who they hire.

// A pending request as the WORKER sees it on their post. `client_name` is filled
// in via the client_names_for_worker RPC (a worker may read the names of clients
// who have hired them — and only those); it falls back to null when unavailable.
export type PendingHireRequest = {
  id: string;
  client_id: string;
  client_name: string | null;
  // Public URL of the client's profile photo (null until they upload one).
  client_avatar_url: string | null;
  client_location: string | null;
  scheduled_at: string | null;
  details: string | null;
  created_at: string;
};

// A person's public display info resolved from a names lookup (RPC or view).
type PersonInfo = { full_name: string | null; avatar_url: string | null };

// A hire as the CLIENT sees it in their Hires tab. These are SKILL-POST hires
// (worker_post_id is set). The worker name comes from the public_profiles view.
export type ClientSkillHire = {
  id: string;
  worker_id: string;
  worker_name: string | null;
  // Public URL of the worker's profile photo (null until they upload one).
  worker_avatar_url: string | null;
  post_title: string | null;
  status: HireStatus;
  scheduled_at: string | null;
  client_location: string | null;
  details: string | null;
  decline_reason: string | null;
  created_at: string;
  // The locked chat thread for this hire (exists once accepted), so the client
  // can jump straight into the conversation from the Hires tab.
  thread_id: string | null;
};

// The "what job is this chat for" context shown in the locked chat's pinned
// panel. Job fields come from the linked hire_requests row; the worker/client
// names + phone numbers come from the participant-scoped hire_contacts RPC so
// the two parties can contact each other (never hardcoded).
export type HireContext = {
  post_title: string | null;
  scheduled_at: string | null;
  client_location: string | null;
  details: string | null;
  worker_name: string | null;
  worker_phone: string | null;
  client_name: string | null;
  client_phone: string | null;
  // Drives the post-completion chat window: status 'paid' + completed_at let the
  // chat screen show the closing countdown and lock sending after the grace days.
  status: string | null;
  completed_at: string | null;
};

// CLIENT: does this client already have a non-terminal request on this skill
// post? Used to disable a duplicate "Hire". Returns the blocking status or null.
export async function getActiveStatusForWorkerPost(
  workerPostId: string
): Promise<{ status: HireStatus | null; error: string | null }> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { status: null, error: 'You must be signed in.' };

  const { data, error } = await supabase
    .from('hire_requests')
    .select('status')
    .eq('worker_post_id', workerPostId)
    .eq('client_id', auth.user.id)
    .in('status', NON_TERMINAL_HIRE_STATUSES)
    .order('created_at', { ascending: false })
    .limit(1);

  if (error) {
    return { status: null, error: 'Could not check your existing requests.' };
  }
  return { status: (data?.[0]?.status as HireStatus) ?? null, error: null };
}

// CLIENT: create a pending hire request on a skill post. worker_id + post_title
// are filled in by the insert trigger from the post, so we never send them.
export async function createHireRequest(input: {
  workerPostId: string;
  clientLocation: string;
  scheduledAt: Date;
  details: string;
}): Promise<{ success: boolean; message: string }> {
  const { data: auth } = await supabase.auth.getUser();
  // Guard: must be signed in.
  if (!auth.user) {
    return { success: false, message: 'You must be signed in to request a hire.' };
  }
  // Guard: a post must be targeted.
  if (!input.workerPostId) {
    return { success: false, message: 'This post could not be found.' };
  }
  // Guard: the work-site location must not be empty.
  if (!input.clientLocation.trim()) {
    return { success: false, message: 'Please enter the work-site location.' };
  }
  // Guard: a valid date/time must be chosen, and it must be in the future.
  if (!(input.scheduledAt instanceof Date) || Number.isNaN(input.scheduledAt.getTime())) {
    return { success: false, message: 'Please choose a date and time.' };
  }
  if (input.scheduledAt.getTime() <= Date.now()) {
    return { success: false, message: 'Please choose a date and time in the future.' };
  }
  // Guard: optional details have a hard length cap.
  if (input.details.length > 300) {
    return { success: false, message: 'Extra details must be under 300 characters.' };
  }

  // Guard: don't send a duplicate request the client already has in flight.
  const existing = await getActiveStatusForWorkerPost(input.workerPostId);
  if (existing.status) {
    return { success: false, message: 'You already have an active request on this post.' };
  }

  const { error } = await supabase.from('hire_requests').insert({
    worker_post_id: input.workerPostId,
    client_id: auth.user.id,
    status: HIRE_STATUS.PENDING,
    client_location: input.clientLocation.trim(),
    scheduled_at: input.scheduledAt.toISOString(),
    details: input.details.trim() || null,
  });

  // Guard: the trigger rejects full/closed posts and self-hires; turn those into
  // a plain message instead of leaking the raw database error.
  if (error) {
    return {
      success: false,
      message: 'Could not send the request. The post may be full or unavailable.',
    };
  }
  return { success: true, message: 'Request sent.' };
}

// Resolve client display info (name + avatar) for the calling worker via the
// SECURITY DEFINER RPC. Returns a Map of client_id -> { full_name, avatar_url };
// clients the worker has no hire with simply don't appear (the RPC filters them
// out). Never throws.
export async function clientNamesForWorker(
  clientIds: string[]
): Promise<Map<string, PersonInfo>> {
  const unique = Array.from(new Set(clientIds));
  if (unique.length === 0) return new Map();

  const { data, error } = await supabase.rpc('client_names_for_worker', {
    p_client_ids: unique,
  });
  // Guard: on any failure, fall back to no names (UI shows the id label).
  if (error || !data) return new Map();
  return new Map(
    (data as { id: string; full_name: string | null; avatar_url: string | null }[]).map((r) => [
      r.id,
      { full_name: r.full_name, avatar_url: r.avatar_url },
    ])
  );
}

// WORKER: pending requests grouped by skill-post id, oldest first, enriched with
// the client's real display name. Powers the inline requests list on each post
// card in the Job tab. Returns a Map of worker_post_id -> requests.
export async function getRequestsForPosts(
  workerPostIds: string[]
): Promise<Map<string, PendingHireRequest[]>> {
  const result = new Map<string, PendingHireRequest[]>();
  if (workerPostIds.length === 0) return result;

  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return result;

  const { data, error } = await supabase
    .from('hire_requests')
    .select('id, worker_post_id, client_id, client_location, scheduled_at, details, created_at')
    .eq('worker_id', auth.user.id)
    .eq('status', HIRE_STATUS.PENDING)
    .in('worker_post_id', workerPostIds)
    .order('created_at', { ascending: true });

  // Guard: on failure, return an empty map rather than a broken screen.
  if (error || !data) return result;

  const rows = data as (PendingHireRequest & { worker_post_id: string | null })[];
  const names = await clientNamesForWorker(rows.map((r) => r.client_id));

  for (const row of rows) {
    if (!row.worker_post_id) continue;
    const info = names.get(row.client_id);
    const enriched: PendingHireRequest = {
      id: row.id,
      client_id: row.client_id,
      client_name: info?.full_name ?? null,
      client_avatar_url: info?.avatar_url ?? null,
      client_location: row.client_location,
      scheduled_at: row.scheduled_at,
      details: row.details,
      created_at: row.created_at,
    };
    const list = result.get(row.worker_post_id) ?? [];
    list.push(enriched);
    result.set(row.worker_post_id, list);
  }
  return result;
}

// CLIENT: the signed-in client's own SKILL-POST hires (worker_post_id set),
// newest first, optionally filtered by status. Worker names come from the safe
// public_profiles view. This is what the redesigned Hires tab shows.
export async function getClientSkillHires(
  page = 0,
  pageSize = 10,
  status?: string
): Promise<{ hires: ClientSkillHire[]; error: string | null; hasMore: boolean }> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { hires: [], error: 'You must be signed in.', hasMore: false };

  const from = page * pageSize;
  const to = from + pageSize - 1;

  let query = supabase
    .from('hire_requests')
    .select(
      'id, worker_id, post_title, status, scheduled_at, client_location, details, decline_reason, created_at, chat_threads(id)'
    )
    .eq('client_id', auth.user.id)
    .not('worker_post_id', 'is', null)
    .order('created_at', { ascending: false })
    .range(from, to);
  if (status && status !== 'all') query = query.eq('status', status);

  const { data, error } = await query;
  if (error || !data) {
    return { hires: [], error: 'Could not load your hires.', hasMore: false };
  }

  type Row = Omit<ClientSkillHire, 'worker_name' | 'worker_avatar_url' | 'thread_id'> & {
    chat_threads: { id: string }[] | { id: string } | null;
  };
  const rows = data as unknown as Row[];
  const workerInfo = await workerNamesForClient(rows.map((r) => r.worker_id));
  const hires: ClientSkillHire[] = rows.map((r) => {
    const thread = Array.isArray(r.chat_threads) ? r.chat_threads[0] : r.chat_threads;
    const info = workerInfo.get(r.worker_id);
    return {
      id: r.id,
      worker_id: r.worker_id,
      worker_name: info?.full_name ?? null,
      worker_avatar_url: info?.avatar_url ?? null,
      post_title: r.post_title,
      status: r.status,
      scheduled_at: r.scheduled_at,
      client_location: r.client_location,
      details: r.details,
      decline_reason: r.decline_reason,
      created_at: r.created_at,
      thread_id: thread?.id ?? null,
    };
  });

  return { hires, error: null, hasMore: rows.length === pageSize };
}

// Worker display info (name + avatar) from the public (active-worker) profiles
// view. Clients are allowed to read these, so no special RPC is needed here.
async function workerNamesForClient(workerIds: string[]): Promise<Map<string, PersonInfo>> {
  const unique = Array.from(new Set(workerIds));
  if (unique.length === 0) return new Map();
  const { data } = await supabase
    .from('public_profiles')
    .select('id, full_name, avatar_url')
    .in('id', unique);
  return new Map(
    (data ?? []).map((r) => [
      r.id as string,
      { full_name: (r.full_name as string) ?? null, avatar_url: (r.avatar_url as string) ?? null },
    ])
  );
}

// WORKER: how many pending requests each of the given skill posts has, for the
// count badge on the Job screen. Returns a map of worker_post_id -> count.
export async function getPendingCountsForPosts(
  workerPostIds: string[]
): Promise<Map<string, number>> {
  if (workerPostIds.length === 0) return new Map();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return new Map();

  const { data, error } = await supabase
    .from('hire_requests')
    .select('worker_post_id')
    .eq('worker_id', auth.user.id)
    .eq('status', HIRE_STATUS.PENDING)
    .in('worker_post_id', workerPostIds);

  // Guard: on failure, no badges rather than a broken screen.
  if (error || !data) return new Map();

  const counts = new Map<string, number>();
  for (const row of data as { worker_post_id: string | null }[]) {
    if (!row.worker_post_id) continue;
    counts.set(row.worker_post_id, (counts.get(row.worker_post_id) ?? 0) + 1);
  }
  return counts;
}

// WORKER: accept a pending request. Slot reservation + chat-thread creation are
// done ATOMICALLY by the database trigger when status flips to 'accepted'; we
// run guard clauses first (re-reading fresh from the database) so a stale UI or
// a slot race gets a clear message instead of a generic failure. Returns the new
// chat thread id so the caller can open the locked conversation.
export async function acceptRequest(
  hireRequestId: string
): Promise<{ success: boolean; message: string; threadId: string | null }> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) {
    return { success: false, message: 'You must be signed in.', threadId: null };
  }

  // Guard: re-read the hire from the database (don't trust stale UI state).
  const { data: hire, error } = await supabase
    .from('hire_requests')
    .select('id, worker_id, worker_post_id, status')
    .eq('id', hireRequestId)
    .maybeSingle();
  if (error || !hire) {
    return { success: false, message: 'Hire request not found.', threadId: null };
  }
  // Guard: only a still-pending request can be accepted.
  if (hire.status !== HIRE_STATUS.PENDING) {
    return { success: false, message: 'This request is no longer pending.', threadId: null };
  }
  // Guard: this worker must own the request (RLS also enforces this).
  if (hire.worker_id !== auth.user.id) {
    return {
      success: false,
      message: 'You can only accept requests on your own posts.',
      threadId: null,
    };
  }
  // Guard: must be a skill-post hire.
  if (!hire.worker_post_id) {
    return { success: false, message: 'This request is not linked to a skill post.', threadId: null };
  }

  // Guard: re-check slots FRESH from the database. Several requests can arrive
  // close together, so local state may be stale — only the live count decides.
  const { data: post, error: postError } = await supabase
    .from('worker_posts')
    .select('total_slots, slots_filled')
    .eq('id', hire.worker_post_id)
    .maybeSingle();
  if (postError || !post) {
    return { success: false, message: 'Could not load the related post.', threadId: null };
  }
  if (post.slots_filled >= post.total_slots) {
    return { success: false, message: 'This would exceed your available slots.', threadId: null };
  }

  // Happy path: a single UPDATE. The trigger reserves the slot and opens the
  // locked chat thread in one transaction. The extra status filter is an
  // optimistic guard against two accepts racing on the same request.
  const { error: updateError } = await supabase
    .from('hire_requests')
    .update({ status: HIRE_STATUS.ACCEPTED })
    .eq('id', hireRequestId)
    .eq('status', HIRE_STATUS.PENDING);

  if (updateError) {
    return {
      success: false,
      message: 'Could not accept the request. The post may now be full.',
      threadId: null,
    };
  }

  // The trigger created the thread; fetch its id so we can open the chat.
  const { data: thread } = await supabase
    .from('chat_threads')
    .select('id')
    .eq('hire_request_id', hireRequestId)
    .maybeSingle();

  return { success: true, message: 'Request accepted.', threadId: thread?.id ?? null };
}

// WORKER: decline a pending request, with an OPTIONAL reason. No slot change, no
// chat thread. We store this as 'rejected' because that is the value in the
// hire_status enum (there is no separate 'declined' state — see lib/constants).
// The reason is nullable: an empty/blank reason is stored as null, never forced.
// SECURITY: the reason text is never written to console.log.
export async function declineRequest(
  hireRequestId: string,
  reason?: string
): Promise<{ success: boolean; message: string }> {
  // Guard: re-read; only a pending request can be declined.
  const { data: hire, error } = await supabase
    .from('hire_requests')
    .select('id, status')
    .eq('id', hireRequestId)
    .maybeSingle();
  if (error || !hire) {
    return { success: false, message: 'Hire request not found.' };
  }
  if (hire.status !== HIRE_STATUS.PENDING) {
    return { success: false, message: 'This request is no longer pending.' };
  }

  // Guard: blank/whitespace-only reason collapses to null (column is nullable).
  const trimmed = reason?.trim();

  const { error: updateError } = await supabase
    .from('hire_requests')
    .update({ status: HIRE_STATUS.REJECTED, decline_reason: trimmed || null })
    .eq('id', hireRequestId)
    .eq('status', HIRE_STATUS.PENDING);

  if (updateError) {
    return { success: false, message: 'Could not decline the request. Please try again.' };
  }
  return { success: true, message: 'Request declined.' };
}

// CHAT: the job context for a thread (post title + scheduled date/time), shown
// in the locked header bar so it's clear which hire this chat belongs to. Read
// through chat_threads so RLS confirms the caller is a participant of the hire.
export async function getHireContextByThread(
  threadId: string
): Promise<HireContext | null> {
  const { data, error } = await supabase
    .from('chat_threads')
    .select(
      'hire_requests!inner(post_title, scheduled_at, client_location, details, status, completed_at)'
    )
    .eq('id', threadId)
    .maybeSingle();

  // Guard: a missing/blocked thread simply yields no context panel.
  if (error || !data) return null;
  const hire = (data as unknown as { hire_requests: HireContext | null }).hire_requests;
  if (!hire) return null;

  // Names + phones of the two parties, returned only to a participant of this
  // hire by the SECURITY DEFINER RPC. On any failure we just omit them.
  const { data: contacts } = await supabase.rpc('hire_contacts', { p_thread: threadId });
  const contact = (Array.isArray(contacts) ? contacts[0] : contacts) as
    | { worker_name: string | null; worker_phone: string | null; client_name: string | null; client_phone: string | null }
    | null
    | undefined;

  return {
    post_title: hire.post_title ?? null,
    scheduled_at: hire.scheduled_at ?? null,
    client_location: hire.client_location ?? null,
    details: hire.details ?? null,
    worker_name: contact?.worker_name ?? null,
    worker_phone: contact?.worker_phone ?? null,
    client_name: contact?.client_name ?? null,
    client_phone: contact?.client_phone ?? null,
    status: hire.status ?? null,
    completed_at: hire.completed_at ?? null,
  };
}
