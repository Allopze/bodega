ALTER TABLE "pdtp_execution_deviations" DROP CONSTRAINT IF EXISTS "pdtp_execution_deviations_activity_id_pdtp_activities_id_fk";
--> statement-breakpoint
ALTER TABLE "pdtp_executions" DROP CONSTRAINT IF EXISTS "pdtp_executions_activity_id_pdtp_activities_id_fk";
--> statement-breakpoint
ALTER TABLE "pdtp_period_closures" DROP CONSTRAINT IF EXISTS "pdtp_period_closures_program_id_pdtp_programs_id_fk";
--> statement-breakpoint
DROP INDEX IF EXISTS "pdtp_executions_scheduled_instance_idx";--> statement-breakpoint
ALTER TABLE "pdtp_execution_deviations" ADD CONSTRAINT "pdtp_execution_deviations_activity_id_pdtp_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."pdtp_activities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdtp_executions" ADD CONSTRAINT "pdtp_executions_activity_id_pdtp_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."pdtp_activities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdtp_period_closures" ADD CONSTRAINT "pdtp_period_closures_program_id_pdtp_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."pdtp_programs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pdtp_executions_activity_worksite_year_idx" ON "pdtp_executions" USING btree ("activity_id","worksite_id","year");--> statement-breakpoint
CREATE INDEX "pdtp_obligations_activity_worksite_idx" ON "pdtp_obligations" USING btree ("activity_id","worksite_id");