CREATE TABLE "prevention_inspection_finding_evidence" (
	"id" text PRIMARY KEY NOT NULL,
	"finding_id" text NOT NULL,
	"path" text NOT NULL,
	"file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"file_size" integer NOT NULL,
	"checksum_sha256" text NOT NULL,
	"caption" text,
	"uploaded_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prevention_inspection_finding_evidence_size_valid" CHECK ("prevention_inspection_finding_evidence"."file_size" > 0),
	CONSTRAINT "prevention_inspection_finding_evidence_checksum_valid" CHECK (length("prevention_inspection_finding_evidence"."checksum_sha256") = 64)
);
--> statement-breakpoint
CREATE TABLE "prevention_inspection_import_batches" (
	"id" text PRIMARY KEY NOT NULL,
	"source_kind" text NOT NULL,
	"source_file_name" text NOT NULL,
	"source_checksum_sha256" text NOT NULL,
	"status" text DEFAULT 'staged' NOT NULL,
	"summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"applied_at" timestamp with time zone,
	CONSTRAINT "prevention_inspection_import_batch_kind_valid" CHECK ("prevention_inspection_import_batches"."source_kind" IN ('annex_08_docx', 'annex_15_xlsx')),
	CONSTRAINT "prevention_inspection_import_batch_status_valid" CHECK ("prevention_inspection_import_batches"."status" IN ('staged', 'applied', 'rejected')),
	CONSTRAINT "prevention_inspection_import_batch_checksum_valid" CHECK (length("prevention_inspection_import_batches"."source_checksum_sha256") = 64)
);
--> statement-breakpoint
CREATE TABLE "prevention_inspection_import_rows" (
	"id" text PRIMARY KEY NOT NULL,
	"batch_id" text NOT NULL,
	"source_key" text NOT NULL,
	"raw_snapshot" jsonb NOT NULL,
	"status" text DEFAULT 'pending_review' NOT NULL,
	"run_id" text,
	"finding_id" text,
	"capa_action_id" text,
	"review_note" text,
	"reviewed_by_user_id" text,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prevention_inspection_import_row_status_valid" CHECK ("prevention_inspection_import_rows"."status" IN ('pending_review', 'imported', 'duplicate', 'rejected'))
);
--> statement-breakpoint
CREATE TABLE "prevention_inspection_run_participants" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"name" text NOT NULL,
	"position" text NOT NULL,
	"user_id" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prevention_inspection_run_participant_name_valid" CHECK (length("prevention_inspection_run_participants"."name") >= 2),
	CONSTRAINT "prevention_inspection_run_participant_position_valid" CHECK (length("prevention_inspection_run_participants"."position") >= 2)
);
--> statement-breakpoint
ALTER TABLE "prevention_capa_actions" ADD COLUMN "potential_damage_description" text;--> statement-breakpoint
ALTER TABLE "prevention_inspection_findings" ADD COLUMN "dano_potencial" text;--> statement-breakpoint
ALTER TABLE "prevention_inspection_findings" ADD COLUMN "potential_damage_description" text;--> statement-breakpoint
ALTER TABLE "prevention_inspection_findings" ADD COLUMN "applicable_law" text;--> statement-breakpoint
ALTER TABLE "prevention_inspection_run_documents" ADD COLUMN "file_name" text;--> statement-breakpoint
ALTER TABLE "prevention_inspection_run_documents" ADD COLUMN "mime_type" text;--> statement-breakpoint
ALTER TABLE "prevention_inspection_run_documents" ADD COLUMN "file_size" integer;--> statement-breakpoint
ALTER TABLE "prevention_inspection_run_documents" ADD COLUMN "checksum_sha256" text;--> statement-breakpoint
ALTER TABLE "prevention_inspection_runs" ADD COLUMN "official_compliance_basis_points" integer;--> statement-breakpoint
ALTER TABLE "prevention_inspection_runs" ADD COLUMN "normalized_compliance_basis_points" integer;--> statement-breakpoint
ALTER TABLE "prevention_inspection_runs" ADD COLUMN "ingestion_source" text DEFAULT 'digital' NOT NULL;--> statement-breakpoint
ALTER TABLE "prevention_inspection_templates" ADD COLUMN "provenance_kind" text DEFAULT 'platform_definition' NOT NULL;--> statement-breakpoint
ALTER TABLE "prevention_inspection_templates" ADD COLUMN "source_document_version_id" text;--> statement-breakpoint
ALTER TABLE "prevention_inspection_templates" ADD COLUMN "source_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "prevention_inspection_templates" ADD COLUMN "parity_report" jsonb;--> statement-breakpoint
ALTER TABLE "prevention_inspection_finding_evidence" ADD CONSTRAINT "prevention_inspection_finding_evidence_finding_id_prevention_inspection_findings_id_fk" FOREIGN KEY ("finding_id") REFERENCES "public"."prevention_inspection_findings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_inspection_finding_evidence" ADD CONSTRAINT "prevention_inspection_finding_evidence_uploaded_by_user_id_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_inspection_import_batches" ADD CONSTRAINT "prevention_inspection_import_batches_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_inspection_import_rows" ADD CONSTRAINT "prevention_inspection_import_rows_batch_id_prevention_inspection_import_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."prevention_inspection_import_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_inspection_import_rows" ADD CONSTRAINT "prevention_inspection_import_rows_run_id_prevention_inspection_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."prevention_inspection_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_inspection_import_rows" ADD CONSTRAINT "prevention_inspection_import_rows_finding_id_prevention_inspection_findings_id_fk" FOREIGN KEY ("finding_id") REFERENCES "public"."prevention_inspection_findings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_inspection_import_rows" ADD CONSTRAINT "prevention_inspection_import_rows_capa_action_id_prevention_capa_actions_id_fk" FOREIGN KEY ("capa_action_id") REFERENCES "public"."prevention_capa_actions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_inspection_import_rows" ADD CONSTRAINT "prevention_inspection_import_rows_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_inspection_run_participants" ADD CONSTRAINT "prevention_inspection_run_participants_run_id_prevention_inspection_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."prevention_inspection_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_inspection_run_participants" ADD CONSTRAINT "prevention_inspection_run_participants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "prevention_inspection_finding_evidence_finding_idx" ON "prevention_inspection_finding_evidence" USING btree ("finding_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "prevention_inspection_import_batch_checksum_unique" ON "prevention_inspection_import_batches" USING btree ("source_kind","source_checksum_sha256");--> statement-breakpoint
CREATE UNIQUE INDEX "prevention_inspection_import_row_source_unique" ON "prevention_inspection_import_rows" USING btree ("batch_id","source_key");--> statement-breakpoint
CREATE INDEX "prevention_inspection_import_row_status_idx" ON "prevention_inspection_import_rows" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "prevention_inspection_run_participant_order_unique" ON "prevention_inspection_run_participants" USING btree ("run_id","sort_order");--> statement-breakpoint
CREATE INDEX "prevention_inspection_run_participant_run_idx" ON "prevention_inspection_run_participants" USING btree ("run_id");--> statement-breakpoint
ALTER TABLE "prevention_inspection_templates" ADD CONSTRAINT "prevention_inspection_templates_source_document_version_id_sst_document_versions_id_fk" FOREIGN KEY ("source_document_version_id") REFERENCES "public"."sst_document_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_inspection_findings" ADD CONSTRAINT "prevention_inspection_finding_damage_valid" CHECK ("prevention_inspection_findings"."dano_potencial" IS NULL OR "prevention_inspection_findings"."dano_potencial" IN ('leve', 'moderado', 'grave', 'fatal'));--> statement-breakpoint
ALTER TABLE "prevention_inspection_run_documents" ADD CONSTRAINT "prevention_inspection_run_document_size_valid" CHECK ("prevention_inspection_run_documents"."file_size" IS NULL OR "prevention_inspection_run_documents"."file_size" > 0);--> statement-breakpoint
ALTER TABLE "prevention_inspection_run_documents" ADD CONSTRAINT "prevention_inspection_run_document_checksum_valid" CHECK ("prevention_inspection_run_documents"."checksum_sha256" IS NULL OR length("prevention_inspection_run_documents"."checksum_sha256") = 64);--> statement-breakpoint
ALTER TABLE "prevention_inspection_runs" ADD CONSTRAINT "prevention_inspection_run_official_bps_valid" CHECK ("prevention_inspection_runs"."official_compliance_basis_points" IS NULL OR "prevention_inspection_runs"."official_compliance_basis_points" BETWEEN 0 AND 10000);--> statement-breakpoint
ALTER TABLE "prevention_inspection_runs" ADD CONSTRAINT "prevention_inspection_run_normalized_bps_valid" CHECK ("prevention_inspection_runs"."normalized_compliance_basis_points" IS NULL OR "prevention_inspection_runs"."normalized_compliance_basis_points" BETWEEN 0 AND 10000);--> statement-breakpoint
ALTER TABLE "prevention_inspection_runs" ADD CONSTRAINT "prevention_inspection_run_ingestion_source_valid" CHECK ("prevention_inspection_runs"."ingestion_source" IN ('digital', 'legacy_document_import', 'legacy_tracking_import'));--> statement-breakpoint
ALTER TABLE "prevention_inspection_templates" ADD CONSTRAINT "prevention_inspection_template_provenance_valid" CHECK ("prevention_inspection_templates"."provenance_kind" IN ('official_document', 'platform_definition'));--> statement-breakpoint
ALTER TABLE "prevention_inspection_templates" ADD CONSTRAINT "prevention_inspection_template_official_source_consistent" CHECK ("prevention_inspection_templates"."provenance_kind" <> 'official_document' OR "prevention_inspection_templates"."status" = 'draft' OR "prevention_inspection_templates"."source_document_version_id" IS NOT NULL);