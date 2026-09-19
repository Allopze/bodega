CREATE TABLE "pdtp_activity_execution_configs" (
	"id" text PRIMARY KEY NOT NULL,
	"activity_id" text NOT NULL,
	"destination_connector_key" text NOT NULL,
	"accreditation_binding_id" text,
	"completion_policy" text DEFAULT 'manual_confirmed' NOT NULL,
	"evidence_required" boolean DEFAULT false NOT NULL,
	"accepted_evidence_kinds" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "pdtp_activity_execution_configs_policy_check" CHECK ("pdtp_activity_execution_configs"."completion_policy" IN ('manual_confirmed', 'source_completed', 'source_approved', 'checklist_completed')),
	CONSTRAINT "pdtp_activity_execution_configs_evidence_kinds_check" CHECK (jsonb_typeof("pdtp_activity_execution_configs"."accepted_evidence_kinds") = 'array')
);
--> statement-breakpoint
CREATE TABLE "pdtp_activity_reminder_rules" (
	"id" text PRIMARY KEY NOT NULL,
	"activity_id" text NOT NULL,
	"offset_value" integer NOT NULL,
	"offset_unit" text DEFAULT 'day' NOT NULL,
	"recipient_kind" text DEFAULT 'responsible' NOT NULL,
	"recipient_user_id" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "pdtp_activity_reminder_rules_unit_check" CHECK ("pdtp_activity_reminder_rules"."offset_unit" IN ('hour', 'day')),
	CONSTRAINT "pdtp_activity_reminder_rules_recipient_check" CHECK ("pdtp_activity_reminder_rules"."recipient_kind" IN ('responsible', 'role', 'user')),
	CONSTRAINT "pdtp_activity_reminder_rules_user_recipient_check" CHECK ("pdtp_activity_reminder_rules"."recipient_kind" = 'user' OR "pdtp_activity_reminder_rules"."recipient_user_id" IS NULL)
);
--> statement-breakpoint
CREATE TABLE "pdtp_reminder_deliveries" (
	"id" text PRIMARY KEY NOT NULL,
	"scheduled_instance_id" text NOT NULL,
	"reminder_rule_id" text NOT NULL,
	"recipient_user_id" text NOT NULL,
	"status" text DEFAULT 'sent' NOT NULL,
	"delivered_at" timestamp with time zone,
	"error_message" text,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "pdtp_reminder_deliveries_status_check" CHECK ("pdtp_reminder_deliveries"."status" IN ('sent', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "pdtp_scheduled_instances" (
	"id" text PRIMARY KEY NOT NULL,
	"program_id" text NOT NULL,
	"activity_id" text NOT NULL,
	"worksite_id" text NOT NULL,
	"scheduled_for" date NOT NULL,
	"iso_week_year" integer NOT NULL,
	"iso_week" integer NOT NULL,
	"planned_quantity" numeric(10, 2) DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"responsible_slug" text,
	"responsible_user_id" text,
	"responsible_role_snapshot" text,
	"started_at" timestamp with time zone,
	"started_by_user_id" text,
	"completed_at" timestamp with time zone,
	"completed_by_user_id" text,
	"not_applicable_reason" text,
	"cancelled_at" timestamp with time zone,
	"cancelled_by_user_id" text,
	"cancellation_reason" text,
	"idempotency_key" text NOT NULL,
	"source_metadata_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "pdtp_scheduled_instances_status_check" CHECK ("pdtp_scheduled_instances"."status" IN ('pending', 'in_progress', 'submitted', 'completed', 'not_applicable', 'cancelled')),
	CONSTRAINT "pdtp_scheduled_instances_iso_week_check" CHECK ("pdtp_scheduled_instances"."iso_week" BETWEEN 1 AND 53),
	CONSTRAINT "pdtp_scheduled_instances_quantity_check" CHECK ("pdtp_scheduled_instances"."planned_quantity" > 0),
	CONSTRAINT "pdtp_scheduled_instances_not_applicable_reason_check" CHECK ("pdtp_scheduled_instances"."status" <> 'not_applicable' OR length(trim(COALESCE("pdtp_scheduled_instances"."not_applicable_reason", ''))) >= 3),
	CONSTRAINT "pdtp_scheduled_instances_cancel_reason_check" CHECK ("pdtp_scheduled_instances"."status" <> 'cancelled' OR length(trim(COALESCE("pdtp_scheduled_instances"."cancellation_reason", ''))) >= 3)
);
--> statement-breakpoint
CREATE TABLE "pdtp_trigger_events" (
	"id" text PRIMARY KEY NOT NULL,
	"connector_key" text NOT NULL,
	"event_key" text NOT NULL,
	"source_type" text NOT NULL,
	"source_id" text NOT NULL,
	"worksite_id" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"idempotency_key" text NOT NULL,
	"payload_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"obligation_id" text,
	"processed_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "pdtp_trigger_events_status_check" CHECK ("pdtp_trigger_events"."status" IN ('pending', 'processed', 'ignored', 'error')),
	CONSTRAINT "pdtp_trigger_events_attempts_check" CHECK ("pdtp_trigger_events"."attempts" >= 0)
);
--> statement-breakpoint
ALTER TABLE "pdtp_activities" ADD COLUMN "schedule_definition" jsonb;--> statement-breakpoint
ALTER TABLE "pdtp_executions" ADD COLUMN "scheduled_instance_id" text;--> statement-breakpoint
ALTER TABLE "pdtp_activity_execution_configs" ADD CONSTRAINT "pdtp_activity_execution_configs_activity_id_pdtp_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."pdtp_activities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdtp_activity_execution_configs" ADD CONSTRAINT "pdtp_activity_execution_configs_accreditation_binding_id_pdtp_accreditation_bindings_id_fk" FOREIGN KEY ("accreditation_binding_id") REFERENCES "public"."pdtp_accreditation_bindings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdtp_activity_reminder_rules" ADD CONSTRAINT "pdtp_activity_reminder_rules_activity_id_pdtp_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."pdtp_activities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdtp_activity_reminder_rules" ADD CONSTRAINT "pdtp_activity_reminder_rules_recipient_user_id_users_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdtp_reminder_deliveries" ADD CONSTRAINT "pdtp_reminder_deliveries_scheduled_instance_id_pdtp_scheduled_instances_id_fk" FOREIGN KEY ("scheduled_instance_id") REFERENCES "public"."pdtp_scheduled_instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdtp_reminder_deliveries" ADD CONSTRAINT "pdtp_reminder_deliveries_reminder_rule_id_pdtp_activity_reminder_rules_id_fk" FOREIGN KEY ("reminder_rule_id") REFERENCES "public"."pdtp_activity_reminder_rules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdtp_reminder_deliveries" ADD CONSTRAINT "pdtp_reminder_deliveries_recipient_user_id_users_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdtp_scheduled_instances" ADD CONSTRAINT "pdtp_scheduled_instances_program_id_pdtp_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."pdtp_programs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdtp_scheduled_instances" ADD CONSTRAINT "pdtp_scheduled_instances_activity_id_pdtp_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."pdtp_activities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdtp_scheduled_instances" ADD CONSTRAINT "pdtp_scheduled_instances_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdtp_scheduled_instances" ADD CONSTRAINT "pdtp_scheduled_instances_responsible_user_id_users_id_fk" FOREIGN KEY ("responsible_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdtp_scheduled_instances" ADD CONSTRAINT "pdtp_scheduled_instances_started_by_user_id_users_id_fk" FOREIGN KEY ("started_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdtp_scheduled_instances" ADD CONSTRAINT "pdtp_scheduled_instances_completed_by_user_id_users_id_fk" FOREIGN KEY ("completed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdtp_scheduled_instances" ADD CONSTRAINT "pdtp_scheduled_instances_cancelled_by_user_id_users_id_fk" FOREIGN KEY ("cancelled_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdtp_trigger_events" ADD CONSTRAINT "pdtp_trigger_events_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdtp_trigger_events" ADD CONSTRAINT "pdtp_trigger_events_obligation_id_pdtp_obligations_id_fk" FOREIGN KEY ("obligation_id") REFERENCES "public"."pdtp_obligations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pdtp_activity_execution_configs_activity_unique" ON "pdtp_activity_execution_configs" USING btree ("activity_id");--> statement-breakpoint
CREATE INDEX "pdtp_activity_execution_configs_connector_idx" ON "pdtp_activity_execution_configs" USING btree ("destination_connector_key");--> statement-breakpoint
CREATE INDEX "pdtp_activity_reminder_rules_activity_idx" ON "pdtp_activity_reminder_rules" USING btree ("activity_id","is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "pdtp_reminder_deliveries_dedupe_unique" ON "pdtp_reminder_deliveries" USING btree ("scheduled_instance_id","reminder_rule_id","recipient_user_id");--> statement-breakpoint
CREATE INDEX "pdtp_reminder_deliveries_status_idx" ON "pdtp_reminder_deliveries" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "pdtp_scheduled_instances_idempotency_unique" ON "pdtp_scheduled_instances" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "pdtp_scheduled_instances_activity_worksite_date_unique" ON "pdtp_scheduled_instances" USING btree ("activity_id","worksite_id","scheduled_for");--> statement-breakpoint
CREATE INDEX "pdtp_scheduled_instances_program_period_idx" ON "pdtp_scheduled_instances" USING btree ("program_id","scheduled_for");--> statement-breakpoint
CREATE INDEX "pdtp_scheduled_instances_worksite_status_idx" ON "pdtp_scheduled_instances" USING btree ("worksite_id","status","scheduled_for");--> statement-breakpoint
CREATE UNIQUE INDEX "pdtp_trigger_events_idempotency_unique" ON "pdtp_trigger_events" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "pdtp_trigger_events_pending_idx" ON "pdtp_trigger_events" USING btree ("status","occurred_at");--> statement-breakpoint
CREATE INDEX "pdtp_trigger_events_connector_event_idx" ON "pdtp_trigger_events" USING btree ("connector_key","event_key");--> statement-breakpoint
ALTER TABLE "pdtp_executions" ADD CONSTRAINT "pdtp_executions_scheduled_instance_id_pdtp_scheduled_instances_id_fk" FOREIGN KEY ("scheduled_instance_id") REFERENCES "public"."pdtp_scheduled_instances"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pdtp_executions_scheduled_instance_unique" ON "pdtp_executions" USING btree ("scheduled_instance_id");--> statement-breakpoint
CREATE INDEX "pdtp_executions_scheduled_instance_idx" ON "pdtp_executions" USING btree ("scheduled_instance_id");