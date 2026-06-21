import { supabase } from './supabase';
import type { AccountStatus } from './constants';

// A row from public.worker_profiles for the signed-in user. Note the worker's
// status column is `status` (NOT `account_status` as the build prompt assumed).
// The setup flow now stores only bio + location at the profile level; experience
// length lives PER skill post (see lib/workerPosts).
export type WorkerProfile = {
  user_id: string;
  bio: string | null;
  // Filled in by the "become a worker" setup flow (nullable for older rows).
  location: string | null;
  rating_avg: number;
  rating_count: number;
  status: AccountStatus;
};

// Fetch the signed-in user's worker profile, or null if they never became a
// worker. RLS already limits this to the caller's own row, but we still scope
// the query to auth.uid() so we never accidentally request someone else's data.
export async function getWorkerProfile(): Promise<WorkerProfile | null> {
  const { data: auth } = await supabase.auth.getUser();
  // Guard: no signed-in user means there is no worker profile to load.
  if (!auth.user) return null;

  const { data, error } = await supabase
    .from('worker_profiles')
    .select('user_id, bio, location, rating_avg, rating_count, status')
    .eq('user_id', auth.user.id)
    .maybeSingle();

  // Guard: surface read failures as null (no profile) so the UI can fall back to
  // the client-only experience instead of crashing on a missing row.
  if (error) {
    console.warn('[worker] Could not load worker profile:', error.code, error.message);
    return null;
  }
  return (data as WorkerProfile) ?? null;
}

// Update the signed-in worker's editable profile fields (bio + location).
// status/rating are admin/trigger-managed and intentionally not editable here.
export async function updateWorkerProfileFields(input: {
  bio: string;
  location: string;
}): Promise<{ success: boolean; message: string }> {
  const { data: auth } = await supabase.auth.getUser();
  // Guard: must be signed in to edit a profile.
  if (!auth.user) {
    return { success: false, message: 'You must be signed in to edit your profile.' };
  }

  const { error } = await supabase
    .from('worker_profiles')
    .update({ bio: input.bio.trim(), location: input.location.trim() })
    .eq('user_id', auth.user.id);

  // Guard: report the failure in plain language instead of a raw error object.
  if (error) {
    return { success: false, message: 'Could not save your profile. Please try again.' };
  }
  return { success: true, message: 'Profile updated.' };
}
