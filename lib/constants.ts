// Single source of truth for every status/state string used across the app.
// Defining them once (and importing them everywhere) avoids typo bugs like
// 'in-progress' vs 'in_progress', and lets you read each lifecycle in one place.
//
// IMPORTANT: these values are the EXACT lowercase strings stored in the database
// enums. The build prompt referred to QR states as 'OPEN'/'CLOSED', but the real
// schema (enum public.qr_state) uses lowercase 'open'/'closed' plus a separate
// stage enum (public.qr_stage). We follow the database, not the prompt.

// How many rows each paginated list fetches per page. Lists load one page at a
// time and request the next page as the user scrolls (see the *.range() calls in
// lib/posts, lib/hires and lib/chat), so a screen never pulls the whole table.
export const PAGE_SIZE = 10;

// public.user_role — the whole-account role (from the database, never faked).
export const ROLE = {
  CLIENT: 'client',
  WORKER: 'worker',
  ADMIN: 'admin',
} as const;

// The two contexts a regular user can switch the UI between. This is a UI-only
// concept (see RoleContext) — it is NEVER sent to Supabase as a permission.
export const ACTIVE_ROLE = {
  CLIENT: 'client',
  WORKER: 'worker',
} as const;

// public.account_status — used for BOTH users.account_status and
// worker_profiles.status (they share the same enum in the schema).
export const ACCOUNT_STATUS = {
  ACTIVE: 'active',
  SUSPENDED: 'suspended',
} as const;

// public.post_status
export const POST_STATUS = {
  OPEN: 'open',
  FULL: 'full',
  ARCHIVED: 'archived',
  DELETED: 'deleted',
} as const;

// public.hire_status — full lifecycle in order:
// pending -> accepted -> in_progress -> completed -> paid
// (or pending/accepted -> cancelled | rejected)
export const HIRE_STATUS = {
  PENDING: 'pending',
  ACCEPTED: 'accepted',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  PAID: 'paid',
  CANCELLED: 'cancelled',
  REJECTED: 'rejected',
} as const;

// A hire request a client already has on a post that should block them from
// sending another request for the same post (it is not finished or rejected).
export const NON_TERMINAL_HIRE_STATUSES: HireStatus[] = [
  HIRE_STATUS.PENDING,
  HIRE_STATUS.ACCEPTED,
  HIRE_STATUS.IN_PROGRESS,
];

// public.qr_state — the open/closed flag on a QR session.
export const QR_STATE = {
  OPEN: 'open',
  CLOSED: 'closed',
} as const;

// public.qr_stage — the real step in the two-scan handshake. This is what the
// RPCs check, so the UI reads it to decide which scan action to show.
export const QR_STAGE = {
  START_PENDING: 'start_pending',       // created on accept; waiting for scan #1
  WORK_IN_PROGRESS: 'work_in_progress', // after scan #1; job running, escrow held
  COMPLETION_PENDING: 'completion_pending', // after proof submitted; waiting scan #2
  COMPLETED: 'completed',               // after scan #2; paid + receipt written
} as const;

// public.escrow_status — held_transactions lifecycle (SIMULATED money).
export const ESCROW_STATUS = {
  HELD: 'held',
  RELEASED: 'released',
  REFUNDED: 'refunded',
} as const;

export type Role = (typeof ROLE)[keyof typeof ROLE];
export type ActiveRole = (typeof ACTIVE_ROLE)[keyof typeof ACTIVE_ROLE];
export type AccountStatus = (typeof ACCOUNT_STATUS)[keyof typeof ACCOUNT_STATUS];
export type PostStatus = (typeof POST_STATUS)[keyof typeof POST_STATUS];
export type HireStatus = (typeof HIRE_STATUS)[keyof typeof HIRE_STATUS];
export type QrState = (typeof QR_STATE)[keyof typeof QR_STATE];
export type QrStage = (typeof QR_STAGE)[keyof typeof QR_STAGE];
export type EscrowStatus = (typeof ESCROW_STATUS)[keyof typeof ESCROW_STATUS];
