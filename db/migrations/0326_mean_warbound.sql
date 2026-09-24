ALTER TABLE "pdtp_activities" ADD COLUMN "min_annual_executions" integer;--> statement-breakpoint
ALTER TABLE "pdtp_activities" ADD CONSTRAINT "pdtp_activities_min_annual_executions_check" CHECK ("pdtp_activities"."min_annual_executions" IS NULL OR (
    "pdtp_activities"."min_annual_executions" >= 1
    AND "pdtp_activities"."schedule_mode" IN ('on_demand', 'triggered')
    AND "pdtp_activities"."indicator_mode" IN ('closed_on_time', 'coverage')
  ));