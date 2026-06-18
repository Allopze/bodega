-- DB-03: audit_log archival / retention function
--
-- Legal requirement (DS N°44/2024, Ley 16.744 Chile):
--   Occupational safety records must be kept for AT LEAST 5 years.
--
-- This function deletes audit_log rows older than `p_keep_years` years.
-- Default is 6 years (adds 1 year buffer above the legal minimum).
--
-- Intended to be run manually by an admin or on a monthly cron:
--   SELECT cleanup_old_audit_log();           -- uses default (6 years)
--   SELECT cleanup_old_audit_log(5);          -- exactly legal minimum
--
-- Returns the number of rows deleted.

CREATE OR REPLACE FUNCTION cleanup_old_audit_log(p_keep_years int DEFAULT 6)
RETURNS bigint
LANGUAGE plpgsql
AS $$
DECLARE
  v_cutoff  timestamptz;
  v_deleted bigint;
BEGIN
  IF p_keep_years < 5 THEN
    RAISE EXCEPTION 'Retention period must be at least 5 years (legal requirement DS N°44/2024)';
  END IF;

  v_cutoff := now() - (p_keep_years * interval '1 year');

  DELETE FROM audit_log
  WHERE created_at < v_cutoff;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

-- DB-02: inventory_movements archival function
--
-- Moves inventory_movements rows older than `p_keep_months` months to an
-- archive table. The archive preserves all columns but is not joined in normal
-- queries. Default is 36 months (3 years).
--
-- Call manually when the kardex queries start to slow down:
--   SELECT archive_old_inventory_movements();

CREATE TABLE IF NOT EXISTS inventory_movements_archive (LIKE inventory_movements INCLUDING ALL);

CREATE OR REPLACE FUNCTION archive_old_inventory_movements(p_keep_months int DEFAULT 36)
RETURNS bigint
LANGUAGE plpgsql
AS $$
DECLARE
  v_cutoff  timestamptz;
  v_archived bigint;
BEGIN
  v_cutoff := now() - (p_keep_months * interval '1 month');

  WITH moved AS (
    DELETE FROM inventory_movements
    WHERE performed_at < v_cutoff
    RETURNING *
  )
  INSERT INTO inventory_movements_archive
  SELECT * FROM moved;

  GET DIAGNOSTICS v_archived = ROW_COUNT;
  RETURN v_archived;
END;
$$;
