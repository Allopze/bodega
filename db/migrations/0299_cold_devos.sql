CREATE TABLE "pdtp_activity_executor_assignments" (
	"id" text PRIMARY KEY NOT NULL,
	"activity_id" text NOT NULL,
	"role_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
DROP INDEX IF EXISTS "pdtp_programs_year_unique";--> statement-breakpoint
ALTER TABLE "pdtp_activity_executor_assignments" ADD CONSTRAINT "pdtp_activity_executor_assignments_activity_id_pdtp_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."pdtp_activities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdtp_activity_executor_assignments" ADD CONSTRAINT "pdtp_activity_executor_assignments_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pdtp_activity_executor_assignments_activity_role_unique" ON "pdtp_activity_executor_assignments" USING btree ("activity_id","role_id");--> statement-breakpoint
CREATE INDEX "pdtp_activity_executor_assignments_role_idx" ON "pdtp_activity_executor_assignments" USING btree ("role_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pdtp_programs_year_version_unique" ON "pdtp_programs" USING btree ("year","version");
