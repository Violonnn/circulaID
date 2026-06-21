import { supabase } from './supabase';
import { PAGE_SIZE, POST_STATUS, type PostStatus } from './constants';

// A post as shown in the CLIENT feed. Note there is deliberately NO price field:
// clients must never receive it. The query below also never requests it, so we
// don't rely on RLS/column grants as the only safeguard.
export type FeedPost = {
  id: string;
  worker_id: string;
  caption: string;
  total_slots: number;
  slots_filled: number;
  status: PostStatus;
  created_at: string;
  // Pulled from the safe public_profiles view (active workers only).
  worker_name: string | null;
  worker_bio: string | null;
  worker_rating_avg: number | null;
  worker_rating_count: number | null;
};

// A post as shown in the WORKER's own "My Posts" view. Here price IS included,
// because the owner is allowed to see it (read through post_owner_prices).
export type MyPost = {
  id: string;
  worker_id: string;
  caption: string;
  total_slots: number;
  slots_filled: number;
  status: PostStatus;
  created_at: string;
  price: number | null;
};

// How many slots are still open on a post. A tiny named helper so the screens
// don't re-derive this (and risk an off-by-one) in several places.
export function remainingSlots(post: { total_slots: number; slots_filled: number }): number {
  return Math.max(post.total_slots - post.slots_filled, 0);
}

// CLIENT FEED: open posts only, paginated. We fetch the worker's public display
// info from the public_profiles view in a second query and merge it in, because
// that view (active workers, safe columns) has no foreign key we can embed
// directly. Search + category are applied server-side (caption ILIKE) so the
// filter scales with the table instead of only matching already-loaded rows.
export async function getOpenPostsForFeed(
  page = 0,
  pageSize = PAGE_SIZE,
  search = '',
  category = 'all'
): Promise<{
  posts: FeedPost[];
  error: string | null;
  hasMore: boolean;
}> {
  const from = page * pageSize;
  const to = from + pageSize - 1;

  // price is intentionally excluded from this select — clients should never
  // receive it, even before the column grant / RLS would block it.
  let query = supabase
    .from('posts')
    .select('id, worker_id, caption, total_slots, slots_filled, status, created_at')
    .eq('status', POST_STATUS.OPEN)
    .order('created_at', { ascending: false })
    .range(from, to);

  // Free-text search over the caption.
  const term = search.trim();
  if (term) query = query.ilike('caption', `%${term}%`);
  // Category filter: the category key doubles as a caption keyword (there is no
  // category column yet — see CategoryChips/FeedSearchBar notes).
  if (category && category !== 'all') query = query.ilike('caption', `%${category}%`);

  const { data: rows, error } = await query;

  // Guard: surface the failure to the caller instead of returning half a feed.
  if (error) {
    return { posts: [], error: 'Could not load the feed. Please try again.', hasMore: false };
  }
  if (!rows || rows.length === 0) {
    return { posts: [], error: null, hasMore: false };
  }

  const workerIds = Array.from(new Set(rows.map((row) => row.worker_id)));
  const { data: profiles, error: profileError } = await supabase
    .from('public_profiles')
    .select('id, full_name, bio, rating_avg, rating_count')
    .in('id', workerIds);

  // Guard: if profiles fail we still show posts, just without the worker name.
  const profileById = new Map(
    (profileError ? [] : profiles ?? []).map((p) => [p.id, p])
  );

  const posts: FeedPost[] = rows.map((row) => {
    const profile = profileById.get(row.worker_id);
    return {
      id: row.id,
      worker_id: row.worker_id,
      caption: row.caption,
      total_slots: row.total_slots,
      slots_filled: row.slots_filled,
      status: row.status as PostStatus,
      created_at: row.created_at,
      worker_name: profile?.full_name ?? null,
      worker_bio: profile?.bio ?? null,
      worker_rating_avg: profile?.rating_avg ?? null,
      worker_rating_count: profile?.rating_count ?? null,
    };
  });

  return { posts, error: null, hasMore: rows.length === pageSize };
}

// CLIENT POST DETAIL: one open post + its worker info. Still no price.
export async function getFeedPostById(
  postId: string
): Promise<{ post: FeedPost | null; error: string | null }> {
  const { data: row, error } = await supabase
    .from('posts')
    .select('id, worker_id, caption, total_slots, slots_filled, status, created_at')
    .eq('id', postId)
    .maybeSingle();

  // Guard: a missing/blocked post should read as "not found", never a crash.
  if (error) {
    return { post: null, error: 'Could not load this post. Please try again.' };
  }
  if (!row) {
    return { post: null, error: 'This post is no longer available.' };
  }

  const { data: profile } = await supabase
    .from('public_profiles')
    .select('id, full_name, bio, rating_avg, rating_count')
    .eq('id', row.worker_id)
    .maybeSingle();

  const post: FeedPost = {
    id: row.id,
    worker_id: row.worker_id,
    caption: row.caption,
    total_slots: row.total_slots,
    slots_filled: row.slots_filled,
    status: row.status as PostStatus,
    created_at: row.created_at,
    worker_name: profile?.full_name ?? null,
    worker_bio: profile?.bio ?? null,
    worker_rating_avg: profile?.rating_avg ?? null,
    worker_rating_count: profile?.rating_count ?? null,
  };
  return { post, error: null };
}

// WORKER "MY POSTS": the current worker's posts (any status), paginated. Price
// is read from the owner-only post_owner_prices view and merged in.
export async function getMyPosts(
  page = 0,
  pageSize = PAGE_SIZE
): Promise<{ posts: MyPost[]; error: string | null; hasMore: boolean }> {
  const { data: auth } = await supabase.auth.getUser();
  // Guard: must be signed in to have any posts.
  if (!auth.user) {
    return { posts: [], error: 'You must be signed in.', hasMore: false };
  }

  const from = page * pageSize;
  const to = from + pageSize - 1;

  const { data: rows, error } = await supabase
    .from('posts')
    .select('id, worker_id, caption, total_slots, slots_filled, status, created_at')
    .eq('worker_id', auth.user.id)
    .order('created_at', { ascending: false })
    .range(from, to);

  // Guard: report the failure rather than silently showing an empty list.
  if (error) {
    return { posts: [], error: 'Could not load your posts. Please try again.', hasMore: false };
  }
  if (!rows || rows.length === 0) {
    return { posts: [], error: null, hasMore: false };
  }

  const { data: prices } = await supabase
    .from('post_owner_prices')
    .select('post_id, price');
  const priceByPost = new Map((prices ?? []).map((p) => [p.post_id, p.price]));

  const posts: MyPost[] = rows.map((row) => ({
    id: row.id,
    worker_id: row.worker_id,
    caption: row.caption,
    total_slots: row.total_slots,
    slots_filled: row.slots_filled,
    status: row.status as PostStatus,
    created_at: row.created_at,
    price: priceByPost.get(row.id) ?? null,
  }));

  return { posts, error: null, hasMore: rows.length === pageSize };
}

// WORKER: create a new post. Caller must pass already-validated numbers (the
// form validates first); we re-check here too so a bad value never reaches the
// database. slots_filled and status get the schema defaults (0 / 'open').
export async function createPost(
  caption: string,
  totalSlots: number,
  price: number
): Promise<{ success: boolean; message: string }> {
  const { data: auth } = await supabase.auth.getUser();
  // Guard: must be signed in.
  if (!auth.user) {
    return { success: false, message: 'You must be signed in to post.' };
  }
  // Guard: caption must not be blank.
  if (!caption.trim()) {
    return { success: false, message: 'Please write a caption for your post.' };
  }
  // Guard: total slots must be a positive whole number.
  if (!Number.isInteger(totalSlots) || totalSlots <= 0) {
    return { success: false, message: 'Total slots must be a whole number above 0.' };
  }
  // Guard: price must be a non-negative number (test money, but still validated).
  if (Number.isNaN(price) || price < 0) {
    return { success: false, message: 'Price must be 0 or more.' };
  }

  const { error } = await supabase.from('posts').insert({
    worker_id: auth.user.id,
    caption: caption.trim(),
    total_slots: totalSlots,
    price,
    status: POST_STATUS.OPEN,
    // slots_filled defaults to 0 in the schema; we don't send it.
  });

  // Guard: a failed insert (e.g. suspended worker blocked by RLS) gets a clear
  // message instead of a raw Postgres error.
  if (error) {
    return {
      success: false,
      message: 'Could not create the post. Your worker account may be inactive.',
    };
  }
  return { success: true, message: 'Post created.' };
}

// WORKER: soft-remove a post by archiving it. We never hard-delete from the app
// (only admins delete). We re-scope the update to the owner as defense in depth.
export async function archivePost(
  postId: string
): Promise<{ success: boolean; message: string }> {
  const { data: auth } = await supabase.auth.getUser();
  // Guard: must be signed in.
  if (!auth.user) {
    return { success: false, message: 'You must be signed in.' };
  }

  const { error } = await supabase
    .from('posts')
    .update({ status: POST_STATUS.ARCHIVED })
    .eq('id', postId)
    .eq('worker_id', auth.user.id); // belt-and-braces with the owner RLS policy

  // Guard: clear message on failure.
  if (error) {
    return { success: false, message: 'Could not archive the post. Please try again.' };
  }
  return { success: true, message: 'Post archived.' };
}
