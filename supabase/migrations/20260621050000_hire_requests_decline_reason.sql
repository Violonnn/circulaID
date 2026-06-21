-- =============================================================================
-- CirculaID — Optional decline reason on hire_requests
-- =============================================================================
-- When a worker declines a pending hire request they may (optionally) leave a
-- short reason. We store it on the hire row itself in a NULLABLE column, so a
-- decline with no reason simply stays null — the reason is never required.
--
-- No new RLS is needed: the existing hire_update_parties_or_admin policy already
-- lets the owning worker (worker_id = auth.uid(), active) update their own rows,
-- and authenticated already has table-level UPDATE. This just adds a column for
-- that same UPDATE to write.
-- =============================================================================

alter table public.hire_requests
  add column if not exists decline_reason text;
