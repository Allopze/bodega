CREATE TABLE "pdtp_activity_padron_changes" (
	"id" text PRIMARY KEY NOT NULL,
	"activity_id" text NOT NULL,
	"worksite_id" text NOT NULL,
	"year" integer NOT NULL,
	"effective_month" integer NOT NULL,
	"previous_count" integer,
	"new_count" integer,
	"changed_by_user_id" text,
	"changed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "pdtp_activity_padron_changes_month_check" CHECK ("pdtp_activity_padron_changes"."effective_month" BETWEEN 1 AND 12),
	CONSTRAINT "pdtp_activity_padron_changes_counts_check" CHECK (("pdtp_activity_padron_changes"."previous_count" IS NULL OR "pdtp_activity_padron_changes"."previous_count" >= 0) AND ("pdtp_activity_padron_changes"."new_count" IS NULL OR "pdtp_activity_padron_changes"."new_count" >= 0))
);
--> statement-breakpoint
ALTER TABLE "pdtp_activity_padron_changes" ADD CONSTRAINT "pdtp_activity_padron_changes_activity_id_pdtp_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."pdtp_activities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdtp_activity_padron_changes" ADD CONSTRAINT "pdtp_activity_padron_changes_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdtp_activity_padron_changes" ADD CONSTRAINT "pdtp_activity_padron_changes_changed_by_user_id_users_id_fk" FOREIGN KEY ("changed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pdtp_activity_padron_changes_lookup_idx" ON "pdtp_activity_padron_changes" USING btree ("activity_id","worksite_id","year","effective_month");