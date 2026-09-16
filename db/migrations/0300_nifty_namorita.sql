CREATE TABLE "pdtp_revision_diff_decisions" (
	"id" text PRIMARY KEY NOT NULL,
	"program_id" text NOT NULL,
	"base_template_version_id" text NOT NULL,
	"activity_identity" text NOT NULL,
	"decision" text NOT NULL,
	"decided_by_user_id" text NOT NULL,
	"decided_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "pdtp_revision_diff_decisions_identity_check" CHECK (length(trim("pdtp_revision_diff_decisions"."activity_identity")) > 0),
	CONSTRAINT "pdtp_revision_diff_decisions_decision_check" CHECK ("pdtp_revision_diff_decisions"."decision" IN ('applied', 'kept'))
);
--> statement-breakpoint
ALTER TABLE "pdtp_revision_diff_decisions" ADD CONSTRAINT "pdtp_revision_diff_decisions_program_id_pdtp_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."pdtp_programs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdtp_revision_diff_decisions" ADD CONSTRAINT "pdtp_rev_diff_base_version_fk" FOREIGN KEY ("base_template_version_id") REFERENCES "public"."pdtp_program_template_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdtp_revision_diff_decisions" ADD CONSTRAINT "pdtp_revision_diff_decisions_decided_by_user_id_users_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pdtp_revision_diff_decisions_program_base_identity_unique" ON "pdtp_revision_diff_decisions" USING btree ("program_id","base_template_version_id","activity_identity");--> statement-breakpoint
CREATE INDEX "pdtp_revision_diff_decisions_program_idx" ON "pdtp_revision_diff_decisions" USING btree ("program_id");
