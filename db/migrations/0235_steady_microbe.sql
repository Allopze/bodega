CREATE TABLE "prevention_containers" (
	"id" text PRIMARY KEY NOT NULL,
	"worksite_id" text NOT NULL,
	"code" text NOT NULL,
	"location" text NOT NULL,
	"status" text DEFAULT 'operational' NOT NULL,
	"notes" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prevention_container_status_valid" CHECK ("prevention_containers"."status" IN ('operational', 'observed', 'out_of_service')),
	CONSTRAINT "prevention_container_version_positive" CHECK ("prevention_containers"."version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "prevention_inspection_runs" DROP CONSTRAINT "prevention_inspection_run_single_subject";--> statement-breakpoint
ALTER TABLE "pdtp_execution_checklists" ADD COLUMN "subject_container_id" text;--> statement-breakpoint
ALTER TABLE "prevention_inspection_programs" ADD COLUMN "subject_container_id" text;--> statement-breakpoint
ALTER TABLE "prevention_inspection_runs" ADD COLUMN "subject_container_id" text;--> statement-breakpoint
ALTER TABLE "prevention_containers" ADD CONSTRAINT "prevention_containers_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_containers" ADD CONSTRAINT "prevention_containers_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "prevention_container_code_unique" ON "prevention_containers" USING btree ("code");--> statement-breakpoint
CREATE INDEX "prevention_container_worksite_idx" ON "prevention_containers" USING btree ("worksite_id","is_active");--> statement-breakpoint
ALTER TABLE "pdtp_execution_checklists" ADD CONSTRAINT "pdtp_execution_checklists_subject_container_id_prevention_containers_id_fk" FOREIGN KEY ("subject_container_id") REFERENCES "public"."prevention_containers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_inspection_programs" ADD CONSTRAINT "prevention_inspection_programs_subject_container_id_prevention_containers_id_fk" FOREIGN KEY ("subject_container_id") REFERENCES "public"."prevention_containers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_inspection_runs" ADD CONSTRAINT "prevention_inspection_runs_subject_container_id_prevention_containers_id_fk" FOREIGN KEY ("subject_container_id") REFERENCES "public"."prevention_containers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pdtp_execution_checklists_subject_container_idx" ON "pdtp_execution_checklists" USING btree ("subject_container_id");--> statement-breakpoint
CREATE INDEX "prevention_inspection_run_subject_container_idx" ON "prevention_inspection_runs" USING btree ("subject_container_id");--> statement-breakpoint
ALTER TABLE "pdtp_execution_checklists" ADD CONSTRAINT "pdtp_execution_checklists_container_subject_fk" CHECK ("pdtp_execution_checklists"."subject_type" <> 'contenedor' OR "pdtp_execution_checklists"."subject_container_id" IS NOT NULL OR "pdtp_execution_checklists"."subject_id" <> '');--> statement-breakpoint
ALTER TABLE "prevention_inspection_runs" ADD CONSTRAINT "prevention_inspection_run_single_subject" CHECK (num_nonnulls("prevention_inspection_runs"."subject_resource_id", "prevention_inspection_runs"."subject_vehicle_id", "prevention_inspection_runs"."subject_container_id") <= 1);