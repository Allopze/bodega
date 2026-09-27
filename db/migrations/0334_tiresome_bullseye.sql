CREATE TABLE "pdtp_evidence_uploads" (
	"path" text PRIMARY KEY NOT NULL,
	"uploaded_by_user_id" text,
	"worksite_id" text NOT NULL,
	"activity_id" text,
	"sha256" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"mime_type" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "pdtp_evidence_uploads_sha256_check" CHECK ("pdtp_evidence_uploads"."sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "pdtp_evidence_uploads_size_check" CHECK ("pdtp_evidence_uploads"."size_bytes" > 0)
);
--> statement-breakpoint
CREATE TABLE "pdtp_scheduled_instance_outcome_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"instance_id" text NOT NULL,
	"outcome" text NOT NULL,
	"reason" text NOT NULL,
	"evidence_ref" text,
	"status" text DEFAULT 'pending_review' NOT NULL,
	"requested_by_user_id" text NOT NULL,
	"requested_at" timestamp with time zone NOT NULL,
	"reviewed_by_user_id" text,
	"reviewed_at" timestamp with time zone,
	"review_reason" text,
	"withdrawn_by_user_id" text,
	"withdrawn_at" timestamp with time zone,
	"withdraw_reason" text,
	CONSTRAINT "pdtp_sched_outcome_requests_outcome_check" CHECK ("pdtp_scheduled_instance_outcome_requests"."outcome" IN ('not_applicable', 'cancelled')),
	CONSTRAINT "pdtp_sched_outcome_requests_status_check" CHECK ("pdtp_scheduled_instance_outcome_requests"."status" IN ('pending_review', 'approved', 'rejected', 'withdrawn')),
	CONSTRAINT "pdtp_sched_outcome_requests_reason_check" CHECK (length(trim("pdtp_scheduled_instance_outcome_requests"."reason")) >= 10),
	CONSTRAINT "pdtp_sched_outcome_requests_reviewer_check" CHECK ("pdtp_scheduled_instance_outcome_requests"."reviewed_by_user_id" IS NULL OR "pdtp_scheduled_instance_outcome_requests"."reviewed_by_user_id" <> "pdtp_scheduled_instance_outcome_requests"."requested_by_user_id"),
	CONSTRAINT "pdtp_sched_outcome_requests_reviewed_check" CHECK ("pdtp_scheduled_instance_outcome_requests"."status" NOT IN ('approved', 'rejected') OR "pdtp_scheduled_instance_outcome_requests"."reviewed_at" IS NOT NULL),
	CONSTRAINT "pdtp_sched_outcome_requests_rejected_check" CHECK ("pdtp_scheduled_instance_outcome_requests"."status" <> 'rejected' OR length(trim(COALESCE("pdtp_scheduled_instance_outcome_requests"."review_reason", ''))) >= 10),
	CONSTRAINT "pdtp_sched_outcome_requests_withdrawn_check" CHECK ("pdtp_scheduled_instance_outcome_requests"."status" <> 'withdrawn' OR "pdtp_scheduled_instance_outcome_requests"."withdrawn_at" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "pdtp_evidence_uploads" ADD CONSTRAINT "pdtp_evidence_uploads_uploaded_by_user_id_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdtp_evidence_uploads" ADD CONSTRAINT "pdtp_evidence_uploads_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdtp_evidence_uploads" ADD CONSTRAINT "pdtp_evidence_uploads_activity_id_pdtp_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."pdtp_activities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdtp_scheduled_instance_outcome_requests" ADD CONSTRAINT "pdtp_sched_outcome_requests_instance_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."pdtp_scheduled_instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdtp_scheduled_instance_outcome_requests" ADD CONSTRAINT "pdtp_sched_outcome_requests_requested_by_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdtp_scheduled_instance_outcome_requests" ADD CONSTRAINT "pdtp_sched_outcome_requests_reviewed_by_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdtp_scheduled_instance_outcome_requests" ADD CONSTRAINT "pdtp_sched_outcome_requests_withdrawn_by_fk" FOREIGN KEY ("withdrawn_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pdtp_evidence_uploads_worksite_idx" ON "pdtp_evidence_uploads" USING btree ("worksite_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pdtp_sched_outcome_requests_pending_unique" ON "pdtp_scheduled_instance_outcome_requests" USING btree ("instance_id") WHERE "pdtp_scheduled_instance_outcome_requests"."status" = 'pending_review';--> statement-breakpoint
CREATE INDEX "pdtp_sched_outcome_requests_instance_idx" ON "pdtp_scheduled_instance_outcome_requests" USING btree ("instance_id");--> statement-breakpoint
CREATE INDEX "pdtp_sched_outcome_requests_status_idx" ON "pdtp_scheduled_instance_outcome_requests" USING btree ("status","requested_at");