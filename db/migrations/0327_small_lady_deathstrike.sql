CREATE TABLE "pdtp_activity_document_requirements" (
	"id" text PRIMARY KEY NOT NULL,
	"activity_id" text NOT NULL,
	"document_type_id" text NOT NULL,
	"scope" text NOT NULL,
	"must_follow_document_type_id" text,
	"display_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "pdtp_activity_document_requirements_scope_check" CHECK ("pdtp_activity_document_requirements"."scope" IN ('faena', 'corporativo')),
	CONSTRAINT "pdtp_activity_document_requirements_display_order_check" CHECK ("pdtp_activity_document_requirements"."display_order" >= 0),
	CONSTRAINT "pdtp_activity_document_requirements_must_follow_check" CHECK ("pdtp_activity_document_requirements"."must_follow_document_type_id" IS NULL OR "pdtp_activity_document_requirements"."must_follow_document_type_id" <> "pdtp_activity_document_requirements"."document_type_id")
);
--> statement-breakpoint
ALTER TABLE "sst_document_types" ADD COLUMN "distribution_due_days" integer;--> statement-breakpoint
ALTER TABLE "sst_document_versions" ADD COLUMN "approval_mode" text DEFAULT 'workflow' NOT NULL;--> statement-breakpoint
ALTER TABLE "pdtp_activity_document_requirements" ADD CONSTRAINT "pdtp_act_doc_req_activity_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."pdtp_activities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdtp_activity_document_requirements" ADD CONSTRAINT "pdtp_act_doc_req_type_fk" FOREIGN KEY ("document_type_id") REFERENCES "public"."sst_document_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdtp_activity_document_requirements" ADD CONSTRAINT "pdtp_act_doc_req_must_follow_fk" FOREIGN KEY ("must_follow_document_type_id") REFERENCES "public"."sst_document_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pdtp_activity_document_requirements_activity_type_unique" ON "pdtp_activity_document_requirements" USING btree ("activity_id","document_type_id");--> statement-breakpoint
CREATE INDEX "pdtp_activity_document_requirements_type_idx" ON "pdtp_activity_document_requirements" USING btree ("document_type_id");--> statement-breakpoint
ALTER TABLE "sst_document_types" ADD CONSTRAINT "sst_document_types_distribution_due_days_check" CHECK ("sst_document_types"."distribution_due_days" IS NULL OR "sst_document_types"."distribution_due_days" BETWEEN 1 AND 365);--> statement-breakpoint
ALTER TABLE "sst_document_versions" ADD CONSTRAINT "sst_document_versions_approval_mode_valid" CHECK ("sst_document_versions"."approval_mode" IN ('workflow', 'not_required'));