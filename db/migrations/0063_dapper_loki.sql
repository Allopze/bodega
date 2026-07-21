CREATE TABLE "sst_document_distribution_targets" (
	"id" text PRIMARY KEY NOT NULL,
	"version_id" text NOT NULL,
	"user_id" text,
	"worker_id" text,
	"assignment_reason" text NOT NULL,
	"worksite_id" text,
	"position_snapshot" text,
	"company_snapshot" text,
	"assigned_by_user_id" text NOT NULL,
	"assigned_at" timestamp with time zone NOT NULL,
	"due_at" timestamp with time zone,
	"status" text DEFAULT 'pendiente' NOT NULL,
	"exempted_by_user_id" text,
	"exempted_at" timestamp with time zone,
	"exemption_reason" text,
	"last_reminder_at" timestamp with time zone,
	"reminder_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "sst_document_distribution_recipient_valid" CHECK ("sst_document_distribution_targets"."user_id" IS NOT NULL OR "sst_document_distribution_targets"."worker_id" IS NOT NULL),
	CONSTRAINT "sst_document_distribution_status_valid" CHECK ("sst_document_distribution_targets"."status" IN ('pendiente', 'acusado', 'exento')),
	CONSTRAINT "sst_document_distribution_exemption_valid" CHECK (
    ("sst_document_distribution_targets"."status" <> 'exento' AND "sst_document_distribution_targets"."exempted_by_user_id" IS NULL AND "sst_document_distribution_targets"."exempted_at" IS NULL AND "sst_document_distribution_targets"."exemption_reason" IS NULL)
    OR
    ("sst_document_distribution_targets"."status" = 'exento' AND "sst_document_distribution_targets"."exempted_by_user_id" IS NOT NULL AND "sst_document_distribution_targets"."exempted_at" IS NOT NULL AND length("sst_document_distribution_targets"."exemption_reason") >= 3)
  ),
	CONSTRAINT "sst_document_distribution_reminder_count_valid" CHECK ("sst_document_distribution_targets"."reminder_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "sst_document_audit" DROP CONSTRAINT "sst_document_audit_action_valid";--> statement-breakpoint
ALTER TABLE "sst_document_distribution_targets" ADD CONSTRAINT "sst_document_distribution_targets_version_id_sst_document_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."sst_document_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sst_document_distribution_targets" ADD CONSTRAINT "sst_document_distribution_targets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sst_document_distribution_targets" ADD CONSTRAINT "sst_document_distribution_targets_worker_id_workers_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sst_document_distribution_targets" ADD CONSTRAINT "sst_document_distribution_targets_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sst_document_distribution_targets" ADD CONSTRAINT "sst_document_distribution_targets_assigned_by_user_id_users_id_fk" FOREIGN KEY ("assigned_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sst_document_distribution_targets" ADD CONSTRAINT "sst_document_distribution_targets_exempted_by_user_id_users_id_fk" FOREIGN KEY ("exempted_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sst_document_distribution_version_user_unique" ON "sst_document_distribution_targets" USING btree ("version_id","user_id") WHERE "sst_document_distribution_targets"."user_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "sst_document_distribution_version_worker_unique" ON "sst_document_distribution_targets" USING btree ("version_id","worker_id") WHERE "sst_document_distribution_targets"."worker_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "sst_document_distribution_version_status_idx" ON "sst_document_distribution_targets" USING btree ("version_id","status");--> statement-breakpoint
CREATE INDEX "sst_document_distribution_user_status_idx" ON "sst_document_distribution_targets" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "sst_document_distribution_worker_status_idx" ON "sst_document_distribution_targets" USING btree ("worker_id","status");--> statement-breakpoint
ALTER TABLE "sst_document_audit" ADD CONSTRAINT "sst_document_audit_action_valid" CHECK ("sst_document_audit"."action" IN ('create', 'upload', 'view', 'download', 'edit', 'status_change', 'approve', 'observe', 'replace', 'archive', 'ack', 'distribute', 'exempt', 'link', 'unlink', 'delete', 'permission_change'));