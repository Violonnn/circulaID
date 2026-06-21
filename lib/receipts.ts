import { supabase } from './supabase';
import { clientNamesForWorker } from './hireRequests';
import { toTitleCase } from './format';

// A completed hire's receipt, ready to render + export. All money is SIMULATED.
// Read from the receipts table, whose RLS already limits SELECT to the hire's
// two parties (and admins) — so this never exposes data a viewer can't see.
export type ReceiptView = {
  id: string;
  postTitle: string | null;
  workerName: string;
  clientName: string;
  amount: number;
  startedAt: string;
  completedAt: string;
};

// Load the receipt for a completed hire. Returns null (never throws) when the
// caller isn't a party, the hire isn't completed yet, or anything fails.
export async function getReceiptForHire(hireRequestId: string): Promise<ReceiptView | null> {
  const { data: auth } = await supabase.auth.getUser();
  // Guard: must be signed in.
  if (!auth.user) return null;
  // Guard: need a hire id to look up.
  if (!hireRequestId) return null;

  const { data, error } = await supabase
    .from('receipts')
    .select(
      'id, client_id, worker_id, amount, started_at, completed_at, hire_requests!inner(post_title)'
    )
    .eq('hire_request_id', hireRequestId)
    .maybeSingle();

  // Guard: no row (not a party / not completed yet) -> null, never a crash.
  if (error || !data) return null;

  const row = data as unknown as {
    id: string;
    client_id: string;
    worker_id: string;
    amount: number | string;
    started_at: string;
    completed_at: string;
    hire_requests: { post_title: string | null } | { post_title: string | null }[] | null;
  };
  const hire = Array.isArray(row.hire_requests) ? row.hire_requests[0] : row.hire_requests;

  // Resolve names by viewer role (mirrors lib/chat.ts): you always read your OWN
  // name; the worker reads the client via the client_names_for_worker RPC, and
  // the client reads the worker via the public_profiles view.
  const me = auth.user.id;
  const ownName = await getOwnName(me);
  let workerName = 'Worker';
  let clientName = 'Client';

  if (row.worker_id === me) {
    workerName = ownName ?? 'Worker';
    const info = await clientNamesForWorker([row.client_id]);
    const full = info.get(row.client_id)?.full_name;
    clientName = full ? toTitleCase(full) : 'Client';
  } else if (row.client_id === me) {
    clientName = ownName ?? 'Client';
    workerName = (await getWorkerName(row.worker_id)) ?? 'Worker';
  } else {
    // Admin/other viewer: only the public worker name is available.
    workerName = (await getWorkerName(row.worker_id)) ?? 'Worker';
  }

  return {
    id: row.id,
    postTitle: hire?.post_title ?? null,
    workerName,
    clientName,
    amount: Number(row.amount),
    startedAt: row.started_at,
    completedAt: row.completed_at,
  };
}

// The signed-in user's own display name (their own users row is RLS-readable).
async function getOwnName(userId: string): Promise<string | null> {
  const { data } = await supabase.from('users').select('full_name').eq('id', userId).maybeSingle();
  const name = data?.full_name as string | undefined;
  return name ? toTitleCase(name) : null;
}

// A worker's public display name from the safe public_profiles view.
async function getWorkerName(workerId: string): Promise<string | null> {
  const { data } = await supabase
    .from('public_profiles')
    .select('full_name')
    .eq('id', workerId)
    .maybeSingle();
  const name = data?.full_name as string | undefined;
  return name ? toTitleCase(name) : null;
}
