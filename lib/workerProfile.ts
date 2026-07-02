import { supabase } from './supabase';

// The worker setup form now collects only a bio + location (no AI, no category,
// no years of experience — experience is captured PER skill post instead).
export type WorkerSetupInput = {
  bio: string;
  location: string;
};

// Create (or update) the signed-in user's worker_profiles row from the setup
// form. The whole-account role is promoted client -> worker by a database
// trigger when this row is first inserted, so there is no separate flag to set
// from the client.
//
// SECURITY: we read the user id from the authenticated session (auth.getUser),
// never from a navigation param, so a worker profile can only ever be created
// under the caller's own account. RLS on worker_profiles enforces the same rule.
export async function saveWorkerProfile(
  input: WorkerSetupInput
): Promise<{ success: boolean; message: string }> {
  const { data: auth } = await supabase.auth.getUser();
  // Guard: must be signed in to attach a worker profile.
  if (!auth.user) {
    return { success: false, message: 'You must be signed in to set up a service provider profile.' };
  }
  // Guard: a bio is required before we save (the form also checks length).
  if (!input.bio.trim()) {
    return { success: false, message: 'Please write a short bio before saving.' };
  }
  // Guard: location is required (typed manually or captured via GPS).
  if (!input.location.trim()) {
    return { success: false, message: 'Please enter your location.' };
  }

  const { error } = await supabase
    .from('worker_profiles')
    .upsert(
      {
        user_id: auth.user.id,
        bio: input.bio.trim(),
        location: input.location.trim(),
      },
      { onConflict: 'user_id' }
    );

  // Guard: report failures in plain language instead of a raw Postgres error.
  if (error) {
    return { success: false, message: 'Could not save your service provider profile. Please try again.' };
  }
  return { success: true, message: 'Service provider profile created.' };
}
