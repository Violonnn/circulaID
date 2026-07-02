import { supabase } from './supabase';
import { HIRE_STATUS, QR_STAGE } from './constants';
import { getHireRequestById } from './hires';
import { getQrSession } from './payments';

const PROOFS_BUCKET = 'proofs';

// Decode a base64 string (from ImagePicker) into bytes we can upload. We do this
// by hand to avoid pulling in an extra dependency just for one screen.
function base64ToBytes(base64: string): Uint8Array {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const lookup = new Uint8Array(256);
  for (let i = 0; i < chars.length; i++) lookup[chars.charCodeAt(i)] = i;

  const clean = base64.replace(/[^A-Za-z0-9+/]/g, '');
  const padding = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
  const byteLength = (clean.length * 3) / 4 - padding;
  const bytes = new Uint8Array(byteLength);

  let pointer = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const a = lookup[clean.charCodeAt(i)];
    const b = lookup[clean.charCodeAt(i + 1)];
    const c = lookup[clean.charCodeAt(i + 2)];
    const d = lookup[clean.charCodeAt(i + 3)];

    bytes[pointer++] = (a << 2) | (b >> 4);
    if (pointer < byteLength) bytes[pointer++] = ((b & 15) << 4) | (c >> 2);
    if (pointer < byteLength) bytes[pointer++] = ((c & 3) << 6) | d;
  }
  return bytes;
}

// WORKER: submit proof of work for an in-progress hire (Step 8). Guard clauses
// run first; then we upload the photo and call the submit_proof RPC, which
// atomically writes the proof row AND re-opens the QR session to
// (open, completion_pending) so the client can confirm completion.
export async function submitProofOfWork(
  hireRequestId: string,
  base64Image: string,
  contentType: string,
  note: string
): Promise<{ success: boolean; message: string }> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) {
    return { success: false, message: 'You must be signed in.' };
  }

  // Guard: re-read the hire from the database (not stale UI state).
  const { hire, error } = await getHireRequestById(hireRequestId);
  if (error || !hire) {
    return { success: false, message: 'Hire request not found.' };
  }
  // Guard: only the assigned worker may submit proof.
  if (hire.worker_id !== auth.user.id) {
    return { success: false, message: 'Only the assigned service provider can submit proof.' };
  }
  // Guard: the job must be in progress.
  if (hire.status !== HIRE_STATUS.IN_PROGRESS) {
    return { success: false, message: 'The job must be started before submitting proof.' };
  }

  // Guard: the client must have already started the job (QR closed at the
  // work_in_progress stage). If proof was already submitted, stop here.
  const qr = await getQrSession(hireRequestId);
  if (!qr || qr.stage !== QR_STAGE.WORK_IN_PROGRESS) {
    return { success: false, message: 'You can only submit proof after the job has started.' };
  }

  // Upload the photo to the private proofs bucket, namespaced by hire id so the
  // storage policies can tie it back to this hire.
  const extension = contentType === 'image/png' ? 'png' : 'jpg';
  const path = `${hireRequestId}/${Date.now()}.${extension}`;
  const { error: uploadError } = await supabase.storage
    .from(PROOFS_BUCKET)
    .upload(path, base64ToBytes(base64Image), { contentType });

  // Guard: a failed upload should not advance the hire state.
  if (uploadError) {
    return { success: false, message: 'Could not upload the photo. Please try again.' };
  }

  // Happy path: the RPC records the proof and re-opens the QR atomically.
  const { error: rpcError } = await supabase.rpc('submit_proof', {
    p_hire: hireRequestId,
    p_photo_url: path,
    p_note: note.trim() || null,
  });

  if (rpcError) {
    return { success: false, message: 'Could not submit proof. Please try again.' };
  }
  return { success: true, message: 'Proof submitted. The client can now confirm completion.' };
}
