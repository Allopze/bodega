CREATE TABLE "pdtp_activity_worksite_exclusions" (
	"id" text PRIMARY KEY NOT NULL,
	"activity_id" text NOT NULL,
	"worksite_id" text NOT NULL,
	"reason" text NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "pdtp_activity_worksite_exclusions_reason_check" CHECK (length(trim("pdtp_activity_worksite_exclusions"."reason")) >= 10)
);
--> statement-breakpoint
CREATE TABLE "pdtp_program_worksites" (
	"id" text PRIMARY KEY NOT NULL,
	"program_id" text NOT NULL,
	"worksite_id" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"added_by_user_id" text,
	"added_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pdtp_activity_worksite_exclusions" ADD CONSTRAINT "pdtp_activity_worksite_exclusions_activity_id_pdtp_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."pdtp_activities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdtp_activity_worksite_exclusions" ADD CONSTRAINT "pdtp_activity_worksite_exclusions_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdtp_activity_worksite_exclusions" ADD CONSTRAINT "pdtp_activity_worksite_exclusions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdtp_program_worksites" ADD CONSTRAINT "pdtp_program_worksites_program_id_pdtp_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."pdtp_programs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdtp_program_worksites" ADD CONSTRAINT "pdtp_program_worksites_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdtp_program_worksites" ADD CONSTRAINT "pdtp_program_worksites_added_by_user_id_users_id_fk" FOREIGN KEY ("added_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pdtp_activity_worksite_exclusions_activity_worksite_unique" ON "pdtp_activity_worksite_exclusions" USING btree ("activity_id","worksite_id");--> statement-breakpoint
CREATE INDEX "pdtp_activity_worksite_exclusions_worksite_idx" ON "pdtp_activity_worksite_exclusions" USING btree ("worksite_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pdtp_program_worksites_program_worksite_unique" ON "pdtp_program_worksites" USING btree ("program_id","worksite_id");--> statement-breakpoint
CREATE INDEX "pdtp_program_worksites_worksite_idx" ON "pdtp_program_worksites" USING btree ("worksite_id");