ALTER TABLE "pdtp_activity_execution_configs" DROP CONSTRAINT IF EXISTS "pdtp_activity_execution_configs_activity_id_pdtp_activities_id_fk";
--> statement-breakpoint
ALTER TABLE "pdtp_activity_execution_configs" DROP CONSTRAINT IF EXISTS "pdtp_activity_execution_configs_accreditation_binding_id_pdtp_accreditation_bindings_id_fk";
--> statement-breakpoint
ALTER TABLE "pdtp_executions" DROP CONSTRAINT IF EXISTS "pdtp_executions_scheduled_instance_id_pdtp_scheduled_instances_id_fk";
--> statement-breakpoint
ALTER TABLE "pdtp_reminder_deliveries" DROP CONSTRAINT IF EXISTS "pdtp_reminder_deliveries_scheduled_instance_id_pdtp_scheduled_instances_id_fk";
--> statement-breakpoint
ALTER TABLE "pdtp_reminder_deliveries" DROP CONSTRAINT IF EXISTS "pdtp_reminder_deliveries_reminder_rule_id_pdtp_activity_reminder_rules_id_fk";
--> statement-breakpoint
ALTER TABLE "pdtp_activity_execution_configs" ADD CONSTRAINT "pdtp_exec_cfg_activity_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."pdtp_activities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdtp_activity_execution_configs" ADD CONSTRAINT "pdtp_exec_cfg_binding_fk" FOREIGN KEY ("accreditation_binding_id") REFERENCES "public"."pdtp_accreditation_bindings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdtp_executions" ADD CONSTRAINT "pdtp_exec_scheduled_instance_fk" FOREIGN KEY ("scheduled_instance_id") REFERENCES "public"."pdtp_scheduled_instances"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdtp_reminder_deliveries" ADD CONSTRAINT "pdtp_reminder_delivery_instance_fk" FOREIGN KEY ("scheduled_instance_id") REFERENCES "public"."pdtp_scheduled_instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdtp_reminder_deliveries" ADD CONSTRAINT "pdtp_reminder_delivery_rule_fk" FOREIGN KEY ("reminder_rule_id") REFERENCES "public"."pdtp_activity_reminder_rules"("id") ON DELETE cascade ON UPDATE no action;
