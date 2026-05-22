-- ════════════════════════════════════════════════════════════════════════
-- Phase Riêng Tư 2026-05-22 (anh chốt A2 + edge cases Q1-Q6)
-- Reference: ~/.gstack/projects/zalocrm/thanh-private-mode-design-20260521.md
-- ════════════════════════════════════════════════════════════════════════

-- 1. USER PIN fields
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "privacy_pin_hash"      TEXT,
  ADD COLUMN IF NOT EXISTS "privacy_failed_count"  INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "privacy_locked_until"  TIMESTAMP(3);

-- 2. ZALO_ACCOUNTS privacy_mode
ALTER TABLE "zalo_accounts"
  ADD COLUMN IF NOT EXISTS "privacy_mode" TEXT NOT NULL DEFAULT 'sub';
ALTER TABLE "zalo_accounts"
  ADD CONSTRAINT "chk_zalo_privacy_mode" CHECK ("privacy_mode" IN ('main', 'sub'));

-- 3. USER_PRIVACY_SESSIONS — 1 PIN unlock all main nicks của user
CREATE TABLE "user_privacy_sessions" (
  "id"               TEXT NOT NULL PRIMARY KEY,
  "user_id"          TEXT NOT NULL,
  "session_token"    TEXT NOT NULL UNIQUE,
  "unlocked_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at"       TIMESTAMP(3) NOT NULL,
  "last_activity_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "ip_hash"          TEXT,
  "user_agent"       TEXT,
  "revoked_at"       TIMESTAMP(3),

  CONSTRAINT "user_privacy_sessions_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "user_privacy_sessions_session_token_idx" ON "user_privacy_sessions"("session_token");
CREATE INDEX "user_privacy_sessions_user_id_expires_at_idx" ON "user_privacy_sessions"("user_id", "expires_at");
-- Index hot path: middleware lookup token + active (not revoked)
CREATE INDEX "user_privacy_sessions_active_idx" ON "user_privacy_sessions"("session_token", "expires_at")
  WHERE "revoked_at" IS NULL;
