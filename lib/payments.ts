import { supabase } from './supabase';
import {
  ESCROW_STATUS,
  HIRE_STATUS,
  QR_STAGE,
  QR_STATE,
  type EscrowStatus,
  type QrStage,
  type QrState,
} from './constants';
import { getHireRequestById } from './hires';

// All money here is SIMULATED. These helpers wrap the database's SECURITY
// DEFINER RPCs (start_hire / complete_hire), which perform the multi-step money
// moves ATOMICALLY in one transaction. We add guard clauses on top purely to
// give the user a clear message before calling — the RPC re-checks everything.

export type QrSession = {
  id: string;
  hire_request_id: string;
  token: string;
  state: QrState;
  stage: QrStage;
};

export type HeldTransaction = {
  id: string;
  hire_request_id: string;
  amount: number;
  status: EscrowStatus;
};

// The signed-in user's SIMULATED wallet balance (or null if unreadable).
export async function getWalletBalance(): Promise<number | null> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;

  const { data, error } = await supabase
    .from('wallets')
    .select('balance')
    .eq('user_id', auth.user.id)
    .maybeSingle();

  // Guard: never crash on a missing wallet — report null and let the UI decide.
  if (error) {
    console.warn('[payments] Could not load wallet:', error.code, error.message);
    return null;
  }
  return data ? Number(data.balance) : null;
}

// The QR session for a hire (one per accepted hire). Participants can read it.
export async function getQrSession(hireRequestId: string): Promise<QrSession | null> {
  const { data, error } = await supabase
    .from('qr_sessions')
    .select('id, hire_request_id, token, state, stage')
    .eq('hire_request_id', hireRequestId)
    .maybeSingle();

  if (error) {
    console.warn('[payments] Could not load QR session:', error.code, error.message);
    return null;
  }
  return (data as QrSession) ?? null;
}

// Batch-load QR sessions for several hires at once (used by the client Hires
// list so it can decide which scan action each card should show without one
// query per row).
export async function getQrSessionsForHires(
  hireRequestIds: string[]
): Promise<Map<string, QrSession>> {
  if (hireRequestIds.length === 0) return new Map();
  const { data, error } = await supabase
    .from('qr_sessions')
    .select('id, hire_request_id, token, state, stage')
    .in('hire_request_id', hireRequestIds);

  if (error) {
    console.warn('[payments] Could not batch-load QR sessions:', error.code, error.message);
    return new Map();
  }
  return new Map((data as QrSession[]).map((row) => [row.hire_request_id, row]));
}

// The escrow row for a hire, if any.
export async function getHeldTransaction(
  hireRequestId: string
): Promise<HeldTransaction | null> {
  const { data, error } = await supabase
    .from('held_transactions')
    .select('id, hire_request_id, amount, status')
    .eq('hire_request_id', hireRequestId)
    .maybeSingle();

  if (error) {
    console.warn('[payments] Could not load escrow:', error.code, error.message);
    return null;
  }
  return (data as HeldTransaction) ?? null;
}

// CLIENT "Scan to Start" (Step 6). Guard clauses run first; the actual job start
// (escrow hold + status -> in_progress + QR close) happens atomically inside the
// start_hire RPC.
//
// NOTE: guard #3 in the prompt ("client's balance covers the price") cannot be
// done on the client, because the post price is intentionally HIDDEN from
// clients. Instead the start_hire RPC reads the hidden price and atomically
// checks the balance, and we surface its "insufficient" error as a clear message.
export async function startHire(
  hireRequestId: string
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
  // Guard: the hire must belong to the current client.
  if (hire.client_id !== auth.user.id) {
    return { success: false, message: 'This hire is not yours to start.' };
  }
  // Guard: only an accepted hire can be started.
  if (hire.status !== HIRE_STATUS.ACCEPTED) {
    return { success: false, message: 'This job is not ready to start yet.' };
  }

  // Guard: the QR session must be open at the start_pending stage.
  const qr = await getQrSession(hireRequestId);
  if (!qr || qr.state !== QR_STATE.OPEN || qr.stage !== QR_STAGE.START_PENDING) {
    return { success: false, message: 'This job cannot be started right now.' };
  }

  // Happy path: hand the QR token to the atomic RPC.
  const { error: rpcError } = await supabase.rpc('start_hire', {
    p_hire: hireRequestId,
    p_token: qr.token,
  });

  if (rpcError) {
    // Translate the most important RPC error (hidden-price balance check).
    if (rpcError.message?.toLowerCase().includes('insufficient')) {
      return { success: false, message: 'Insufficient balance.' };
    }
    return { success: false, message: 'Could not start the job. Please try again.' };
  }
  return { success: true, message: 'Job started. Funds are now held in escrow.' };
}

// CLIENT "Scan to Confirm Completion" (Step 6). Guard clauses first; the release
// of escrow + status -> paid + receipt creation happen atomically in complete_hire.
export async function completeHire(
  hireRequestId: string
): Promise<{ success: boolean; message: string }> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) {
    return { success: false, message: 'You must be signed in.' };
  }

  // Guard: re-read the hire.
  const { hire, error } = await getHireRequestById(hireRequestId);
  if (error || !hire) {
    return { success: false, message: 'Hire request not found.' };
  }
  // Guard: must belong to the current client.
  if (hire.client_id !== auth.user.id) {
    return { success: false, message: 'This hire is not yours to confirm.' };
  }
  // Guard: must be in progress.
  if (hire.status !== HIRE_STATUS.IN_PROGRESS) {
    return { success: false, message: 'This job is not in progress.' };
  }

  // Guard: proof of work must have been submitted — that's exactly what reopens
  // the QR session to (open, completion_pending). If it isn't, we never fire.
  const qr = await getQrSession(hireRequestId);
  if (!qr || qr.state !== QR_STATE.OPEN || qr.stage !== QR_STAGE.COMPLETION_PENDING) {
    return {
      success: false,
      message: 'The worker has not submitted proof of work yet.',
    };
  }

  // Guard: a matching held escrow row must exist before we move money.
  const held = await getHeldTransaction(hireRequestId);
  if (!held || held.status !== ESCROW_STATUS.HELD) {
    return { success: false, message: 'No held funds found for this job.' };
  }

  // Happy path: atomic settlement via the RPC.
  const { error: rpcError } = await supabase.rpc('complete_hire', {
    p_hire: hireRequestId,
    p_token: qr.token,
  });

  if (rpcError) {
    return { success: false, message: 'Could not confirm completion. Please try again.' };
  }
  return { success: true, message: 'Job completed. Funds released to the worker.' };
}
