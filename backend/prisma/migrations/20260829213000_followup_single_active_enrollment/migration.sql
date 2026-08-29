-- Keep the newest active enrollment when repairing legacy duplicates.
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY org_id, contact_id
           ORDER BY created_at DESC, id DESC
         ) AS row_number
  FROM followup_enrollments
  WHERE status IN ('running', 'waiting', 'waiting_sale')
)
UPDATE followup_enrollments AS enrollment
SET status = 'stopped',
    stop_reason = 'duplicate_repaired',
    completed_at = NOW(),
    next_run_at = NULL,
    job_id = NULL
FROM ranked
WHERE enrollment.id = ranked.id
  AND ranked.row_number > 1;

CREATE UNIQUE INDEX IF NOT EXISTS followup_enrollments_one_active_per_contact
  ON followup_enrollments (org_id, contact_id)
  WHERE status IN ('running', 'waiting', 'waiting_sale');
