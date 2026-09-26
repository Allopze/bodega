ALTER TABLE "pdtp_activities" ADD COLUMN "manual_evidence_policy" text DEFAULT 'file_required' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "pdtp_programs_one_active_per_year_unique" ON "pdtp_programs" USING btree ("year") WHERE "pdtp_programs"."status" = 'active';--> statement-breakpoint
ALTER TABLE "pdtp_activities" ADD CONSTRAINT "pdtp_activities_manual_evidence_policy_check" CHECK ("pdtp_activities"."manual_evidence_policy" IN ('file_required', 'declaration_allowed'));--> statement-breakpoint
-- PREV-B02 (auditoría 2026-09-26): excepción explícita a "archivo obligatorio".
-- Las 19 actividades del catálogo 2026 cuyo respaldo vive fuera de la
-- plataforma (expediente físico del RE-20 N°66-78 y las de ingreso/comité
-- N°11, 15, 16, 18, 52, 57; ver scripts/apply-pdtp-2026-demand-slas.ts) se
-- registran a mano con una observación escrita. Idempotente.
UPDATE "pdtp_activities" a
SET "manual_evidence_policy" = 'declaration_allowed'
FROM "pdtp_programs" p
WHERE p."id" = a."program_id"
  AND p."year" = 2026
  AND a."n" IN (11, 15, 16, 18, 52, 57, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78)
  AND a."manual_evidence_policy" <> 'declaration_allowed';
