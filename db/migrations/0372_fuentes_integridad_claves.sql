-- E1–E7 de la auditoría de combustibles (qa/reports/2026-11-05-auditoria-combustibles-codigo.md).
--
-- Cada índice único NUEVO va precedido por un bloque `DO $$` que aborta la
-- migración con diagnóstico si ya hay duplicados (decisión aprobada: no se
-- deduplica automáticamente). Los `DROP` de objeto llevan `IF EXISTS` para que
-- la migración sea reaplicable en bases que divergieron.
--
-- El cambio de la FK de `fuel_seal_movements.submission_id` a `ON DELETE SET
-- NULL` NO está aquí: el snapshot de Drizzle ya lo declaraba `cascade`, así que
-- el `ALTER` viaja en la migración custom 0373 (mismo cambio, otro archivo,
-- porque `drizzle-kit generate` no emite ese ALTER cuando el drift es entre la
-- base y el snapshot). Ver `db/migrations/0373_fuel_sellos_fk_set_null.sql`.
ALTER TABLE "fuel_provider_period_coverage" DROP CONSTRAINT IF EXISTS "fuel_provider_coverage_status_valid";--> statement-breakpoint
DROP INDEX IF EXISTS "fuel_statements_month_supplier_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "fuel_supply_inputs_reference_unique";--> statement-breakpoint
DROP INDEX IF EXISTS "fuel_cycle_movements_source_unique";--> statement-breakpoint
DROP INDEX IF EXISTS "fuel_seal_movements_submission_type_seal_unique";--> statement-breakpoint
ALTER TABLE "fuel_seal_movements" ALTER COLUMN "submission_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "fuel_cycle_movements" ADD COLUMN "source_plate" text;--> statement-breakpoint
ALTER TABLE "fuel_cycle_movements" ADD COLUMN "source_product" text;--> statement-breakpoint
ALTER TABLE "fuel_seal_movements" ADD COLUMN "reverted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "fuel_seal_movements" ADD COLUMN "reverted_by" text;--> statement-breakpoint
ALTER TABLE "fuel_seal_movements" ADD COLUMN "reverted_reason" text;--> statement-breakpoint
ALTER TABLE "fuel_seal_movements" ADD CONSTRAINT "fuel_seal_movements_reverted_by_users_id_fk" FOREIGN KEY ("reverted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- E1 · pre-check de `fuel_supply_inputs_dispatch_unique`.
DO $$
DECLARE
  grupos  integer;
  filas   integer;
  ejemplo record;
BEGIN
  SELECT count(*), coalesce(sum(n), 0)
    INTO grupos, filas
  FROM (
    SELECT count(*) AS n
    FROM fuel_supply_inputs
    GROUP BY supply_medium_id, reference, worksite_id, month
    HAVING count(*) > 1
  ) duplicados;

  IF grupos > 0 THEN
    SELECT supply_medium_id AS medio, reference AS folio, worksite_id AS faena, month AS mes
      INTO ejemplo
    FROM fuel_supply_inputs
    GROUP BY supply_medium_id, reference, worksite_id, month
    HAVING count(*) > 1
    LIMIT 1;

    RAISE EXCEPTION 'E1: % llaves de despacho duplicadas (% filas) impiden crear fuel_supply_inputs_dispatch_unique. Ejemplo: medio %, folio %, faena %, mes %. Resuelve los duplicados a mano: esta migracion no deduplica automaticamente.', grupos, filas, ejemplo.medio, ejemplo.folio, ejemplo.faena, ejemplo.mes;
  END IF;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX "fuel_supply_inputs_dispatch_unique" ON "fuel_supply_inputs" USING btree ("supply_medium_id","reference","worksite_id","month");--> statement-breakpoint
-- E2 · pre-check de `fuel_operation_records_identity_unique`.
DO $$
DECLARE
  grupos  integer;
  filas   integer;
  ejemplo record;
BEGIN
  SELECT count(*), coalesce(sum(n), 0)
    INTO grupos, filas
  FROM (
    SELECT count(*) AS n
    FROM fuel_operation_records
    GROUP BY coalesce(worksite_id, ''), plate, fecha, coalesce(hora_carga, ''), liters, coalesce(horometro, 0)
    HAVING count(*) > 1
  ) duplicados;

  IF grupos > 0 THEN
    SELECT coalesce(worksite_id, '') AS faena, plate AS patente, fecha, coalesce(hora_carga, '') AS hora,
           liters, coalesce(horometro, 0) AS horometro
      INTO ejemplo
    FROM fuel_operation_records
    GROUP BY coalesce(worksite_id, ''), plate, fecha, coalesce(hora_carga, ''), liters, coalesce(horometro, 0)
    HAVING count(*) > 1
    LIMIT 1;

    RAISE EXCEPTION 'E2: % cargas operacionales duplicadas (% filas) impiden crear fuel_operation_records_identity_unique. Ejemplo: faena "%", patente %, fecha % %, % L, horometro %. Resuelve los duplicados a mano: esta migracion no deduplica automaticamente.', grupos, filas, ejemplo.faena, ejemplo.patente, ejemplo.fecha, ejemplo.hora, ejemplo.liters, ejemplo.horometro;
  END IF;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX "fuel_operation_records_identity_unique" ON "fuel_operation_records" USING btree (coalesce("worksite_id", ''),"plate","fecha",coalesce("hora_carga", ''),"liters",coalesce("horometro", 0));--> statement-breakpoint
-- E3 · pre-check de `fuel_reconciliation_links_open_unique`.
DO $$
DECLARE
  grupos  integer;
  filas   integer;
  ejemplo record;
BEGIN
  SELECT count(*), coalesce(sum(n), 0)
    INTO grupos, filas
  FROM (
    SELECT count(*) AS n
    FROM fuel_reconciliation_links
    WHERE status IN ('unmatched', 'ambiguous')
    GROUP BY provider_transaction_id, link_type
    HAVING count(*) > 1
  ) duplicados;

  IF grupos > 0 THEN
    SELECT provider_transaction_id AS transaccion, link_type AS vinculo, min(status) AS estado
      INTO ejemplo
    FROM fuel_reconciliation_links
    WHERE status IN ('unmatched', 'ambiguous')
    GROUP BY provider_transaction_id, link_type
    HAVING count(*) > 1
    LIMIT 1;

    RAISE EXCEPTION 'E3: % vinculos abiertos duplicados (% filas) impiden crear fuel_reconciliation_links_open_unique. Ejemplo: transaccion %, vinculo %, estado % (una fila por transaccion y tipo mientras no se resuelva). Resuelve los duplicados a mano: esta migracion no deduplica automaticamente.', grupos, filas, ejemplo.transaccion, ejemplo.vinculo, ejemplo.estado;
  END IF;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX "fuel_reconciliation_links_open_unique" ON "fuel_reconciliation_links" USING btree ("provider_transaction_id","link_type") WHERE "fuel_reconciliation_links"."status" IN ('unmatched', 'ambiguous');--> statement-breakpoint
-- E4 · pre-check de `fuel_seal_movements_submission_type_seal_unique` (parcial).
DO $$
DECLARE
  grupos  integer;
  filas   integer;
  ejemplo record;
BEGIN
  SELECT count(*), coalesce(sum(n), 0)
    INTO grupos, filas
  FROM (
    SELECT count(*) AS n
    FROM fuel_seal_movements
    WHERE submission_id IS NOT NULL
    GROUP BY submission_id, movement_type, seal_number
    HAVING count(*) > 1
  ) duplicados;

  IF grupos > 0 THEN
    SELECT submission_id AS envio, movement_type AS tipo, seal_number AS sello
      INTO ejemplo
    FROM fuel_seal_movements
    WHERE submission_id IS NOT NULL
    GROUP BY submission_id, movement_type, seal_number
    HAVING count(*) > 1
    LIMIT 1;

    RAISE EXCEPTION 'E4: % movimientos de sello duplicados (% filas) impiden crear fuel_seal_movements_submission_type_seal_unique. Ejemplo: envio %, tipo %, sello %. Resuelve los duplicados a mano: esta migracion no deduplica automaticamente.', grupos, filas, ejemplo.envio, ejemplo.tipo, ejemplo.sello;
  END IF;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX "fuel_seal_movements_submission_type_seal_unique" ON "fuel_seal_movements" USING btree ("submission_id","movement_type","seal_number") WHERE "fuel_seal_movements"."submission_id" IS NOT NULL;--> statement-breakpoint
-- E5 · pre-check de `fuel_cycle_movements_copec_tae_source_unique`.
DO $$
DECLARE
  grupos  integer;
  filas   integer;
  ejemplo record;
BEGIN
  SELECT count(*), coalesce(sum(n), 0)
    INTO grupos, filas
  FROM (
    SELECT count(*) AS n
    FROM fuel_cycle_movements
    WHERE source_type = 'copec_tae'
    GROUP BY source_type, source_id, source_plate, source_product
    HAVING count(*) > 1
  ) duplicados;

  IF grupos > 0 THEN
    SELECT source_id AS guia, coalesce(source_plate, '') AS patente, coalesce(source_product, '') AS producto
      INTO ejemplo
    FROM fuel_cycle_movements
    WHERE source_type = 'copec_tae'
    GROUP BY source_type, source_id, source_plate, source_product
    HAVING count(*) > 1
    LIMIT 1;

    RAISE EXCEPTION 'E5: % recepciones Copec TAE duplicadas (% filas) impiden crear fuel_cycle_movements_copec_tae_source_unique. Ejemplo: guia %, patente "%", producto "%". Resuelve los duplicados a mano: esta migracion no deduplica automaticamente.', grupos, filas, ejemplo.guia, ejemplo.patente, ejemplo.producto;
  END IF;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX "fuel_cycle_movements_copec_tae_source_unique" ON "fuel_cycle_movements" USING btree ("source_type","source_id","source_plate","source_product") WHERE "fuel_cycle_movements"."source_type" = 'copec_tae';--> statement-breakpoint
-- E5 · pre-check de `fuel_cycle_movements_source_unique` (recreado sin Copec TAE:
-- es una relajación del índice anterior, así que debe pasar siempre).
DO $$
DECLARE
  grupos  integer;
  filas   integer;
  ejemplo record;
BEGIN
  SELECT count(*), coalesce(sum(n), 0)
    INTO grupos, filas
  FROM (
    SELECT count(*) AS n
    FROM fuel_cycle_movements
    WHERE source_id IS NOT NULL AND source_type IS DISTINCT FROM 'copec_tae'
    GROUP BY source_type, source_id
    HAVING count(*) > 1
  ) duplicados;

  IF grupos > 0 THEN
    SELECT coalesce(source_type, '') AS fuente, source_id AS guia
      INTO ejemplo
    FROM fuel_cycle_movements
    WHERE source_id IS NOT NULL AND source_type IS DISTINCT FROM 'copec_tae'
    GROUP BY source_type, source_id
    HAVING count(*) > 1
    LIMIT 1;

    RAISE EXCEPTION 'E5: % referencias externas duplicadas (% filas) impiden recrear fuel_cycle_movements_source_unique. Ejemplo: fuente "%", guia %. Resuelve los duplicados a mano: esta migracion no deduplica automaticamente.', grupos, filas, ejemplo.fuente, ejemplo.guia;
  END IF;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX "fuel_cycle_movements_source_unique" ON "fuel_cycle_movements" USING btree ("source_type","source_id") WHERE "fuel_cycle_movements"."source_id" IS NOT NULL AND "fuel_cycle_movements"."source_type" IS DISTINCT FROM 'copec_tae';--> statement-breakpoint
-- E7 · pre-check de `fuel_statements_month_supplier_unique`.
DO $$
DECLARE
  grupos  integer;
  filas   integer;
  ejemplo record;
BEGIN
  SELECT count(*), coalesce(sum(n), 0)
    INTO grupos, filas
  FROM (
    SELECT count(*) AS n
    FROM fuel_monthly_statements
    GROUP BY month, fuel_supplier_id
    HAVING count(*) > 1
  ) duplicados;

  IF grupos > 0 THEN
    SELECT month AS mes, fuel_supplier_id AS proveedor
      INTO ejemplo
    FROM fuel_monthly_statements
    GROUP BY month, fuel_supplier_id
    HAVING count(*) > 1
    LIMIT 1;

    RAISE EXCEPTION 'E7: % cuentas corrientes duplicadas por mes y proveedor (% filas) impiden crear fuel_statements_month_supplier_unique. Ejemplo: mes %, proveedor %. Resuelve los duplicados a mano: esta migracion no deduplica automaticamente.', grupos, filas, ejemplo.mes, ejemplo.proveedor;
  END IF;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX "fuel_statements_month_supplier_unique" ON "fuel_monthly_statements" USING btree ("month","fuel_supplier_id");--> statement-breakpoint
-- E7 · pre-check de la FK `fuel_loads.statement_id` (ids huérfanos).
DO $$
DECLARE
  huerfanas integer;
  ejemplo   record;
BEGIN
  SELECT count(*)
    INTO huerfanas
  FROM fuel_loads l
  WHERE l.statement_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM fuel_monthly_statements s WHERE s.id = l.statement_id);

  IF huerfanas > 0 THEN
    SELECT l.id AS carga, l.statement_id AS cuenta
      INTO ejemplo
    FROM fuel_loads l
    WHERE l.statement_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM fuel_monthly_statements s WHERE s.id = l.statement_id)
    LIMIT 1;

    RAISE EXCEPTION 'E7: % cargas apuntan a una cuenta corriente inexistente e impiden crear la FK fuel_loads_statement_id_fuel_monthly_statements_id_fk. Ejemplo: carga %, statement_id %. Corrige los ids huerfanos a mano antes de aplicar la migracion.', huerfanas, ejemplo.carga, ejemplo.cuenta;
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "fuel_loads" ADD CONSTRAINT "fuel_loads_statement_id_fuel_monthly_statements_id_fk" FOREIGN KEY ("statement_id") REFERENCES "public"."fuel_monthly_statements"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fuel_seal_movements_reverted_by_idx" ON "fuel_seal_movements" USING btree ("reverted_by");--> statement-breakpoint
CREATE INDEX "fuel_tae_submissions_driver_idx" ON "fuel_tae_submissions" USING btree ("driver_worker_id");--> statement-breakpoint
CREATE INDEX "fuel_tae_submissions_supervisor_idx" ON "fuel_tae_submissions" USING btree ("supervisor_worker_id");--> statement-breakpoint
CREATE INDEX "fuel_provider_event_revisions_file_idx" ON "fuel_provider_event_revisions" USING btree ("source_file_id");--> statement-breakpoint
CREATE INDEX "fuel_provider_transactions_storage_location_idx" ON "fuel_provider_transactions" USING btree ("storage_location_id");--> statement-breakpoint
CREATE INDEX "fuel_reconciliation_links_fuel_load_idx" ON "fuel_reconciliation_links" USING btree ("fuel_load_id");--> statement-breakpoint
CREATE INDEX "fuel_reconciliation_links_cycle_movement_idx" ON "fuel_reconciliation_links" USING btree ("cycle_movement_id");--> statement-breakpoint
-- E6 · estado `closed_with_issues` (un mes con filas inválidas deja de ser
-- `failed` para siempre). La constante `TERMINAL_STATUSES` la ajusta el carril C.
ALTER TABLE "fuel_provider_period_coverage" ADD CONSTRAINT "fuel_provider_coverage_status_valid" CHECK ("fuel_provider_period_coverage"."status" IN ('unknown', 'incomplete', 'failed', 'complete', 'legitimate_empty', 'closed_with_issues'));
