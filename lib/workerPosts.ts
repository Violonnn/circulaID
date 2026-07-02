import { supabase } from './supabase';
import { PAGE_SIZE } from './constants';
import { getWorkerProfile } from './worker';

// Skill/job posts a worker offers. Each post is summarized (by AI, with a non-AI
// fallback) into a feed card: a bold title + a one-line description. All money
// here (pricing_rate) is SIMULATED test data, consistent with the rest of the app.

// A worker can have at most this many ACTIVE skill posts at once. This is
// unrelated to a post's per-post slot count (1..5) — they are different numbers.
export const MAX_ACTIVE_POSTS = 3;

// Shown when the worker already has the maximum number of active posts.
export const MAX_POSTS_MESSAGE =
  "You've reached the maximum of 3 active skill posts. Archive or delete one to add another.";

// Keep the description bounded so a card never has to summarize a huge blob.
const DESCRIPTION_LIMIT = 500;

// A worker_posts row. pricing_rate is only present for the OWNER (or admin); for
// a client viewing someone else's post it is null, because the price-free public
// view never exposes it.
export type WorkerPost = {
  id: string;
  worker_id: string;
  total_slots: number;
  slots_filled: number;
  description: string;
  experience_length: string;
  pricing_rate: number | null;
  ai_title: string;
  ai_short_description: string;
  status: 'active' | 'archived';
  created_at: string;
  // Poster display info, merged from the price-free public view (when the post
  // is publicly visible). Optional because the owner-only direct read of
  // worker_posts doesn't carry them.
  worker_name?: string | null;
  worker_location?: string | null;
  // Public URL of the poster's profile photo (null until they upload one).
  worker_avatar_url?: string | null;
};

// Public, safe worker info for the post-detail "About the worker" card. Comes
// from the public_profiles view (active workers only), so it never exposes
// private fields like age/email. Returned null when the worker isn't public.
export type PublicWorkerProfile = {
  id: string;
  full_name: string | null;
  bio: string | null;
  rating_avg: number | null;
  rating_count: number;
  // Public URL of the worker's profile photo (null until they upload one).
  avatar_url: string | null;
};

// A skill post as shown in the CLIENT browse feed. Deliberately NO pricing_rate:
// it comes from the price-free public_worker_posts view, so clients never even
// receive the price. worker_name powers the card (with a placeholder avatar).
export type ClientSkillPost = {
  id: string;
  worker_id: string;
  worker_name: string | null;
  // Public URL of the poster's profile photo (null until they upload one).
  worker_avatar_url: string | null;
  // The post's price as a PUBLIC STARTING reference (the charged amount is
  // negotiated later via the chat payment flow). Null when not set.
  starting_rate: number | null;
  total_slots: number;
  slots_filled: number;
  experience_length: string;
  ai_title: string;
  ai_short_description: string;
  created_at: string;
};

// The validated form values needed to create a post.
export type SkillPostInput = {
  totalSlots: number;
  description: string;
  experienceLength: string;
  pricingRate: number;
};

// Non-AI fallback summary built purely from the worker's typed description.
//
// IMPORTANT (resilience): this fallback exists specifically so a Gemini outage,
// rate limit, timeout or network error NEVER blocks a worker from posting their
// skill. We use the first ~5 words as the title and ~25 words as the card line.
// DELIBERATE LIMITATION: offline we can't translate, so a Tagalog/Bisaya post
// keeps the worker's original wording here (only the AI path renders English).
function fallbackSummary(description: string): { title: string; shortDescription: string } {
  const words = description.trim().split(/\s+/);
  const title = words.slice(0, 5).join(' ');
  const shortDescription =
    words.length > 25 ? `${words.slice(0, 25).join(' ')}…` : description.trim();
  return { title, shortDescription };
}

// Ask the Gemini-backed Edge Function to summarize one post into a title + line.
// The Gemini API key lives ONLY in the Edge Function's environment — never here.
// supabase-js automatically attaches the signed-in user's access token so the
// function can require an authenticated caller. Returns null on ANY failure so
// the caller falls back to fallbackSummary() instead of blocking the post.
async function summarizeSkillPost(payload: {
  description: string;
  experienceLength: string;
  totalSlots: number;
  pricingRate: number;
  bio: string;
  location: string;
}): Promise<{ title: string; shortDescription: string } | null> {
  try {
    const { data, error } = await supabase.functions.invoke('summarize-skill-post', {
      body: payload,
    });
    // Guard: any function-side failure (Gemini error, rate limit, timeout).
    if (error) return null;
    const title = typeof data?.title === 'string' ? data.title.trim() : '';
    const shortDescription =
      typeof data?.shortDescription === 'string' ? data.shortDescription.trim() : '';
    // Guard: a missing/empty field is treated as a failure (caller falls back).
    if (!title || !shortDescription) return null;
    return { title, shortDescription };
  } catch {
    // Guard: a thrown network error (offline, DNS) also falls back cleanly.
    return null;
  }
}

// How many ACTIVE posts the signed-in worker currently has (for the 3-post cap).
export async function countActiveWorkerPosts(): Promise<{ count: number; error: string | null }> {
  const { data: auth } = await supabase.auth.getUser();
  // Guard: must be signed in.
  if (!auth.user) return { count: 0, error: 'You must be signed in.' };

  const { count, error } = await supabase
    .from('worker_posts')
    .select('id', { count: 'exact', head: true })
    .eq('worker_id', auth.user.id)
    .eq('status', 'active');

  // Guard: report the failure instead of letting a posting cap silently pass.
  if (error) return { count: 0, error: 'Could not check your posts. Please try again.' };
  return { count: count ?? 0, error: null };
}

// The signed-in worker's own posts (any status), newest first. RLS already
// limits this to their rows; we scope to auth.uid() too as defense in depth.
export async function fetchWorkerPosts(): Promise<{ posts: WorkerPost[]; error: string | null }> {
  const { data: auth } = await supabase.auth.getUser();
  // Guard: must be signed in to have posts.
  if (!auth.user) return { posts: [], error: 'You must be signed in.' };

  const { data, error } = await supabase
    .from('worker_posts')
    .select(
      'id, worker_id, total_slots, slots_filled, description, experience_length, pricing_rate, ai_title, ai_short_description, status, created_at'
    )
    .eq('worker_id', auth.user.id)
    // Only ACTIVE posts: a soft-deleted (archived) post must drop out of the
    // worker's Job list, while its row + linked ratings/receipts stay intact.
    .eq('status', 'active')
    .order('created_at', { ascending: false });

  // Guard: surface read failures instead of silently showing an empty list.
  if (error) return { posts: [], error: 'Could not load your posts. Please try again.' };
  return { posts: (data as WorkerPost[]) ?? [], error: null };
}

// SOFT-DELETE a skill post (set status='archived'; never a hard DELETE). The
// real ownership + active-hire checks live in the delete_worker_post RPC, which
// runs server-side under the caller's session — we never trust the client guard
// alone. A post with only rejected/cancelled/paid hires is safe to delete; one
// with a pending/accepted/in_progress hire is blocked with a clear message.
// Ratings / receipts tied to the post are deliberately untouched, so reviews
// stay visible afterward.
export async function deleteWorkerPost(
  postId: string
): Promise<{ success: boolean; message: string }> {
  const { data: auth } = await supabase.auth.getUser();
  // Guard: must be signed in.
  if (!auth.user) return { success: false, message: 'You must be signed in.' };
  // Guard: a post must be targeted.
  if (!postId) return { success: false, message: 'This post could not be found.' };

  const { error } = await supabase.rpc('delete_worker_post', { p_post: postId });

  // Guard: surface the blocked-by-active-hires case with its own message; any
  // other failure (e.g. not the owner) gets a plain, non-leaky message.
  if (error) {
    if (error.message?.toLowerCase().includes('active hire')) {
      return {
        success: false,
        message: "This post has active hire requests and can't be deleted yet.",
      };
    }
    return { success: false, message: 'Could not delete this post. Please try again.' };
  }
  return { success: true, message: 'Post deleted.' };
}

// CLIENT BROWSE FEED: every ACTIVE skill post (any worker), newest first, read
// from the price-free public_worker_posts view. Search matches the AI title or
// short description so clients can find offers by what they do.
export async function getSkillPostsForClientFeed(
  page = 0,
  pageSize = PAGE_SIZE,
  search = ''
): Promise<{ posts: ClientSkillPost[]; error: string | null; hasMore: boolean }> {
  const from = page * pageSize;
  const to = from + pageSize - 1;

  let query = supabase
    .from('public_worker_posts')
    .select(
      'id, worker_id, worker_name, worker_avatar_url, starting_rate, total_slots, slots_filled, experience_length, ai_title, ai_short_description, created_at'
    )
    .order('created_at', { ascending: false })
    .range(from, to);

  // Free-text search across the AI title + short description.
  const term = search.trim();
  if (term) {
    query = query.or(`ai_title.ilike.%${term}%,ai_short_description.ilike.%${term}%`);
  }

  const { data, error } = await query;

  // Guard: surface the failure instead of returning half a feed.
  if (error) return { posts: [], error: 'Could not load the feed. Please try again.', hasMore: false };
  const posts = (data as ClientSkillPost[]) ?? [];
  return { posts, error: null, hasMore: posts.length === pageSize };
}

// One post by id, used by the detail screen for BOTH the owner and a client:
//   * The owner/admin direct read returns the row WITH pricing_rate.
//   * Anyone else gets no row from RLS, so we fall back to the price-free public
//     view (pricing_rate stays null and is never shown to clients).
export async function getWorkerPostById(
  id: string
): Promise<{ post: WorkerPost | null; error: string | null }> {
  const { data, error } = await supabase
    .from('worker_posts')
    .select(
      'id, worker_id, total_slots, slots_filled, description, experience_length, pricing_rate, ai_title, ai_short_description, status, created_at'
    )
    .eq('id', id)
    .maybeSingle();

  // The poster's public display name + service area (price-free) used by the
  // detail screen. Read separately so BOTH the owner and client paths can show
  // it. A missing row (e.g. archived post) just leaves these null.
  const { data: pub } = await supabase
    .from('public_worker_posts')
    .select(
      'id, worker_id, total_slots, slots_filled, description, experience_length, ai_title, ai_short_description, status, created_at, worker_name, worker_location, worker_avatar_url'
    )
    .eq('id', id)
    .maybeSingle();

  // Owner/admin path: the row (with price) came back. Merge in the public name +
  // location + avatar for display.
  if (!error && data) {
    return {
      post: {
        ...(data as WorkerPost),
        worker_name: pub?.worker_name ?? null,
        worker_location: pub?.worker_location ?? null,
        worker_avatar_url: pub?.worker_avatar_url ?? null,
      },
      error: null,
    };
  }

  // Client path: RLS returned no row — fall back to the safe public view.
  // Guard: a missing/blocked row reads as "not found", never a crash.
  if (!pub) return { post: null, error: 'This post is no longer available.' };
  // pricing_rate is intentionally absent from the public view.
  return { post: { ...pub, pricing_rate: null } as WorkerPost, error: null };
}

// Public worker profile (name + bio + rating) for the post-detail "About the
// worker" card. Reads the safe public_profiles view, so private fields are never
// exposed. Returns null if the worker isn't a public/active worker.
export async function getPublicWorkerProfile(
  workerId: string
): Promise<PublicWorkerProfile | null> {
  const { data, error } = await supabase
    .from('public_profiles')
    .select('id, full_name, bio, rating_avg, rating_count, avatar_url')
    .eq('id', workerId)
    .maybeSingle();

  // Guard: a missing/blocked row simply hides the card (no crash).
  if (error || !data) return null;
  return {
    id: data.id as string,
    full_name: (data.full_name as string) ?? null,
    bio: (data.bio as string) ?? null,
    rating_avg: data.rating_avg as number | null,
    rating_count: (data.rating_count as number) ?? 0,
    avatar_url: (data.avatar_url as string) ?? null,
  };
}

// Create a skill post. The form validates first; we re-check here (defense in
// depth) so a bad value never reaches the database, then summarize and insert.
export async function saveSkillPost(
  input: SkillPostInput
): Promise<{ success: boolean; message: string }> {
  const { data: auth } = await supabase.auth.getUser();
  // Guard: must be signed in to post.
  if (!auth.user) return { success: false, message: 'You must be signed in to post.' };

  // Guard: slots must be a whole number from 1 to 5.
  if (!Number.isInteger(input.totalSlots) || input.totalSlots < 1 || input.totalSlots > 5) {
    return { success: false, message: 'Slots must be a whole number from 1 to 5.' };
  }
  // Guard: description must not be blank and must fit the limit.
  if (!input.description.trim()) {
    return { success: false, message: 'Please describe your skill.' };
  }
  if (input.description.length > DESCRIPTION_LIMIT) {
    return { success: false, message: `Description must be under ${DESCRIPTION_LIMIT} characters.` };
  }
  // Guard: an experience length must be chosen.
  if (!input.experienceLength) {
    return { success: false, message: 'Please choose your experience length.' };
  }
  // Guard: pricing must be a positive number (SIMULATED, but still validated).
  if (Number.isNaN(input.pricingRate) || input.pricingRate <= 0) {
    return { success: false, message: 'Pricing rate must be a number above 0.' };
  }

  // Guard: enforce the 3-active-posts cap before doing any AI work or inserting.
  const { count, error: countError } = await countActiveWorkerPosts();
  if (countError) return { success: false, message: countError };
  if (count >= MAX_ACTIVE_POSTS) return { success: false, message: MAX_POSTS_MESSAGE };

  // Read the worker's profile so the AI prompt has their bio + location context.
  const profile = await getWorkerProfile();

  // Summarize with the AI; on ANY failure, fall back to a non-AI summary so the
  // post can still be created (see fallbackSummary's note).
  const aiSummary = await summarizeSkillPost({
    description: input.description.trim(),
    experienceLength: input.experienceLength,
    totalSlots: input.totalSlots,
    pricingRate: input.pricingRate,
    bio: profile?.bio ?? '',
    location: profile?.location ?? '',
  });
  const summary = aiSummary ?? fallbackSummary(input.description);

  const { error } = await supabase.from('worker_posts').insert({
    worker_id: auth.user.id,
    total_slots: input.totalSlots,
    description: input.description.trim(),
    experience_length: input.experienceLength,
    pricing_rate: input.pricingRate,
    ai_title: summary.title,
    ai_short_description: summary.shortDescription,
    // slots_filled defaults to 0 and status defaults to 'active' in the schema.
  });

  // Guard: a failed insert (e.g. suspended worker blocked by RLS) gets a clear
  // message instead of a raw Postgres error.
  if (error) {
    return {
      success: false,
      message: 'Could not create the post. Your service provider account may be inactive.',
    };
  }
  return { success: true, message: 'Post created.' };
}
