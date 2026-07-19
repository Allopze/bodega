-- Guarda de seguridad previa a una migración destructiva.
-- Retira la importación desde SFTI: elimina el staging y la procedencia.
-- Si alguna base ya activó incidentes importados, esta migración debe fallar
-- en vez de borrar esa trazabilidad en silencio. La comprobación es de sólo
-- lectura y tolera que las estructuras ya no existan.
DO $$
DECLARE
  v_incidents integer := 0;
  v_batches   integer := 0;
  v_rows      integer := 0;
BEGIN
  IF to_regclass('public.prevention_incidents') IS NOT NULL THEN
    EXECUTE $q$
      SELECT count(*) FROM prevention_incidents
      WHERE sfti_external_id IS NOT NULL
         OR import_row_id IS NOT NULL
         OR source = 'sfti_import'
    $q$ INTO v_incidents;
  END IF;

  IF to_regclass('public.prevention_incident_import_batches') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM prevention_incident_import_batches' INTO v_batches;
  END IF;

  IF to_regclass('public.prevention_incident_import_rows') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM prevention_incident_import_rows' INTO v_rows;
  END IF;

  IF v_incidents > 0 OR v_batches > 0 OR v_rows > 0 THEN
    RAISE EXCEPTION USING
      MESSAGE = format(
        'Migracion 0081 abortada: %s incidente(s) con procedencia SFTI, %s lote(s) y %s fila(s) de staging.',
        v_incidents, v_batches, v_rows),
      HINT = 'Concilia o archiva esa trazabilidad antes de retirar la importacion SFTI. La migracion no debe borrarla.';
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "prevention_incident_import_batches" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "prevention_incident_import_rows" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "prevention_incident_import_batches" CASCADE;--> statement-breakpoint
DROP TABLE "prevention_incident_import_rows" CASCADE;--> statement-breakpoint
ALTER TABLE "prevention_incidents" DROP CONSTRAINT "prevention_incident_source_valid";--> statement-breakpoint
DROP INDEX "prevention_incidents_sfti_external_unique";--> statement-breakpoint
DROP INDEX "prevention_incidents_import_row_unique";--> statement-breakpoint
ALTER TABLE "prevention_incidents" DROP COLUMN "sfti_external_id";--> statement-breakpoint
ALTER TABLE "prevention_incidents" DROP COLUMN "import_row_id";--> statement-breakpoint
ALTER TABLE "prevention_incidents" ADD CONSTRAINT "prevention_incident_source_valid" CHECK ("prevention_incidents"."source" IN ('platform', 'offline_sync'));
