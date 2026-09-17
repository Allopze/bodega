CREATE TABLE "pdtp_activity_worksite_assignees" (
	"id" text PRIMARY KEY NOT NULL,
	"activity_id" text NOT NULL,
	"worksite_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role_id" text,
	"valid_from" date NOT NULL,
	"valid_until" date,
	"note" text,
	"created_by_user_id" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "pdtp_activity_worksite_assignees_validity_check" CHECK ("pdtp_activity_worksite_assignees"."valid_until" IS NULL OR "pdtp_activity_worksite_assignees"."valid_until" >= "pdtp_activity_worksite_assignees"."valid_from")
);
--> statement-breakpoint
ALTER TABLE "pdtp_activity_worksite_assignees" ADD CONSTRAINT "pdtp_activity_worksite_assignees_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdtp_activity_worksite_assignees" ADD CONSTRAINT "pdtp_activity_worksite_assignees_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdtp_activity_worksite_assignees" ADD CONSTRAINT "pdtp_activity_worksite_assignees_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdtp_activity_worksite_assignees" ADD CONSTRAINT "pdtp_activity_worksite_assignees_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdtp_activity_worksite_assignees" ADD CONSTRAINT "pdtp_activity_worksite_assignees_activity_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."pdtp_activities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pdtp_activity_worksite_assignees_open_unique" ON "pdtp_activity_worksite_assignees" USING btree ("activity_id","worksite_id","user_id") WHERE valid_until IS NULL;--> statement-breakpoint
CREATE INDEX "pdtp_activity_worksite_assignees_worksite_user_idx" ON "pdtp_activity_worksite_assignees" USING btree ("worksite_id","user_id");--> statement-breakpoint
CREATE INDEX "pdtp_activity_worksite_assignees_activity_worksite_idx" ON "pdtp_activity_worksite_assignees" USING btree ("activity_id","worksite_id");