CREATE TABLE "pdtp_activities" (
	"id" text PRIMARY KEY NOT NULL,
	"program_id" text NOT NULL,
	"n" integer NOT NULL,
	"objective_order" integer NOT NULL,
	"objective" text NOT NULL,
	"activity" text NOT NULL,
	"program" text NOT NULL,
	"responsible_slugs" jsonb NOT NULL,
	"responsible_display" text NOT NULL,
	"source_sheet_row" integer NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pdtp_activity_schedule" (
	"id" text PRIMARY KEY NOT NULL,
	"activity_id" text NOT NULL,
	"year" integer NOT NULL,
	"month" integer NOT NULL,
	"week" integer NOT NULL,
	"planned_quantity" numeric(10, 2) DEFAULT 0 NOT NULL,
	"source_column" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pdtp_change_log" (
	"id" text PRIMARY KEY NOT NULL,
	"program_id" text NOT NULL,
	"version" integer NOT NULL,
	"changed_by_user_id" text,
	"changed_at" timestamp with time zone NOT NULL,
	"section" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "pdtp_executions" (
	"id" text PRIMARY KEY NOT NULL,
	"activity_id" text NOT NULL,
	"worksite_id" text,
	"year" integer NOT NULL,
	"month" integer NOT NULL,
	"week" integer NOT NULL,
	"executed_quantity" numeric(10, 2) DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"evidence_text" text,
	"evidence_url" text,
	"evidence_photos" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"executed_by_user_id" text,
	"executed_at" timestamp with time zone,
	"approved_by_user_id" text,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pdtp_programs" (
	"id" text PRIMARY KEY NOT NULL,
	"year" integer NOT NULL,
	"version" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"title" text NOT NULL,
	"elaborated_by_user_id" text,
	"elaborated_by_name" text NOT NULL,
	"elaborated_by_title" text NOT NULL,
	"approved_by_jdpr_user_id" text,
	"approved_by_jdpr_at" timestamp with time zone,
	"approved_by_legal_user_id" text,
	"approved_by_legal_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pdtp_responsible_catalog" (
	"slug" text PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"role_name" text,
	"kind" text NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "pdtp_sheet_activities" (
	"id" text PRIMARY KEY NOT NULL,
	"sheet_code" text NOT NULL,
	"activity_id" text NOT NULL,
	"sheet_row" integer NOT NULL,
	"display_order" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pdtp_sheets" (
	"code" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"area" text NOT NULL,
	"default_scope_roles" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pdtp_activities" ADD CONSTRAINT "pdtp_activities_program_id_pdtp_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."pdtp_programs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdtp_activity_schedule" ADD CONSTRAINT "pdtp_activity_schedule_activity_id_pdtp_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."pdtp_activities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdtp_change_log" ADD CONSTRAINT "pdtp_change_log_program_id_pdtp_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."pdtp_programs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdtp_change_log" ADD CONSTRAINT "pdtp_change_log_changed_by_user_id_users_id_fk" FOREIGN KEY ("changed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdtp_executions" ADD CONSTRAINT "pdtp_executions_activity_id_pdtp_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."pdtp_activities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdtp_executions" ADD CONSTRAINT "pdtp_executions_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdtp_executions" ADD CONSTRAINT "pdtp_executions_executed_by_user_id_users_id_fk" FOREIGN KEY ("executed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdtp_executions" ADD CONSTRAINT "pdtp_executions_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdtp_programs" ADD CONSTRAINT "pdtp_programs_elaborated_by_user_id_users_id_fk" FOREIGN KEY ("elaborated_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdtp_programs" ADD CONSTRAINT "pdtp_programs_approved_by_jdpr_user_id_users_id_fk" FOREIGN KEY ("approved_by_jdpr_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdtp_programs" ADD CONSTRAINT "pdtp_programs_approved_by_legal_user_id_users_id_fk" FOREIGN KEY ("approved_by_legal_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdtp_sheet_activities" ADD CONSTRAINT "pdtp_sheet_activities_sheet_code_pdtp_sheets_code_fk" FOREIGN KEY ("sheet_code") REFERENCES "public"."pdtp_sheets"("code") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdtp_sheet_activities" ADD CONSTRAINT "pdtp_sheet_activities_activity_id_pdtp_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."pdtp_activities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pdtp_activities_program_n_unique" ON "pdtp_activities" USING btree ("program_id","n");--> statement-breakpoint
CREATE INDEX "pdtp_activities_program_objective_idx" ON "pdtp_activities" USING btree ("program_id","objective_order");--> statement-breakpoint
CREATE UNIQUE INDEX "pdtp_activity_schedule_activity_period_unique" ON "pdtp_activity_schedule" USING btree ("activity_id","year","month","week");--> statement-breakpoint
CREATE INDEX "pdtp_activity_schedule_year_month_idx" ON "pdtp_activity_schedule" USING btree ("year","month");--> statement-breakpoint
CREATE INDEX "pdtp_change_log_program_version_idx" ON "pdtp_change_log" USING btree ("program_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "pdtp_executions_activity_scope_period_unique" ON "pdtp_executions" USING btree ("activity_id","worksite_id","year","month","week");--> statement-breakpoint
CREATE INDEX "pdtp_executions_worksite_period_idx" ON "pdtp_executions" USING btree ("worksite_id","year","month");--> statement-breakpoint
CREATE INDEX "pdtp_executions_status_idx" ON "pdtp_executions" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "pdtp_programs_year_version_unique" ON "pdtp_programs" USING btree ("year","version");--> statement-breakpoint
CREATE INDEX "pdtp_programs_status_idx" ON "pdtp_programs" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "pdtp_responsible_catalog_display_unique" ON "pdtp_responsible_catalog" USING btree ("display_name");--> statement-breakpoint
CREATE UNIQUE INDEX "pdtp_sheet_activities_sheet_activity_unique" ON "pdtp_sheet_activities" USING btree ("sheet_code","activity_id");--> statement-breakpoint
CREATE INDEX "pdtp_sheet_activities_sheet_order_idx" ON "pdtp_sheet_activities" USING btree ("sheet_code","display_order");--> statement-breakpoint
CREATE UNIQUE INDEX "pdtp_sheets_label_unique" ON "pdtp_sheets" USING btree ("label");