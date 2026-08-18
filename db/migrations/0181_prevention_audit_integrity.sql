-- Auditoría de Prevención 2026-08-17
--   SST-09  el unique de carpetas no aplicaba a las raíces (`parent_id IS NULL`)
--   DATA-04 un lote de importación podía generar dos matrices MIPER
--   DATA-05 la cadena de supersesión MIPER no tenía integridad referencial
--
-- Escrita a mano y no con `drizzle-kit generate` a propósito: hay otra sesión
-- editando el árbol y `generate` migra el esquema entero, no sólo estos cambios.
-- Los bloques DO abortan con un mensaje accionable si los datos existentes no
-- admiten la restricción, en vez de fallar con un error opaco de Postgres.

DO $$
DECLARE dup int;
BEGIN
  SELECT count(*) INTO dup FROM (
    SELECT slug FROM sst_document_folders WHERE parent_id IS NULL GROUP BY slug HAVING count(*) > 1
  ) d;
  IF dup > 0 THEN
    RAISE EXCEPTION 'SST-09: hay % slug(s) de carpeta raiz duplicados en sst_document_folders. Fusiona sus documentos antes de migrar.', dup;
  END IF;
END $$;--> statement-breakpoint

DROP INDEX IF EXISTS "sst_document_folders_parent_slug_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "sst_document_folders_parent_slug_unique" ON "sst_document_folders" USING btree ("parent_id","slug") NULLS NOT DISTINCT;--> statement-breakpoint

DO $$
DECLARE dup int;
BEGIN
  SELECT count(*) INTO dup FROM (
    SELECT source_import_batch_id FROM prevention_risk_matrices
    WHERE source_import_batch_id IS NOT NULL
    GROUP BY source_import_batch_id HAVING count(*) > 1
  ) d;
  IF dup > 0 THEN
    RAISE EXCEPTION 'DATA-04: hay % lote(s) de importacion MIPER con mas de una matriz. Resuelve el duplicado antes de migrar.', dup;
  END IF;
END $$;--> statement-breakpoint

CREATE UNIQUE INDEX "prevention_risk_matrices_source_batch_unique" ON "prevention_risk_matrices" USING btree ("source_import_batch_id") WHERE "prevention_risk_matrices"."source_import_batch_id" IS NOT NULL;--> statement-breakpoint

-- Punteros colgantes: apuntan a filas que ya no existen, asi que no cargan
-- informacion. Se anulan para poder imponer la FK; lo que existe no se toca.
UPDATE "prevention_risk_matrices" m SET "source_import_batch_id" = NULL
WHERE m."source_import_batch_id" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "prevention_risk_import_batches" b WHERE b."id" = m."source_import_batch_id");--> statement-breakpoint

UPDATE "prevention_risk_matrices" m SET "supersedes_matrix_id" = NULL
WHERE m."supersedes_matrix_id" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "prevention_risk_matrices" x WHERE x."id" = m."supersedes_matrix_id");--> statement-breakpoint

ALTER TABLE "prevention_risk_matrices" ADD CONSTRAINT "prevention_risk_matrices_source_import_batch_id_prevention_risk_import_batches_id_fk" FOREIGN KEY ("source_import_batch_id") REFERENCES "public"."prevention_risk_import_batches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_risk_matrices" ADD CONSTRAINT "prevention_risk_matrices_supersedes_matrix_id_prevention_risk_matrices_id_fk" FOREIGN KEY ("supersedes_matrix_id") REFERENCES "public"."prevention_risk_matrices"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint

-- OFF-01: el PPA no tenia ninguna fecha propia; toda su temporalidad era el
-- `created_at` del servidor, asi que un envio encolado offline se archivaba con
-- la fecha de sincronizacion. Nullable: los envios en linea y los clientes
-- viejos no lo mandan.
ALTER TABLE "ppa_submissions" ADD COLUMN IF NOT EXISTS "filled_at" timestamp with time zone;
