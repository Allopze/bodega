-- TRZ-002 (auditoría 2026-09-14): un caso de trazabilidad se cerraba por
-- declaración y el índice único por caso lo dejaba cerrado para siempre. Si el
-- descuadre persistía o reaparecía, el escaneo no lo recreaba (finding_key es
-- único) ni podía volver a regularizarse. Se numera el ciclo del caso: cada
-- vez que el detector vuelve a encontrar un caso ya regularizado, la ocurrencia
-- avanza y el caso queda otra vez pendiente, sin reescribir la historia.
ALTER TABLE "traceability_integrity_cases"
  ADD COLUMN IF NOT EXISTS "occurrence" integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE "traceability_integrity_cases"
  ADD COLUMN IF NOT EXISTS "last_detected_at" timestamp with time zone NOT NULL DEFAULT now();
--> statement-breakpoint
UPDATE "traceability_integrity_cases" SET "last_detected_at" = "detected_at";
--> statement-breakpoint
ALTER TABLE "traceability_integrity_cases"
  ADD CONSTRAINT "traceability_integrity_case_occurrence_positive" CHECK ("occurrence" >= 1);
--> statement-breakpoint
ALTER TABLE "traceability_integrity_resolutions"
  ADD COLUMN IF NOT EXISTS "occurrence" integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE "traceability_integrity_resolutions"
  ADD CONSTRAINT "traceability_integrity_resolution_occurrence_positive" CHECK ("occurrence" >= 1);
--> statement-breakpoint
DROP INDEX IF EXISTS "traceability_integrity_resolutions_case_unique";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "traceability_integrity_resolutions_case_occurrence_unique"
  ON "traceability_integrity_resolutions" ("case_id","occurrence");
