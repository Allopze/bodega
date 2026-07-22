CREATE TABLE "pdtp_import_batches" (
	"id" text PRIMARY KEY NOT NULL,
	"program_id" text NOT NULL,
	"status" text DEFAULT 'staged' NOT NULL,
	"adapter_code" text DEFAULT 'pdtp_2026_xlsx_v1' NOT NULL,
	"source_file_name" text NOT NULL,
	"source_mime_type" text NOT NULL,
	"source_size_bytes" integer NOT NULL,
	"source_checksum_sha256" text NOT NULL,
	"preview_json" jsonb NOT NULL,
	"metadata_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"warnings_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"pre_apply_snapshot_json" jsonb,
	"apply_result_json" jsonb,
	"target_worksite_id" text,
	"accepted_missing_evidence" boolean DEFAULT false NOT NULL,
	"acceptance_reason" text,
	"requested_by_user_id" text NOT NULL,
	"applied_by_user_id" text,
	"rolled_back_by_user_id" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"applied_at" timestamp with time zone,
	"rolled_back_at" timestamp with time zone,
	CONSTRAINT "pdtp_import_batches_status_check" CHECK ("pdtp_import_batches"."status" IN ('staged', 'applied', 'rolled_back', 'failed')),
	CONSTRAINT "pdtp_import_batches_size_check" CHECK ("pdtp_import_batches"."source_size_bytes" > 0),
	CONSTRAINT "pdtp_import_batches_checksum_check" CHECK (length("pdtp_import_batches"."source_checksum_sha256") = 64),
	CONSTRAINT "pdtp_import_batches_acceptance_reason_check" CHECK ("pdtp_import_batches"."accepted_missing_evidence" = false OR length(trim(COALESCE("pdtp_import_batches"."acceptance_reason", ''))) >= 10)
);
--> statement-breakpoint
CREATE TABLE "pdtp_import_rows" (
	"id" text PRIMARY KEY NOT NULL,
	"batch_id" text NOT NULL,
	"row_kind" text NOT NULL,
	"stable_key" text NOT NULL,
	"severity" text DEFAULT 'info' NOT NULL,
	"source_sheet" text,
	"source_cell" text,
	"source_row" integer,
	"activity_number" integer,
	"payload_json" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "pdtp_import_rows_kind_check" CHECK ("pdtp_import_rows"."row_kind" IN ('activity', 'execution', 'metadata', 'warning')),
	CONSTRAINT "pdtp_import_rows_severity_check" CHECK ("pdtp_import_rows"."severity" IN ('info', 'warning', 'error'))
);
--> statement-breakpoint
ALTER TABLE "pdtp_executions" ADD COLUMN "origin" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "pdtp_executions" ADD COLUMN "source_type" text;--> statement-breakpoint
ALTER TABLE "pdtp_executions" ADD COLUMN "source_id" text;--> statement-breakpoint
ALTER TABLE "pdtp_executions" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "pdtp_executions" ADD COLUMN "import_batch_id" text;--> statement-breakpoint
ALTER TABLE "pdtp_executions" ADD COLUMN "source_metadata_json" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "pdtp_executions" ADD COLUMN "evidence_status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "pdtp_programs" ADD COLUMN "period_start" date;--> statement-breakpoint
ALTER TABLE "pdtp_programs" ADD COLUMN "period_end" date;--> statement-breakpoint
ALTER TABLE "pdtp_programs" ADD COLUMN "document_code" text;--> statement-breakpoint
ALTER TABLE "pdtp_programs" ADD COLUMN "document_revision" text;--> statement-breakpoint
ALTER TABLE "pdtp_programs" ADD COLUMN "valid_from" date;--> statement-breakpoint
ALTER TABLE "pdtp_programs" ADD COLUMN "valid_until" date;--> statement-breakpoint
ALTER TABLE "pdtp_programs" ADD COLUMN "indicator_name" text;--> statement-breakpoint
ALTER TABLE "pdtp_programs" ADD COLUMN "indicator_type" text;--> statement-breakpoint
ALTER TABLE "pdtp_programs" ADD COLUMN "indicator_formula" text;--> statement-breakpoint
ALTER TABLE "pdtp_programs" ADD COLUMN "indicator_periodicity" text;--> statement-breakpoint
ALTER TABLE "pdtp_programs" ADD COLUMN "measurement_owner" text;--> statement-breakpoint
ALTER TABLE "pdtp_programs" ADD COLUMN "source_metadata_json" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "pdtp_import_batches" ADD CONSTRAINT "pdtp_import_batches_program_id_pdtp_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."pdtp_programs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdtp_import_batches" ADD CONSTRAINT "pdtp_import_batches_target_worksite_id_worksites_id_fk" FOREIGN KEY ("target_worksite_id") REFERENCES "public"."worksites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdtp_import_batches" ADD CONSTRAINT "pdtp_import_batches_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdtp_import_batches" ADD CONSTRAINT "pdtp_import_batches_applied_by_user_id_users_id_fk" FOREIGN KEY ("applied_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdtp_import_batches" ADD CONSTRAINT "pdtp_import_batches_rolled_back_by_user_id_users_id_fk" FOREIGN KEY ("rolled_back_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdtp_import_rows" ADD CONSTRAINT "pdtp_import_rows_batch_id_pdtp_import_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."pdtp_import_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pdtp_import_batches_program_checksum_unique" ON "pdtp_import_batches" USING btree ("program_id","source_checksum_sha256");--> statement-breakpoint
CREATE INDEX "pdtp_import_batches_program_status_idx" ON "pdtp_import_batches" USING btree ("program_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "pdtp_import_rows_batch_key_unique" ON "pdtp_import_rows" USING btree ("batch_id","stable_key");--> statement-breakpoint
CREATE INDEX "pdtp_import_rows_batch_kind_idx" ON "pdtp_import_rows" USING btree ("batch_id","row_kind");--> statement-breakpoint
ALTER TABLE "pdtp_executions" ADD CONSTRAINT "pdtp_executions_import_batch_id_pdtp_import_batches_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."pdtp_import_batches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pdtp_executions_idempotency_key_unique" ON "pdtp_executions" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "pdtp_executions_import_batch_idx" ON "pdtp_executions" USING btree ("import_batch_id");--> statement-breakpoint
ALTER TABLE "pdtp_executions" ADD CONSTRAINT "pdtp_executions_origin_check" CHECK ("pdtp_executions"."origin" IN ('manual', 'xlsx_import', 'integration'));--> statement-breakpoint
ALTER TABLE "pdtp_executions" ADD CONSTRAINT "pdtp_executions_evidence_status_check" CHECK ("pdtp_executions"."evidence_status" IN ('pending', 'provided', 'not_required', 'migrated_without_attachment'));--> statement-breakpoint
ALTER TABLE "pdtp_programs" ADD CONSTRAINT "pdtp_programs_period_check" CHECK ("pdtp_programs"."period_start" IS NULL OR "pdtp_programs"."period_end" IS NULL OR "pdtp_programs"."period_start" <= "pdtp_programs"."period_end");--> statement-breakpoint
ALTER TABLE "pdtp_programs" ADD CONSTRAINT "pdtp_programs_validity_check" CHECK ("pdtp_programs"."valid_from" IS NULL OR "pdtp_programs"."valid_until" IS NULL OR "pdtp_programs"."valid_from" <= "pdtp_programs"."valid_until");