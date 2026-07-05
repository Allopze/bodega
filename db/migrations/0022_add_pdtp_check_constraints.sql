ALTER TABLE "pdtp_activities" ADD CONSTRAINT "pdtp_activities_n_check" CHECK ("pdtp_activities"."n" >= 1);--> statement-breakpoint
ALTER TABLE "pdtp_activities" ADD CONSTRAINT "pdtp_activities_objective_order_check" CHECK ("pdtp_activities"."objective_order" BETWEEN 1 AND 8);--> statement-breakpoint
ALTER TABLE "pdtp_activity_schedule" ADD CONSTRAINT "pdtp_activity_schedule_month_check" CHECK ("pdtp_activity_schedule"."month" BETWEEN 1 AND 12);--> statement-breakpoint
ALTER TABLE "pdtp_activity_schedule" ADD CONSTRAINT "pdtp_activity_schedule_week_check" CHECK ("pdtp_activity_schedule"."week" BETWEEN 1 AND 4);--> statement-breakpoint
ALTER TABLE "pdtp_activity_schedule" ADD CONSTRAINT "pdtp_activity_schedule_quantity_check" CHECK ("pdtp_activity_schedule"."planned_quantity" >= 0);--> statement-breakpoint
ALTER TABLE "pdtp_activity_schedule_overrides" ADD CONSTRAINT "pdtp_schedule_overrides_month_check" CHECK ("pdtp_activity_schedule_overrides"."month" BETWEEN 1 AND 12);--> statement-breakpoint
ALTER TABLE "pdtp_activity_schedule_overrides" ADD CONSTRAINT "pdtp_schedule_overrides_week_check" CHECK ("pdtp_activity_schedule_overrides"."week" BETWEEN 1 AND 4);--> statement-breakpoint
ALTER TABLE "pdtp_activity_schedule_overrides" ADD CONSTRAINT "pdtp_schedule_overrides_quantity_check" CHECK ("pdtp_activity_schedule_overrides"."planned_quantity" >= 0);--> statement-breakpoint
ALTER TABLE "pdtp_change_log" ADD CONSTRAINT "pdtp_change_log_section_check" CHECK (length("pdtp_change_log"."section") > 0);--> statement-breakpoint
ALTER TABLE "pdtp_executions" ADD CONSTRAINT "pdtp_executions_status_check" CHECK ("pdtp_executions"."status" IN ('draft', 'submitted', 'approved', 'rejected'));--> statement-breakpoint
ALTER TABLE "pdtp_executions" ADD CONSTRAINT "pdtp_executions_month_check" CHECK ("pdtp_executions"."month" BETWEEN 1 AND 12);--> statement-breakpoint
ALTER TABLE "pdtp_executions" ADD CONSTRAINT "pdtp_executions_week_check" CHECK ("pdtp_executions"."week" BETWEEN 1 AND 4);--> statement-breakpoint
ALTER TABLE "pdtp_executions" ADD CONSTRAINT "pdtp_executions_quantity_check" CHECK ("pdtp_executions"."executed_quantity" >= 0);--> statement-breakpoint
ALTER TABLE "pdtp_programs" ADD CONSTRAINT "pdtp_programs_status_check" CHECK ("pdtp_programs"."status" IN ('draft', 'active', 'closed'));--> statement-breakpoint
ALTER TABLE "pdtp_programs" ADD CONSTRAINT "pdtp_programs_compliance_target_check" CHECK ("pdtp_programs"."compliance_target" >= 0 AND "pdtp_programs"."compliance_target" <= 1);