-- PRV-13 (auditoría de production readiness 2026-09-28): la bitácora es de
-- sólo agregar. `audit_log` y `pdtp_change_log` aceptaban UPDATE y DELETE del
-- rol de la aplicación, así que su valor probatorio dependía de que nadie tocara
-- la base.
--
-- - UPDATE y DELETE se rechazan salvo dos casos explícitos. (UPDATE incluye el
--   de `audit_log.worksite_id ON DELETE SET NULL`: en producción una faena con
--   bitácora no se borra físicamente, sólo se da de baja, y eso preserva la
--   traza.)
--   * la sesión declara mantenimiento (`app.audit_maintenance = 'on'`). Lo hacen
--     sólo `cleanup_old_audit_log` (retención legal de 6 años, redefinida abajo)
--     y el borrado de un programa PDTP en borrador, que arrastra su changelog
--     por cascada y deja antes un resumen en `audit_log`;
--   * la base es desechable: su nombre lleva `_test`, `_e2e`, `_tmp`, `_temp` o
--     `_capture`, el mismo criterio que exige `assertSafeDestructiveDatabase`
--     para resetear una base de pruebas. Ni producción ni `bodega_dev` lo cumplen.
CREATE OR REPLACE FUNCTION prevent_audit_log_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('app.audit_maintenance', true) = 'on'
    OR current_database() ~* '(^|[_-])(test|e2e|capture|tmp|temp)($|[_-])' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  RAISE EXCEPTION 'La bitácora % es de sólo agregar: no admite %.', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;--> statement-breakpoint
DROP TRIGGER IF EXISTS audit_log_append_only ON audit_log;--> statement-breakpoint
CREATE TRIGGER audit_log_append_only BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION prevent_audit_log_mutation();--> statement-breakpoint
DROP TRIGGER IF EXISTS pdtp_change_log_append_only ON pdtp_change_log;--> statement-breakpoint
CREATE TRIGGER pdtp_change_log_append_only BEFORE UPDATE OR DELETE ON pdtp_change_log
  FOR EACH ROW EXECUTE FUNCTION prevent_audit_log_mutation();--> statement-breakpoint
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
  -- Local a la transacción: la excepción de mantenimiento no sobrevive a esta llamada.
  PERFORM set_config('app.audit_maintenance', 'on', true);
  DELETE FROM audit_log WHERE created_at < v_cutoff;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  PERFORM set_config('app.audit_maintenance', 'off', true);
  RETURN v_deleted;
END;
$$;
