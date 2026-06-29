import { supabase } from './supabase';
import type { Review } from './ratings';

// generateReviewSummary — app-side entry point for the AI review summary shown on
// the skill-post detail screen. It mirrors lib/workerPosts.summarizeSkillPost:
// the Gemini key + call live ONLY in the `summarize-reviews` Edge Function, and
// this just invokes it (supabase-js attaches the signed-in user's token).
//
// The Edge Function owns the cache (it returns a fresh summary if one was made in
// the last 7 days, otherwise regenerates and persists it). We still guard here so
// we never even call the function when there clearly isn't enough to summarize.
//
// Returns the summary string, or null on ANY failure / not-enough-reviews — the
// screen renders nothing in that case (never an error).
const MIN_REVIEWS = 2;

export async function generateReviewSummary(
  workerId: string | null | undefined,
  reviews: Review[] | null | undefined
): Promise<string | null> {
  // Guard: no worker id -> nothing to summarize, skip the call.
  if (!workerId) return null;

  // Guard: null/undefined or fewer than 2 reviews -> no API call.
  if (!reviews || reviews.length < MIN_REVIEWS) return null;

  // Extract only the review text (the `comment` field) and drop empty ones.
  const texts = reviews
    .map((r) => (r.comment ?? '').trim())
    .filter((t) => t.length > 0);

  // Guard: fewer than 2 reviews with actual text -> not worth a call.
  if (texts.length < MIN_REVIEWS) return null;

  try {
    // The function reads the authoritative review text itself (service role), so
    // we only need to pass the worker id; it can't be poisoned by the client.
    const { data, error } = await supabase.functions.invoke('summarize-reviews', {
      body: { workerId },
    });
    // Guard: any function-side failure -> null (screen shows nothing).
    if (error) return null;

    const summary = typeof data?.summary === 'string' ? data.summary.trim() : '';
    // Guard: empty summary is treated as "no summary".
    return summary.length > 0 ? summary : null;
  } catch {
    // Guard: a thrown network error (offline, DNS) also degrades to null.
    return null;
  }
}
