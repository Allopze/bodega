-- Evidencia de simulacros, en su propia tabla 1:N (2026-09-19).
--
-- El simulacro guardaba `evidence_path` + checksum en su propia fila, ambos
-- opcionales, y el formulario de cierre nunca los enviaba: la N°84 se
-- acreditaba con el rótulo sintético «Simulacro completado: <id>».
--
-- La evidencia cuelga del simulacro y no de su casilla del programa: un
-- simulacro extraordinario —el que se corre después de un incidente— no tiene
-- casilla y también necesita dejar su acta.
CREATE TABLE "prevention_emergency_drill_evidence" (
	"id" text PRIMARY KEY NOT NULL,
	"drill_id" text NOT NULL,
	"file_name" text NOT NULL,
	"storage_path" text NOT NULL,
	"mime_type" text NOT NULL,
	"file_size_bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"state" text DEFAULT 'active' NOT NULL,
	"uploaded_by_user_id" text,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"annulled_by_user_id" text,
	"annulled_at" timestamp with time zone,
	"annulled_reason" text,
	CONSTRAINT "prevention_emergency_drill_evidence_storage_path_unique" UNIQUE("storage_path"),
	CONSTRAINT "prevention_emergency_drill_evidence_name_check" CHECK (length("prevention_emergency_drill_evidence"."file_name") BETWEEN 1 AND 255),
	CONSTRAINT "prevention_emergency_drill_evidence_size_check" CHECK ("prevention_emergency_drill_evidence"."file_size_bytes" > 0),
	CONSTRAINT "prevention_emergency_drill_evidence_sha_check" CHECK ("prevention_emergency_drill_evidence"."sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "prevention_emergency_drill_evidence_state_check" CHECK ("prevention_emergency_drill_evidence"."state" IN ('active', 'replaced', 'annulled')),
	CONSTRAINT "prevention_emergency_drill_evidence_annul_check" CHECK (("prevention_emergency_drill_evidence"."state" IN ('active', 'replaced') AND "prevention_emergency_drill_evidence"."annulled_at" IS NULL AND "prevention_emergency_drill_evidence"."annulled_by_user_id" IS NULL AND "prevention_emergency_drill_evidence"."annulled_reason" IS NULL) OR ("prevention_emergency_drill_evidence"."state" = 'annulled' AND "prevention_emergency_drill_evidence"."annulled_at" IS NOT NULL AND "prevention_emergency_drill_evidence"."annulled_by_user_id" IS NOT NULL AND length("prevention_emergency_drill_evidence"."annulled_reason") >= 5))
);
--> statement-breakpoint
ALTER TABLE "prevention_emergency_drill_evidence" ADD CONSTRAINT "drill_evidence_drill_fk" FOREIGN KEY ("drill_id") REFERENCES "public"."prevention_emergency_drills"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_emergency_drill_evidence" ADD CONSTRAINT "drill_evidence_uploader_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_emergency_drill_evidence" ADD CONSTRAINT "drill_evidence_annuller_fk" FOREIGN KEY ("annulled_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "prevention_emergency_drill_evidence_drill_idx" ON "prevention_emergency_drill_evidence" USING btree ("drill_id","state","uploaded_at");