CREATE TABLE "pdtp_review_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"target_id" text NOT NULL,
	"program_id" text NOT NULL,
	"worksite_id" text NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'pending_review' NOT NULL,
	"requested_by_user_id" text NOT NULL,
	"requested_at" timestamp with time zone NOT NULL,
	"reviewed_by_user_id" text,
	"reviewed_at" timestamp with time zone,
	"review_reason" text,
	"withdrawn_by_user_id" text,
	"withdrawn_at" timestamp with time zone,
	CONSTRAINT "pdtp_review_requests_kind_check" CHECK ("pdtp_review_requests"."kind" IN ('obligation_cancellation', 'execution_annulment')),
	CONSTRAINT "pdtp_review_requests_status_check" CHECK ("pdtp_review_requests"."status" IN ('pending_review', 'approved', 'rejected', 'withdrawn')),
	CONSTRAINT "pdtp_review_requests_reason_check" CHECK (length(trim("pdtp_review_requests"."reason")) >= 10),
	CONSTRAINT "pdtp_review_requests_reviewer_check" CHECK ("pdtp_review_requests"."reviewed_by_user_id" IS NULL OR "pdtp_review_requests"."reviewed_by_user_id" <> "pdtp_review_requests"."requested_by_user_id"),
	CONSTRAINT "pdtp_review_requests_reviewed_check" CHECK ("pdtp_review_requests"."status" NOT IN ('approved', 'rejected') OR "pdtp_review_requests"."reviewed_at" IS NOT NULL),
	CONSTRAINT "pdtp_review_requests_rejected_check" CHECK ("pdtp_review_requests"."status" <> 'rejected' OR length(trim(COALESCE("pdtp_review_requests"."review_reason", ''))) >= 10),
	CONSTRAINT "pdtp_review_requests_withdrawn_check" CHECK ("pdtp_review_requests"."status" <> 'withdrawn' OR "pdtp_review_requests"."withdrawn_at" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "pdtp_review_requests" ADD CONSTRAINT "pdtp_review_requests_program_fk" FOREIGN KEY ("program_id") REFERENCES "public"."pdtp_programs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdtp_review_requests" ADD CONSTRAINT "pdtp_review_requests_worksite_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdtp_review_requests" ADD CONSTRAINT "pdtp_review_requests_requested_by_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdtp_review_requests" ADD CONSTRAINT "pdtp_review_requests_reviewed_by_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdtp_review_requests" ADD CONSTRAINT "pdtp_review_requests_withdrawn_by_fk" FOREIGN KEY ("withdrawn_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pdtp_review_requests_pending_unique" ON "pdtp_review_requests" USING btree ("kind","target_id") WHERE "pdtp_review_requests"."status" = 'pending_review';--> statement-breakpoint
CREATE INDEX "pdtp_review_requests_status_idx" ON "pdtp_review_requests" USING btree ("status","worksite_id","requested_at");