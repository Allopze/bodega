-- Retiro del módulo antiguo «Mantenciones» (/mantenciones, tablas maintenance_*).
-- Lo reemplaza la orden de trabajo del módulo de mantención de equipos
-- (/mantencion, tablas mant_*). Decisión del usuario, 2026-11-02.
--
-- Verificado en producción con una lectura READ ONLY el 2026-11-02: las siete
-- tablas tenían CERO filas, y también eran cero las referencias que podrían
-- quedar colgando (movimientos de kardex 'egreso_mantencion', reglas y alertas
-- GPS con destino 'maintenance', evidencia CAPA 'mantencion:%', intervalos
-- operacionales abiertos por OT y notificaciones maintenance_*). Ninguna otra
-- tabla tiene una clave foránea hacia estas. Como red de seguridad,
-- scripts/migration-preflight.mjs (LEGACY_ACTION_TABLES) impide migrar si
-- alguna de ellas llegara a tener filas.
--
-- Las restricciones de inventory_movements y fleet_gps_* se acotan a los
-- valores vigentes, y se borran los ajustes del interruptor del módulo
-- retirado. Los permisos mantenciones:* los retira db:sync-rbac
-- (RETIRED_PERMISSION_NAMES), no esta migración.
DROP TABLE IF EXISTS "maintenance_document_policies" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "maintenance_documents" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "maintenance_labor" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "maintenance_parts" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "maintenance_tasks" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "maintenance_records" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "maintenance_plans" CASCADE;--> statement-breakpoint
ALTER TABLE "inventory_movements" DROP CONSTRAINT IF EXISTS "inventory_movements_type_valid";--> statement-breakpoint
ALTER TABLE "fleet_gps_alert_rules" DROP CONSTRAINT IF EXISTS "fleet_gps_alert_rules_destination_valid";--> statement-breakpoint
ALTER TABLE "fleet_gps_alerts" DROP CONSTRAINT IF EXISTS "fleet_gps_alerts_link_valid";--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_type_valid" CHECK (
    "inventory_movements"."type" IN ('ingreso_oc', 'egreso_entrega', 'ingreso_devolucion', 'egreso_desecho', 'retiro_epp_trabajador', 'ajuste', 'egreso_traslado', 'ingreso_traslado', 'ingreso_anulacion', 'egreso_anulacion')
  );--> statement-breakpoint
ALTER TABLE "fleet_gps_alert_rules" ADD CONSTRAINT "fleet_gps_alert_rules_destination_valid" CHECK ("fleet_gps_alert_rules"."destination" IN ('none', 'capa'));--> statement-breakpoint
ALTER TABLE "fleet_gps_alerts" ADD CONSTRAINT "fleet_gps_alerts_link_valid" CHECK (("fleet_gps_alerts"."linked_entity_type" IS NULL AND "fleet_gps_alerts"."linked_entity_id" IS NULL) OR ("fleet_gps_alerts"."linked_entity_type" = 'capa' AND "fleet_gps_alerts"."linked_entity_id" IS NOT NULL));--> statement-breakpoint
DELETE FROM "system_settings"
WHERE "key" = 'module.enabled:mantenciones'
   OR "key" LIKE 'submodule.enabled:mantenciones:%';
