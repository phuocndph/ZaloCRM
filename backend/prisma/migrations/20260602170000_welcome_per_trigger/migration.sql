-- Welcome per-(contact, trigger) — 2026-06-02
-- Move dedup source of truth from Contact.welcomeSentAt (global per-contact) to
-- FriendRequestOutbox scoped by (contactId, triggerId, kind='WELCOME_PROBE').
-- The outbox row already carries triggerId + contactId; this migration only adds
-- the DB-enforced uniqueness guard and helper read index. Contact.welcomeSentAt
-- column is preserved as a legacy display hint.

-- 1. Partial unique guard: only "winning" outcomes (actually sent) contend; failures/duplicates excluded.
--    Note: CREATE INDEX CONCURRENTLY cannot run inside a transaction block — we keep the
--    statement without BEGIN/COMMIT wrapper here. Prisma migrate executes each statement
--    individually; for the deploy migration, the helper script applies via psql directly.
CREATE UNIQUE INDEX IF NOT EXISTS
  uniq_outbox_welcome_sent_per_contact_trigger
  ON friend_request_outbox (contact_id, trigger_id)
  WHERE kind = 'WELCOME_PROBE'
    AND welcome_outcome IN ('SENT_STRANGER', 'SENT_FRIEND');

-- 2. Helper index for the new dedup lookup (read path).
CREATE INDEX IF NOT EXISTS
  idx_outbox_welcome_dedup
  ON friend_request_outbox (contact_id, trigger_id, kind, welcome_outcome);

-- 3. Mark legacy column intent. Contact.welcomeSentAt + welcomeChannel stay; downgraded to display hints.
--    Do NOT DROP COLUMN — preserves backward compat for any FE/report still reading it.
COMMENT ON COLUMN contacts.welcome_sent_at IS
  'LEGACY 2026-06-02: display hint only (last welcome ever). Dedup moved to friend_request_outbox (contact_id, trigger_id).';
