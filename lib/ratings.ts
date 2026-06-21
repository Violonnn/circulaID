import { supabase } from './supabase';

export type Rating = {
  id: string;
  hire_request_id: string;
  rating: number;
  comment: string | null;
};

// A single client-facing review, read from the public_worker_reviews view so any
// client can see a worker's track record. `hired_for` is the job title the review
// was left for; reviewer_name/reviewer_avatar_url identify who left it.
export type Review = {
  id: string;
  rating: number;
  comment: string | null;
  created_at: string;
  hired_for: string | null;
  reviewer_name: string | null;
  reviewer_avatar_url: string | null;
};

// Fetch a worker's reviews (newest first) for the post detail screen. Reviews
// are tied to the WORKER (across all their posts), so a client sees the worker's
// full track record before hiring — not just feedback on this one post. Reads
// the SECURITY DEFINER public view, which never exposes who left the review.
export async function fetchReviews(workerId: string): Promise<Review[]> {
  // Guard: no worker id means nothing to show.
  if (!workerId) return [];

  const { data, error } = await supabase
    .from('public_worker_reviews')
    .select('id, rating, comment, created_at, hired_for, reviewer_name, reviewer_avatar_url')
    .eq('worker_id', workerId)
    .order('created_at', { ascending: false });

  // Guard: on failure show no reviews rather than a broken screen.
  if (error) {
    console.warn('[ratings] Could not load reviews:', error.code, error.message);
    return [];
  }
  return (data as Review[]) ?? [];
}

// A worker's accumulated review stats for the feed card.
export type ReviewStats = { count: number; avg: number };

// Review count + average rating per worker, for the feed card. Reads the safe
// public_worker_reviews view and tallies rows by worker in ONE query (no extra
// round trip). Returns a Map of worker_id -> { count, avg }; a worker with no
// reviews simply won't be a key (treated as 0 reviews / no rating by callers).
export async function getReviewCountsForWorkers(
  workerIds: string[]
): Promise<Map<string, ReviewStats>> {
  const unique = Array.from(new Set(workerIds));
  // Guard: nothing to count.
  if (unique.length === 0) return new Map();

  const { data, error } = await supabase
    .from('public_worker_reviews')
    .select('worker_id, rating')
    .in('worker_id', unique);

  // Guard: on failure, no stats rather than a broken feed.
  if (error) {
    console.warn('[ratings] Could not count reviews:', error.code, error.message);
    return new Map();
  }

  // Tally count + running sum per worker, then derive the average.
  const sums = new Map<string, { count: number; total: number }>();
  for (const row of (data ?? []) as { worker_id: string; rating: number }[]) {
    const prev = sums.get(row.worker_id) ?? { count: 0, total: 0 };
    sums.set(row.worker_id, { count: prev.count + 1, total: prev.total + row.rating });
  }

  const stats = new Map<string, ReviewStats>();
  for (const [workerId, { count, total }] of sums) {
    stats.set(workerId, { count, avg: count > 0 ? total / count : 0 });
  }
  return stats;
}

// Return the existing rating for a hire (or null). Used to enforce one rating
// per hire in the UI before allowing the "Rate this worker" action.
export async function getRatingForHire(hireRequestId: string): Promise<Rating | null> {
  const { data, error } = await supabase
    .from('ratings')
    .select('id, hire_request_id, rating, comment')
    .eq('hire_request_id', hireRequestId)
    .maybeSingle();

  if (error) {
    console.warn('[ratings] Could not load rating:', error.code, error.message);
    return null;
  }
  return (data as Rating) ?? null;
}

// Return the set of hire ids (from the given list) that already have a rating.
// Used by the client Hires list to hide the "Rate" button where appropriate.
export async function getRatedHireIds(hireRequestIds: string[]): Promise<Set<string>> {
  if (hireRequestIds.length === 0) return new Set();
  const { data, error } = await supabase
    .from('ratings')
    .select('hire_request_id')
    .in('hire_request_id', hireRequestIds);

  if (error) {
    console.warn('[ratings] Could not batch-load ratings:', error.code, error.message);
    return new Set();
  }
  return new Set((data ?? []).map((row) => row.hire_request_id));
}

// Submit a 1–5 rating for a paid hire. We validate the integer range here even
// though the DB also has a CHECK constraint, and re-check there's no existing
// rating (UNIQUE(hire_request_id) is the real guarantee).
export async function submitRating(
  hireRequestId: string,
  workerId: string,
  rating: number,
  comment: string
): Promise<{ success: boolean; message: string }> {
  const { data: auth } = await supabase.auth.getUser();
  // Guard: must be signed in.
  if (!auth.user) {
    return { success: false, message: 'You must be signed in to rate.' };
  }
  // Guard: rating must be a whole number from 1 to 5.
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return { success: false, message: 'Please choose a rating from 1 to 5 stars.' };
  }
  // Guard: don't try to rate twice.
  const existing = await getRatingForHire(hireRequestId);
  if (existing) {
    return { success: false, message: 'You have already rated this job.' };
  }

  const { error } = await supabase.from('ratings').insert({
    hire_request_id: hireRequestId,
    client_id: auth.user.id,
    worker_id: workerId,
    rating,
    comment: comment.trim() || null,
  });

  // Guard: surface failure (e.g. hire not yet paid, blocked by RLS) clearly.
  if (error) {
    return { success: false, message: 'Could not submit your rating. Please try again.' };
  }
  return { success: true, message: 'Thanks for your rating!' };
}
