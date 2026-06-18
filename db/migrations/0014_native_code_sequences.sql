-- DB-01: Replace custom code_sequences upsert with a Postgres function backed
-- by native SEQUENCE objects per (prefix, year) combination.
--
-- Trade-off documented (security audit DB-01):
--   PRO  — native SEQUENCE removes row-level contention under high concurrency.
--   CON  — nextval() is non-transactional: if the surrounding transaction rolls
--           back, the sequence value is consumed, producing a gap in document
--           codes (e.g. OC-2026-005 → OC-2026-007 with no OC-2026-006).
--   DECISION — gaps are acceptable for internal OC/solicitud numbering. Chilean
--           tax documents (DTE) are issued by the SII, not this system.
--           The INSERT...ON CONFLICT approach (S-01 fix) is kept in the table
--           as a reference/fallback but the active path is now this function.

-- 1. Create the sequence generator function.
--    CREATE SEQUENCE IF NOT EXISTS is idempotent and safe under concurrency:
--    two simultaneous first-calls for the same (prefix, year) will serialize
--    on the catalog lock; the second call is a no-op.
CREATE OR REPLACE FUNCTION next_document_code(p_prefix text, p_year int)
RETURNS int
LANGUAGE plpgsql
AS $$
DECLARE
  seq_name text := 'code_seq_' || lower(p_prefix) || '_' || p_year::text;
  next_val int;
BEGIN
  EXECUTE format(
    'CREATE SEQUENCE IF NOT EXISTS %I AS int MINVALUE 1 NO CYCLE',
    seq_name
  );
  EXECUTE format('SELECT nextval(%L)', seq_name) INTO next_val;
  RETURN next_val;
END;
$$;

-- 2. Backfill: create a sequence for every existing (prefix, year) row so that
--    the first call after this migration does not restart at 1.
--    next_value holds the last-issued value, so the sequence starts at
--    next_value + 1 (i.e. the next code to issue).
DO $$
DECLARE
  r record;
  seq_name text;
BEGIN
  FOR r IN SELECT prefix, year, next_value FROM code_sequences LOOP
    seq_name := 'code_seq_' || lower(r.prefix) || '_' || r.year::text;
    EXECUTE format(
      'CREATE SEQUENCE IF NOT EXISTS %I AS int MINVALUE 1 START WITH %s NO CYCLE',
      seq_name,
      r.next_value + 1
    );
  END LOOP;
END;
$$;
