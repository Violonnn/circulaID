import { supabase } from './supabase';
import {
  HIRE_STATUS,
  NON_TERMINAL_HIRE_STATUSES,
  PAGE_SIZE,
  type HireStatus,
} from './constants';

// A hire request row plus the few joined fields the screens display.
//
// NOTE ON NAMES: the schema's RLS only lets a user read their own users row
// (self-or-admin), and public_profiles only exposes ACTIVE WORKERS. There is no
// safe, RLS-approved way for a worker to read a CLIENT's display name. So in the
// worker-facing list `counterparty_name` is null and the UI shows a generic
// label. Clients CAN see the worker's name (via public_profiles). This is a
// schema limitation, flagged to the user — not something we work around by
// querying past RLS.
export type HireRequest = {
  id: string;
  post_id: string;
  client_id: string;
  worker_id: string;
  status: HireStatus;
  created_at: string;
  accepted_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  paid_at: string | null;
  post_caption: string | null;
  counterparty_name: string | null;
};

type HireRow = {
  id: string;
  post_id: string;
  client_id: string;
  worker_id: string;
  status: HireStatus;
  created_at: string;
  accepted_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  paid_at: string | null;
  posts: { caption: string } | null;
};

const HIRE_COLUMNS =
  'id, post_id, client_id, worker_id, status, created_at, accepted_at, started_at, completed_at, paid_at, posts(caption)';

// Fetch a single hire request by id (used by the guard-clause handlers so they
// re-read the latest status from the database instead of trusting the UI).
export async function getHireRequestById(
  hireRequestId: string
): Promise<{ hire: HireRow | null; error: string | null }> {
  const { data, error } = await supabase
    .from('hire_requests')
    .select(HIRE_COLUMNS)
    .eq('id', hireRequestId)
    .maybeSingle();

  if (error) {
    return { hire: null, error: 'Could not load this hire request.' };
  }
  // Supabase infers the embedded `posts(caption)` as an array type, but the FK is
  // to-one so at runtime it's a single object. Cast through unknown to match.
  return { hire: (data as unknown as HireRow) ?? null, error: null };
}

// CLIENT: does this client already have a non-terminal request on this post?
// Used to disable a duplicate "Request to Hire". Returns the blocking status if
// one exists, else null.
export async function getActiveHireStatusForPost(
  postId: string
): Promise<{ status: HireStatus | null; error: string | null }> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { status: null, error: 'You must be signed in.' };

  const { data, error } = await supabase
    .from('hire_requests')
    .select('status')
    .eq('post_id', postId)
    .eq('client_id', auth.user.id)
    .in('status', NON_TERMINAL_HIRE_STATUSES)
    .maybeSingle();

  if (error) {
    return { status: null, error: 'Could not check your existing requests.' };
  }
  return { status: (data?.status as HireStatus) ?? null, error: null };
}

// CLIENT: create a pending hire request on a post. The worker_id is filled in by
// the database trigger (handle_hire_insert) from the post, so we don't send it.
export async function createHireRequest(
  postId: string
): Promise<{ success: boolean; message: string }> {
  const { data: auth } = await supabase.auth.getUser();
  // Guard: must be signed in.
  if (!auth.user) {
    return { success: false, message: 'You must be signed in to request a hire.' };
  }

  // Guard: don't send a duplicate request the user already has in flight.
  const existing = await getActiveHireStatusForPost(postId);
  if (existing.status) {
    return { success: false, message: 'You already have an active request on this post.' };
  }

  const { error } = await supabase.from('hire_requests').insert({
    post_id: postId,
    client_id: auth.user.id,
    status: HIRE_STATUS.PENDING,
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

// CLIENT: this client's own hire requests, newest first, paginated, with the
// worker name (from public_profiles) merged in. An optional status filters
// server-side ('all' means no filter) so paging stays correct under a filter.
export async function getClientHires(
  page = 0,
  pageSize = PAGE_SIZE,
  status: string = 'all'
): Promise<{
  hires: HireRequest[];
  error: string | null;
  hasMore: boolean;
}> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { hires: [], error: 'You must be signed in.', hasMore: false };

  const from = page * pageSize;
  const to = from + pageSize - 1;

  let query = supabase
    .from('hire_requests')
    .select(HIRE_COLUMNS)
    .eq('client_id', auth.user.id)
    // Legacy QR/escrow flow only: skill-post (worker_posts) hires are handled by
    // the separate worker-posts hire flow (see lib/hireRequests).
    .is('worker_post_id', null)
    .order('created_at', { ascending: false })
    .range(from, to);
  if (status && status !== 'all') query = query.eq('status', status);

  const { data, error } = await query;

  if (error) {
    return { hires: [], error: 'Could not load your hire requests.', hasMore: false };
  }
  const rows = (data as unknown as HireRow[]) ?? [];

  // Merge in each worker's public display name (active workers only).
  const workerIds = Array.from(new Set(rows.map((r) => r.worker_id)));
  const nameById = await getWorkerNames(workerIds);

  const hires = rows.map((row) => toHireRequest(row, nameById.get(row.worker_id) ?? null));
  return { hires, error: null, hasMore: rows.length === pageSize };
}

// WORKER: incoming requests on this worker's posts, newest first, paginated. The
// client name is not readable under RLS (see note above), so counterparty_name
// is null. An optional status filters server-side ('all' means no filter).
export async function getWorkerHires(
  page = 0,
  pageSize = PAGE_SIZE,
  status: string = 'all'
): Promise<{
  hires: HireRequest[];
  error: string | null;
  hasMore: boolean;
}> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { hires: [], error: 'You must be signed in.', hasMore: false };

  const from = page * pageSize;
  const to = from + pageSize - 1;

  let query = supabase
    .from('hire_requests')
    .select(HIRE_COLUMNS)
    .eq('worker_id', auth.user.id)
    // Legacy QR/escrow flow only (see note in getClientHires).
    .is('worker_post_id', null)
    .order('created_at', { ascending: false })
    .range(from, to);
  if (status && status !== 'all') query = query.eq('status', status);

  const { data, error } = await query;

  if (error) {
    return { hires: [], error: 'Could not load incoming requests.', hasMore: false };
  }
  const rows = (data as unknown as HireRow[]) ?? [];
  const hires = rows.map((row) => toHireRequest(row, null));
  return { hires, error: null, hasMore: rows.length === pageSize };
}

// WORKER: accept a pending request. The actual slot reservation, QR session and
// chat-thread creation are done ATOMICALLY by the database trigger
// handle_hire_status_change when status flips to 'accepted'. We only need a
// single UPDATE — but we still run guard clauses first so the user gets a clear
// message instead of a generic failure when something has changed underneath us.
export async function acceptHireRequest(
  hireRequestId: string
): Promise<{ success: boolean; message: string }> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) {
    return { success: false, message: 'You must be signed in.' };
  }

  // Guard: re-read the hire from the database (don't trust stale UI state).
  const { hire, error } = await getHireRequestById(hireRequestId);
  if (error || !hire) {
    return { success: false, message: 'Hire request not found.' };
  }

  // Guard: only a still-pending request can be accepted.
  if (hire.status !== HIRE_STATUS.PENDING) {
    return { success: false, message: 'This request is no longer pending.' };
  }

  // Guard: this worker must own the related post (defense in depth — RLS also
  // enforces this, but the guard gives a clean message).
  if (hire.worker_id !== auth.user.id) {
    return { success: false, message: 'You can only accept requests on your own posts.' };
  }

  // Guard: the post must still have a free slot.
  const { data: post, error: postError } = await supabase
    .from('posts')
    .select('total_slots, slots_filled, status')
    .eq('id', hire.post_id)
    .maybeSingle();
  if (postError || !post) {
    return { success: false, message: 'Could not load the related post.' };
  }
  if (post.slots_filled >= post.total_slots) {
    return { success: false, message: 'This post is already full.' };
  }

  // Happy path: a single UPDATE. The trigger reserves the slot, marks the post
  // 'full' if it just filled, and creates the QR session + chat thread — all in
  // one transaction, so we never get a half-applied accept.
  const { error: updateError } = await supabase
    .from('hire_requests')
    .update({ status: HIRE_STATUS.ACCEPTED })
    .eq('id', hireRequestId)
    .eq('status', HIRE_STATUS.PENDING); // optimistic guard against a race

  if (updateError) {
    return { success: false, message: 'Could not accept the request. Please try again.' };
  }
  return { success: true, message: 'Request accepted.' };
}

// WORKER: reject a pending request. No slot change.
export async function rejectHireRequest(
  hireRequestId: string
): Promise<{ success: boolean; message: string }> {
  // Guard: re-read; only a pending request can be rejected.
  const { hire, error } = await getHireRequestById(hireRequestId);
  if (error || !hire) {
    return { success: false, message: 'Hire request not found.' };
  }
  if (hire.status !== HIRE_STATUS.PENDING) {
    return { success: false, message: 'This request is no longer pending.' };
  }

  const { error: updateError } = await supabase
    .from('hire_requests')
    .update({ status: HIRE_STATUS.REJECTED })
    .eq('id', hireRequestId)
    .eq('status', HIRE_STATUS.PENDING);

  if (updateError) {
    return { success: false, message: 'Could not reject the request. Please try again.' };
  }
  return { success: true, message: 'Request rejected.' };
}

// --- small shared helpers ----------------------------------------------------

// Look up display names for a set of workers from the safe public_profiles view.
async function getWorkerNames(workerIds: string[]): Promise<Map<string, string>> {
  if (workerIds.length === 0) return new Map();
  const { data } = await supabase
    .from('public_profiles')
    .select('id, full_name')
    .in('id', workerIds);
  return new Map((data ?? []).map((row) => [row.id, row.full_name]));
}

function toHireRequest(row: HireRow, counterpartyName: string | null): HireRequest {
  return {
    id: row.id,
    post_id: row.post_id,
    client_id: row.client_id,
    worker_id: row.worker_id,
    status: row.status,
    created_at: row.created_at,
    accepted_at: row.accepted_at,
    started_at: row.started_at,
    completed_at: row.completed_at,
    paid_at: row.paid_at,
    post_caption: row.posts?.caption ?? null,
    counterparty_name: counterpartyName,
  };
}
