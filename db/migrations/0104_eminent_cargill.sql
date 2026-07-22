CREATE TABLE "pdtp_document_history" (
	"id" text PRIMARY KEY NOT NULL,
	"program_id" text NOT NULL,
	"entry_kind" text NOT NULL,
	"stable_key" text NOT NULL,
	"sequence" integer DEFAULT 1 NOT NULL,
	"declared_actor_name" text,
	"declared_actor_title" text,
	"declared_at_text" text,
	"description" text,
	"linked_user_id" text,
	"reconciled_by_user_id" text,
	"reconciled_at" timestamp with time zone,
	"reconciliation_reason" text,
	"source_import_batch_id" text,
	"source_metadata_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "pdtp_document_history_kind_check" CHECK ("pdtp_document_history"."entry_kind" IN ('elaboration', 'review', 'approval', 'change_control')),
	CONSTRAINT "pdtp_document_history_sequence_check" CHECK ("pdtp_document_history"."sequence" >= 1),
	CONSTRAINT "pdtp_document_history_reconciliation_check" CHECK ("pdtp_document_history"."linked_user_id" IS NULL OR ("pdtp_document_history"."reconciled_by_user_id" IS NOT NULL AND "pdtp_document_history"."reconciled_at" IS NOT NULL AND length(trim(COALESCE("pdtp_document_history"."reconciliation_reason", ''))) >= 10))
);
--> statement-breakpoint
CREATE TABLE "pdtp_role_legend_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"program_id" text NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"source_import_batch_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "pdtp_role_legend_code_check" CHECK (length(trim("pdtp_role_legend_entries"."code")) > 0),
	CONSTRAINT "pdtp_role_legend_label_check" CHECK (length(trim("pdtp_role_legend_entries"."label")) > 0)
);
--> statement-breakpoint
ALTER TABLE "pdtp_document_history" ADD CONSTRAINT "pdtp_document_history_program_id_pdtp_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."pdtp_programs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdtp_document_history" ADD CONSTRAINT "pdtp_document_history_linked_user_id_users_id_fk" FOREIGN KEY ("linked_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdtp_document_history" ADD CONSTRAINT "pdtp_document_history_reconciled_by_user_id_users_id_fk" FOREIGN KEY ("reconciled_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdtp_document_history" ADD CONSTRAINT "pdtp_document_history_source_import_batch_id_pdtp_import_batches_id_fk" FOREIGN KEY ("source_import_batch_id") REFERENCES "public"."pdtp_import_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdtp_role_legend_entries" ADD CONSTRAINT "pdtp_role_legend_entries_program_id_pdtp_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."pdtp_programs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdtp_role_legend_entries" ADD CONSTRAINT "pdtp_role_legend_entries_source_import_batch_id_pdtp_import_batches_id_fk" FOREIGN KEY ("source_import_batch_id") REFERENCES "public"."pdtp_import_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pdtp_document_history_source_key_unique" ON "pdtp_document_history" USING btree ("program_id","source_import_batch_id","stable_key");--> statement-breakpoint
CREATE INDEX "pdtp_document_history_program_kind_idx" ON "pdtp_document_history" USING btree ("program_id","entry_kind","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "pdtp_role_legend_source_code_unique" ON "pdtp_role_legend_entries" USING btree ("program_id","source_import_batch_id","code");--> statement-breakpoint
CREATE INDEX "pdtp_role_legend_program_idx" ON "pdtp_role_legend_entries" USING btree ("program_id","code");