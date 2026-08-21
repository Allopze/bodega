ALTER TABLE "prevention_capa_evidence" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "prevention_capa_evidence" ADD COLUMN "superseded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "prevention_capa_evidence" ADD COLUMN "superseded_by_user_id" text;--> statement-breakpoint
ALTER TABLE "prevention_capa_evidence" ADD COLUMN "supersession_reason" text;--> statement-breakpoint
ALTER TABLE "prevention_capa_evidence" ADD CONSTRAINT "prevention_capa_evidence_superseded_by_user_id_users_id_fk" FOREIGN KEY ("superseded_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
WITH ranked AS (
  SELECT
    "id",
    row_number() OVER (
      PARTITION BY "action_id", "reference"
      ORDER BY "created_at" DESC, "id" DESC
    ) AS duplicate_rank
  FROM "prevention_capa_evidence"
)
UPDATE "prevention_capa_evidence" AS evidence
SET
  "reference" = evidence."reference" || ':superseded-duplicate:' || evidence."id",
  "status" = 'superseded',
  "superseded_at" = evidence."created_at",
  "superseded_by_user_id" = evidence."uploaded_by_user_id",
  "supersession_reason" = 'Evidencia duplicada histórica conciliada al activar la unicidad.'
FROM ranked
WHERE ranked."id" = evidence."id"
  AND ranked.duplicate_rank > 1;--> statement-breakpoint
UPDATE "prevention_capa_evidence" AS evidence
SET
  "kind" = 'document',
  "description" = 'Evidencia automática de la mantención ' || maintenance."maintenance_type" || ' programada para el ' || maintenance."maintenance_date" || '.',
  "checksum_sha256" = NULL,
  "status" = CASE WHEN maintenance."status" = 'completed' THEN 'active' ELSE 'superseded' END,
  "superseded_at" = CASE WHEN maintenance."status" = 'completed' THEN NULL ELSE evidence."created_at" END,
  "superseded_by_user_id" = CASE WHEN maintenance."status" = 'completed' THEN NULL ELSE evidence."uploaded_by_user_id" END,
  "supersession_reason" = CASE
    WHEN maintenance."status" = 'completed' THEN NULL
    ELSE 'La mantención histórica asociada no se encuentra completada.'
  END
FROM "maintenance_records" AS maintenance
JOIN "prevention_inspection_findings" AS finding
  ON finding."id" = maintenance."inspection_finding_id"
WHERE evidence."reference" = 'mantencion:' || maintenance."id"
  AND evidence."action_id" = finding."capa_action_id";--> statement-breakpoint
CREATE UNIQUE INDEX "prevention_capa_evidence_action_reference_unique" ON "prevention_capa_evidence" USING btree ("action_id","reference");--> statement-breakpoint
ALTER TABLE "prevention_capa_evidence" ADD CONSTRAINT "prevention_capa_evidence_status_valid" CHECK ("prevention_capa_evidence"."status" IN ('active', 'superseded'));--> statement-breakpoint
ALTER TABLE "prevention_capa_evidence" ADD CONSTRAINT "prevention_capa_evidence_supersession_consistent" CHECK (
    ("prevention_capa_evidence"."status" = 'active' AND "prevention_capa_evidence"."superseded_at" IS NULL AND "prevention_capa_evidence"."superseded_by_user_id" IS NULL AND "prevention_capa_evidence"."supersession_reason" IS NULL)
    OR
    ("prevention_capa_evidence"."status" = 'superseded' AND "prevention_capa_evidence"."superseded_at" IS NOT NULL AND "prevention_capa_evidence"."superseded_by_user_id" IS NOT NULL AND length("prevention_capa_evidence"."supersession_reason") >= 5)
  );
