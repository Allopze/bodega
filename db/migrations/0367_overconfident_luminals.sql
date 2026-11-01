ALTER TABLE "fuel_meter_readings" DROP CONSTRAINT IF EXISTS "fuel_meter_readings_source_valid";--> statement-breakpoint
ALTER TABLE "fuel_provider_files" DROP CONSTRAINT IF EXISTS "fuel_provider_files_provider_valid";--> statement-breakpoint
ALTER TABLE "fuel_provider_mappings" DROP CONSTRAINT IF EXISTS "fuel_provider_mappings_provider_valid";--> statement-breakpoint
ALTER TABLE "fuel_provider_period_coverage" DROP CONSTRAINT IF EXISTS "fuel_provider_coverage_provider_valid";--> statement-breakpoint
ALTER TABLE "fuel_provider_rejections" DROP CONSTRAINT IF EXISTS "fuel_provider_rejections_provider_valid";--> statement-breakpoint
ALTER TABLE "fuel_provider_sync_runs" DROP CONSTRAINT IF EXISTS "fuel_provider_sync_runs_provider_valid";--> statement-breakpoint
ALTER TABLE "fuel_provider_transactions" DROP CONSTRAINT IF EXISTS "fuel_provider_transactions_provider_valid";--> statement-breakpoint
ALTER TABLE "fuel_meter_readings" ADD CONSTRAINT "fuel_meter_readings_source_valid" CHECK ("fuel_meter_readings"."source" IN ('copec_tct', 'gps_onway'));--> statement-breakpoint
ALTER TABLE "fuel_provider_files" ADD CONSTRAINT "fuel_provider_files_provider_valid" CHECK ("fuel_provider_files"."provider" IN ('copec'));--> statement-breakpoint
ALTER TABLE "fuel_provider_mappings" ADD CONSTRAINT "fuel_provider_mappings_provider_valid" CHECK ("fuel_provider_mappings"."provider" IN ('copec'));--> statement-breakpoint
ALTER TABLE "fuel_provider_period_coverage" ADD CONSTRAINT "fuel_provider_coverage_provider_valid" CHECK ("fuel_provider_period_coverage"."provider" IN ('copec'));--> statement-breakpoint
ALTER TABLE "fuel_provider_rejections" ADD CONSTRAINT "fuel_provider_rejections_provider_valid" CHECK ("fuel_provider_rejections"."provider" IN ('copec'));--> statement-breakpoint
ALTER TABLE "fuel_provider_sync_runs" ADD CONSTRAINT "fuel_provider_sync_runs_provider_valid" CHECK ("fuel_provider_sync_runs"."provider" IN ('copec'));--> statement-breakpoint
ALTER TABLE "fuel_provider_transactions" ADD CONSTRAINT "fuel_provider_transactions_provider_valid" CHECK ("fuel_provider_transactions"."provider" IN ('copec'));--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM fuel_supply_media m
    WHERE m.provider_code = 'aramco' AND (
      m.id <> 'fsm-aramco'
      OR EXISTS (SELECT 1 FROM fuel_supply_inputs i WHERE i.supply_medium_id = m.id)
      OR EXISTS (SELECT 1 FROM fuel_equipment_loads l WHERE l.supply_medium_id = m.id)
      OR EXISTS (SELECT 1 FROM fuel_tae_submissions s WHERE s.supply_medium_id = m.id)
      OR EXISTS (SELECT 1 FROM fuel_anomaly_cases a WHERE a.reference_entity_id = m.id)
      OR EXISTS (SELECT 1 FROM fuel_review_marks r WHERE r.entity_id = m.id)
    )
  ) THEN
    RAISE EXCEPTION 'El medio Aramco tiene dependencias; ejecutar inventario y limpieza antes de migrar';
  END IF;
  IF EXISTS (SELECT 1 FROM fuel_supply_media WHERE id = 'fsm-aramco' AND provider_code = 'aramco') THEN
    -- Existing deployments have users: require the operator-audited cleanup.
    IF EXISTS (SELECT 1 FROM users) THEN
      RAISE EXCEPTION 'Ejecutar limpieza auditada de Aramco antes de migrar';
    END IF;
    INSERT INTO audit_log (id, action, entity_type, entity_id, old_state, new_state, reason)
      VALUES ('migration-0367-fsm-aramco', 'delete', 'fuel_provider_retirement', 'fsm-aramco',
        '{"providerCode":"aramco"}', '{"source":"fresh-install-migration-0367"}',
        'Retiro del medio sembrado en una instalación nueva') ON CONFLICT (id) DO NOTHING;
    DELETE FROM fuel_supply_media WHERE id = 'fsm-aramco' AND provider_code = 'aramco';
  END IF;
END $$;
