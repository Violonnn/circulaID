import { supabase } from './supabase';
import { type HireStatus } from './constants';
import { getHeldTransaction, getWalletBalance } from './payments';

// Negotiated, chat-driven payment flow. ALL money here is SIMULATED test data —
// there is NO real payment gateway. The atomic money moves live in the SECURITY
// DEFINER RPCs (send_final_price / pay_for_hire / worker_mark_done /
// confirm_satisfied); these helpers add guard clauses for clear messages, and
// the RPC re-validates the caller against the session every time.

const JOB_PHOTOS_BUCKET = 'job-photos';

// Everything the chat payment panel needs to pick the one correct action for
// the current side + phase. The two "phases" the UI shows are DERIVED here:
//   pending_payment      = status 'accepted' && finalAmount != null && !held
//   pending_confirmation = status 'in_progress' && workDone
export type ChatPayment = {
  hireRequestId: string;
  status: HireStatus;
  isClient: boolean;
  isWorker: boolean;
  finalAmount: number | null;
  workDone: boolean;
  heldAmount: number | null;
  walletBalance: number | null;
};

// The QR encodes ONLY a reference to the hire (never the amount or any balance).
// The client's device looks the hire up and calls the same pay_for_hire RPC,
// which re-checks the actor + status server-side.
type PayQr = { v: 1; pay: string };

export function buildPayQr(hireRequestId: string): string {
  const payload: PayQr = { v: 1, pay: hireRequestId };
  return JSON.stringify(payload);
}

export function parsePayQr(raw: string): string | null {
  try {
    const parsed = JSON.parse(raw) as PayQr;
    if (parsed?.v !== 1 || !parsed.pay) return null;
    return parsed.pay;
  } catch {
    return null;
  }
}

// Load the chat payment state from the thread's hire.
export async function getChatPayment(threadId: string): Promise<ChatPayment | null> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;

  const { data, error } = await supabase
    .from('chat_threads')
    .select('hire_requests!inner(id, client_id, worker_id, status, final_amount, work_done_at)')
    .eq('id', threadId)
    .maybeSingle();

  // Guard: a missing/blocked thread simply yields no panel.
  if (error || !data) return null;
  const hire = (data as unknown as {
    hire_requests: {
      id: string;
      client_id: string;
      worker_id: string;
      status: HireStatus;
      final_amount: number | string | null;
      work_done_at: string | null;
    } | null;
  }).hire_requests;
  if (!hire) return null;

  const held = await getHeldTransaction(hire.id);
  const balance = await getWalletBalance();

  return {
    hireRequestId: hire.id,
    status: hire.status,
    isClient: hire.client_id === auth.user.id,
    isWorker: hire.worker_id === auth.user.id,
    finalAmount: hire.final_amount != null ? Number(hire.final_amount) : null,
    workDone: !!hire.work_done_at,
    heldAmount: held ? Number(held.amount) : null,
    walletBalance: balance,
  };
}

// WORKER: propose the negotiated final price (PART 1).
export async function sendFinalPrice(
  hireRequestId: string,
  amount: number
): Promise<{ success: boolean; message: string }> {
  // Guard: must be a valid positive number before we touch the database.
  if (!Number.isFinite(amount) || amount <= 0) {
    return { success: false, message: 'Enter a valid amount greater than zero.' };
  }
  const { error } = await supabase.rpc('send_final_price', {
    p_hire: hireRequestId,
    p_amount: amount,
  });
  if (error) {
    return { success: false, message: 'Could not send the price. Please try again.' };
  }
  return { success: true, message: 'Final price sent.' };
}

// CLIENT: pay for the hire (PART 2). SHARED by BOTH triggers — the "Pay Now"
// button and the QR scan both call this exact function; the payment logic is
// never duplicated.
export async function payForHire(
  hireRequestId: string
): Promise<{ success: boolean; message: string }> {
  const { error } = await supabase.rpc('pay_for_hire', { p_hire: hireRequestId });
  if (error) {
    // The RPC checks the SIMULATED balance atomically and raises this message.
    if (error.message?.toLowerCase().includes('insufficient')) {
      return { success: false, message: 'Insufficient test balance.' };
    }
    return { success: false, message: 'Could not complete the payment. Please try again.' };
  }
  return { success: true, message: 'Payment held in escrow. Job is now in progress.' };
}

// WORKER: mark the job done with a REQUIRED photo (PART 3). Uploads the photo,
// then the RPC records it, posts it in chat and advances the flow atomically.
export async function markJobDone(
  hireRequestId: string,
  base64Image: string,
  contentType: string
): Promise<{ success: boolean; message: string }> {
  // Guard: a photo is required (the button is also disabled until one is added).
  if (!base64Image) {
    return { success: false, message: 'Attach at least 1 photo to mark as done.' };
  }
  const ext = contentType === 'image/png' ? 'png' : 'jpg';
  const path = `${hireRequestId}/${Date.now()}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from(JOB_PHOTOS_BUCKET)
    .upload(path, base64ToBytes(base64Image), { contentType });
  // Guard: a failed upload must not advance the job state.
  if (uploadError) {
    return { success: false, message: 'Could not upload the photo. Please try again.' };
  }
  const { data: pub } = supabase.storage.from(JOB_PHOTOS_BUCKET).getPublicUrl(path);

  const { error } = await supabase.rpc('worker_mark_done', {
    p_hire: hireRequestId,
    p_photo_url: pub.publicUrl,
  });
  if (error) {
    return { success: false, message: 'Could not mark the job done. Please try again.' };
  }
  return { success: true, message: 'Marked as done. Waiting for the client to confirm.' };
}

// EITHER PARTY: cancel the hire during the pre-payment ('accepted') phase. The
// RPC re-checks the caller is a participant and that no escrow is held yet, then
// flips the hire to 'cancelled' (which frees the slot) and posts a chat note.
export async function cancelHire(
  hireRequestId: string
): Promise<{ success: boolean; message: string }> {
  const { error } = await supabase.rpc('cancel_hire', { p_hire: hireRequestId });
  if (error) {
    // The RPC raises this once payment is held / status has moved on.
    if (error.message?.toLowerCase().includes('no longer be cancelled')) {
      return { success: false, message: 'This hire can no longer be cancelled.' };
    }
    return { success: false, message: 'Could not cancel this hire. Please try again.' };
  }
  return { success: true, message: 'Hire cancelled.' };
}

// CLIENT: confirm satisfaction — release escrow + generate the receipt (PART 4).
export async function confirmSatisfied(
  hireRequestId: string
): Promise<{ success: boolean; message: string }> {
  const { error } = await supabase.rpc('confirm_satisfied', { p_hire: hireRequestId });
  if (error) {
    return { success: false, message: 'Could not confirm completion. Please try again.' };
  }
  return { success: true, message: 'Payment released. Thanks!' };
}

// Decode a base64 string (from ImagePicker) into bytes for Storage upload. Done
// by hand to avoid pulling in an extra dependency (same pattern as lib/proofs).
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
