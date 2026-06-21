import * as Linking from 'expo-linking';
import { ageFromBirthDate } from './birthdate';
import { supabase } from './supabase';

// Where Supabase should send the user after they click the email link. This is
// a deep link back INTO the app (e.g. circulaid://confirm), so the confirmation
// screen can react to it. The link carries the auth tokens with it.
const EMAIL_CONFIRM_REDIRECT = Linking.createURL('/confirm');

// The shape of a row in public.users. Roles and worker status are ALWAYS read
// from the database (here), never trusted from local app state, so a user can't
// fake admin access by editing client memory.
export type UserProfile = {
  id: string;
  full_name: string;
  age: number | null;
  // Birth date as "YYYY-MM-DD" (we show the month/year and derive age from it).
  birth_date: string | null;
  email: string | null;
  // Stored normalized to the +63 format (see lib/validation.normalizePhoneNumber).
  phone_number: string | null;
  // When the full_name was last changed — used to limit name edits to once/week.
  name_updated_at: string | null;
  // Public URL of the user's profile photo (null until they upload one).
  avatar_url: string | null;
  role: 'client' | 'worker' | 'admin';
  account_status: 'active' | 'suspended';
};

// Create a new account. We pass full_name/age/phone_number as auth metadata; a
// database trigger (handle_new_user) creates the matching public.users row as a
// 'client'. We do NOT insert into public.users from the client (RLS forbids it).
// `phoneNumber` must already be normalized to the +63 format by the caller.
export async function signUp(
  fullName: string,
  age: number,
  email: string,
  password: string,
  phoneNumber: string,
  birthDate: string
) {
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: fullName, age, phone_number: phoneNumber, birth_date: birthDate },
      // Send the confirmation link back to our app so /confirm can react to it.
      emailRedirectTo: EMAIL_CONFIRM_REDIRECT,
    },
  });
  return { error };
}

// Is this email already attached to an account? Used by the register screen to
// warn before sign-up. Backed by a SECURITY DEFINER RPC because RLS hides other
// users' rows. On any failure we return false (don't block sign-up on a check
// outage — the unique index + auth still guard the real insert).
export async function isEmailRegistered(email: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('email_in_use', { p_email: email.trim() });
  if (error) return false;
  return data === true;
}

// Is this phone number already attached to ANOTHER account? Used by both the
// register screen and the edit-details flow. The RPC excludes the caller's own
// row, so re-saving your existing number is never flagged. Fails open (false).
export async function isPhoneRegistered(phone: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('phone_in_use', { p_phone: phone });
  if (error) return false;
  return data === true;
}

// Re-send the confirmation email (used by the confirmation screen if the first
// email never arrived). Safe to call with just the email address.
export async function resendConfirmation(email: string) {
  const { error } = await supabase.auth.resend({ type: 'signup', email });
  return { error };
}

// Log in an existing account (regular user or admin — same screen for both).
export async function signIn(email: string, password: string) {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  return { error };
}

// Log out. Clearing the session triggers onAuthStateChange, which sends the
// user back to Login from anywhere in the app.
export async function signOut() {
  const { error } = await supabase.auth.signOut();
  return { error };
}

// Update the signed-in user's own editable account details (NOT email, role or
// account_status). Age is DERIVED from birth_date here (never typed). We scope
// the update to auth.uid(); RLS enforces ownership, the privileged-columns
// trigger blocks role/status changes, and trg_users_name_guard both stamps
// name_updated_at and rejects a name change made within 7 days of the last one.
export async function updateUserProfile(input: {
  full_name: string;
  birth_date: string;
  phone_number: string;
}): Promise<{ success: boolean; message: string }> {
  const { data: auth } = await supabase.auth.getUser();
  // Guard: must be signed in to edit a profile.
  if (!auth.user) {
    return { success: false, message: 'You must be signed in to edit your details.' };
  }

  // Guard: the phone number must not already belong to ANOTHER account (the RPC
  // excludes this user's own row, so keeping the same number is fine).
  if (await isPhoneRegistered(input.phone_number)) {
    return { success: false, message: 'That phone number is already in use by another account.' };
  }

  const { error } = await supabase
    .from('users')
    .update({
      full_name: input.full_name,
      birth_date: input.birth_date,
      age: ageFromBirthDate(input.birth_date),
      phone_number: input.phone_number,
    })
    .eq('id', auth.user.id);

  // Guard: the DB raises NAME_CHANGE_TOO_SOON when a name is changed too soon —
  // translate it to a clear message. Any other failure is reported generically.
  if (error) {
    if ((error.message ?? '').includes('NAME_CHANGE_TOO_SOON')) {
      return { success: false, message: 'You can only change your name once a week.' };
    }
    return { success: false, message: 'Could not save your details. Please try again.' };
  }
  return { success: true, message: 'Details updated.' };
}

// Upload (or replace) the signed-in user's profile photo. The image is passed
// as base64 (from expo-image-picker), decoded to bytes, and stored under
// avatars/{uid}/... — a path the Storage RLS policies restrict to this user.
// The resulting public URL is mirrored onto users.avatar_url for easy display.
export async function uploadAvatar(input: {
  base64: string;
  mimeType?: string;
}): Promise<{ success: boolean; message: string; url?: string }> {
  const { data: auth } = await supabase.auth.getUser();
  // Guard: must be signed in to change a photo.
  if (!auth.user) {
    return { success: false, message: 'You must be signed in to change your photo.' };
  }

  // Decode base64 -> bytes (Hermes provides atob). A plain Uint8Array uploads
  // reliably from React Native, unlike Blobs which can upload as 0 bytes.
  const bytes = base64ToBytes(input.base64);
  if (!bytes.length) {
    return { success: false, message: 'That image could not be read. Try another.' };
  }

  const contentType = input.mimeType ?? 'image/jpeg';
  const ext = contentType.includes('png') ? 'png' : 'jpg';
  // Unique filename per upload so the CDN never serves a stale cached photo.
  const path = `${auth.user.id}/${Date.now()}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from('avatars')
    .upload(path, bytes, { contentType, upsert: true });
  if (uploadError) {
    return { success: false, message: 'Could not upload your photo. Please try again.' };
  }

  const { data: pub } = supabase.storage.from('avatars').getPublicUrl(path);
  const url = pub.publicUrl;

  const { error: updateError } = await supabase
    .from('users')
    .update({ avatar_url: url })
    .eq('id', auth.user.id);
  if (updateError) {
    return { success: false, message: 'Photo uploaded, but saving it failed. Try again.' };
  }
  return { success: true, message: 'Profile photo updated.', url };
}

// Decode a base64 string into a byte array using the runtime's atob.
function base64ToBytes(base64: string): Uint8Array {
  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch {
    return new Uint8Array();
  }
}

// Send a password-reset email. The user must click the link in that email
// (proving they own the address) before they can set a new password — the link
// reopens the app at /reset-password with a short-lived recovery session.
export async function requestPasswordReset(
  email: string
): Promise<{ success: boolean; message: string }> {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: Linking.createURL('/reset-password'),
  });
  // Guard: surface send failures (rate limits, bad address) in plain language.
  if (error) {
    return { success: false, message: error.message };
  }
  return { success: true, message: 'Check your email for a password reset link.' };
}

// Set a new password for the user who arrived via a recovery link (their
// recovery session is already active when this runs).
export async function updatePassword(
  newPassword: string
): Promise<{ success: boolean; message: string }> {
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) {
    return { success: false, message: error.message };
  }
  return { success: true, message: 'Password updated.' };
}

// Permanently delete the signed-in user's OWN account. A client can't delete an
// auth user directly, so this calls a service-role Edge Function that verifies
// the caller's token and deletes only their own id (cascading to public.users
// and everything that references it). We then clear the local session.
export async function deleteOwnAccount(): Promise<{ success: boolean; message: string }> {
  try {
    const { error } = await supabase.functions.invoke('delete-account');
    // Guard: any function-side failure -> surface a clear message, stay signed in.
    if (error) {
      return { success: false, message: 'Could not delete your account. Please try again.' };
    }
    // Clear the now-orphaned local session; onAuthStateChange routes to Login.
    await supabase.auth.signOut();
    return { success: true, message: 'Account deleted.' };
  } catch {
    // Guard: a thrown network error also falls back cleanly.
    return { success: false, message: 'Could not delete your account. Please try again.' };
  }
}

// Fetch the logged-in user's row from public.users (their role + profile data).
// Returns null if there is no session or the row can't be found.
export async function getCurrentUser(): Promise<UserProfile | null> {
  const { data: auth } = await supabase.auth.getUser();
  // Guard: no signed-in auth user means there is no profile to fetch.
  if (!auth.user) return null;

  const { data, error } = await supabase
    .from('users')
    .select('id, full_name, age, birth_date, email, phone_number, name_updated_at, avatar_url, role, account_status')
    .eq('id', auth.user.id)
    .single();

  // Guard: surface a missing/unreadable row as null so routing can send the
  // user to the ErrorRoleScreen instead of silently letting them through.
  // We log WHY (not any password) so the cause is visible during development:
  //   - code "PGRST116" -> no matching row (the public.users row is missing)
  //   - code "42P01"     -> the users table doesn't exist (migration not applied)
  //   - code "42501"     -> RLS blocked the read
  if (error) {
    console.warn('[auth] Could not load user profile:', error.code, error.message);
    return null;
  }
  return data as UserProfile;
}
