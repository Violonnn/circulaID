import { supabase } from './supabase';
import { ACTIVE_ROLE, HIRE_STATUS, PAGE_SIZE, type ActiveRole } from './constants';
import { clientNamesForWorker } from './hireRequests';
import { toTitleCase } from './format';

// Statuses at which a hire's chat thread is unlocked. Chat opens on acceptance
// and stays available through completion/payment. Pending/rejected/cancelled
// hires never show a thread.
const CHAT_VISIBLE_STATUSES = [
  HIRE_STATUS.ACCEPTED,
  HIRE_STATUS.IN_PROGRESS,
  HIRE_STATUS.COMPLETED,
  HIRE_STATUS.PAID,
];

export type ChatThread = {
  id: string;
  hire_request_id: string;
  post_caption: string | null;
  counterparty_name: string | null;
  // Public URL of the other party's profile photo (null until they upload one).
  counterparty_avatar_url: string | null;
  hire_status: string;
};

export type Message = {
  id: string;
  thread_id: string;
  sender_id: string;
  content: string;
  created_at: string;
  // 'text' (normal), 'system' (centered flow note), or 'image' (attachment_url
  // holds the photo). Defaults to 'text' for older rows.
  kind: 'text' | 'system' | 'image';
  attachment_url: string | null;
};

type ThreadRow = {
  id: string;
  hire_request_id: string;
  hire_requests: {
    status: string;
    client_id: string;
    worker_id: string;
    // Denormalized job label, set by the hire insert trigger from the post
    // (worker_posts.ai_title / posts.caption). Read directly so a CLIENT never
    // needs access to the owner-only worker_posts row.
    post_title: string | null;
  } | null;
};

// List the chat threads the signed-in user is part of, paginated, limited to
// hires that are accepted or later. We use an inner join so we can filter on the
// hire status, and derive the "other person" name from the safe public_profiles
// view.
//
// Scoped to the active role: in CLIENT view we only return hires where the user
// is the client; in WORKER view only those where the user is the worker. The
// scope is applied as an .eq() at the query level (not by filtering in JS).
export async function getChatThreads(
  activeRole: ActiveRole,
  page = 0,
  pageSize = PAGE_SIZE
): Promise<{
  threads: ChatThread[];
  error: string | null;
  hasMore: boolean;
}> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { threads: [], error: 'You must be signed in.', hasMore: false };
  const currentUserId = auth.user.id;

  const from = page * pageSize;
  const to = from + pageSize - 1;

  let query = supabase
    .from('chat_threads')
    .select(
      'id, hire_request_id, created_at, hire_requests!inner(status, client_id, worker_id, post_title)'
    )
    .eq('archived', false)
    .in('hire_requests.status', CHAT_VISIBLE_STATUSES);

  // Role-scoped filter, applied to the joined hire_requests row.
  if (activeRole === ACTIVE_ROLE.WORKER) {
    query = query.eq('hire_requests.worker_id', currentUserId);
  } else {
    query = query.eq('hire_requests.client_id', currentUserId);
  }

  const { data, error } = await query
    .order('created_at', { ascending: false })
    .range(from, to);

  if (error) {
    return { threads: [], error: 'Could not load your chats.', hasMore: false };
  }
  const rows = (data as unknown as ThreadRow[]) ?? [];

  // The other party is the worker when we are the client, and vice versa.
  //  * When WE are the client, we read the worker's public name (public_profiles).
  //  * When WE are the worker, we read the client's name via the RPC that only
  //    discloses names of clients who have hired us. Names are title-cased.
  const workerIdsToName = rows
    .filter((row) => row.hire_requests?.client_id === currentUserId)
    .map((row) => row.hire_requests!.worker_id);
  const clientIdsToName = rows
    .filter((row) => row.hire_requests?.worker_id === currentUserId)
    .map((row) => row.hire_requests!.client_id);

  const [workerInfoById, clientInfoById] = await Promise.all([
    getWorkerNames(workerIdsToName),
    clientNamesForWorker(clientIdsToName),
  ]);

  const threads: ChatThread[] = rows.map((row) => {
    const hire = row.hire_requests!;
    const weAreClient = hire.client_id === currentUserId;
    const info = weAreClient
      ? workerInfoById.get(hire.worker_id)
      : clientInfoById.get(hire.client_id);
    const rawName = info?.full_name ?? null;
    // Real names get title-cased; a missing name falls back to a stable label.
    const counterparty = rawName
      ? toTitleCase(rawName)
      : weAreClient
        ? 'Worker'
        : `Client #${hire.client_id.slice(0, 8)}`;
    return {
      id: row.id,
      hire_request_id: row.hire_request_id,
      post_caption: hire.post_title ?? null,
      counterparty_name: counterparty,
      counterparty_avatar_url: info?.avatar_url ?? null,
      hire_status: hire.status,
    };
  });

  return { threads, error: null, hasMore: rows.length === pageSize };
}

// All messages in a thread, oldest first.
export async function getMessages(threadId: string): Promise<{
  messages: Message[];
  error: string | null;
}> {
  const { data, error } = await supabase
    .from('messages')
    .select('id, thread_id, sender_id, content, created_at, kind, attachment_url')
    .eq('thread_id', threadId)
    .order('created_at', { ascending: true });

  if (error) {
    return { messages: [], error: 'Could not load messages.' };
  }
  return { messages: (data as Message[]) ?? [], error: null };
}

// Send a message into a thread. We reject empty/whitespace-only content here;
// the database also enforces length(trim(content)) > 0.
export async function sendMessage(
  threadId: string,
  content: string
): Promise<{ success: boolean; message: string }> {
  const { data: auth } = await supabase.auth.getUser();
  // Guard: must be signed in.
  if (!auth.user) {
    return { success: false, message: 'You must be signed in.' };
  }
  // Guard: no empty/whitespace-only messages.
  if (!content.trim()) {
    return { success: false, message: 'Message cannot be empty.' };
  }

  const { error } = await supabase.from('messages').insert({
    thread_id: threadId,
    sender_id: auth.user.id,
    content: content.trim(),
  });

  // Guard: a blocked send (e.g. suspended account, locked thread) gets a plain
  // message instead of a raw error.
  if (error) {
    return { success: false, message: 'Could not send your message.' };
  }
  return { success: true, message: 'sent' };
}

type PersonInfo = { full_name: string | null; avatar_url: string | null };

async function getWorkerNames(workerIds: string[]): Promise<Map<string, PersonInfo>> {
  if (workerIds.length === 0) return new Map();
  const { data } = await supabase
    .from('public_profiles')
    .select('id, full_name, avatar_url')
    .in('id', Array.from(new Set(workerIds)));
  return new Map(
    (data ?? []).map((row) => [
      row.id as string,
      { full_name: (row.full_name as string) ?? null, avatar_url: (row.avatar_url as string) ?? null },
    ])
  );
}
