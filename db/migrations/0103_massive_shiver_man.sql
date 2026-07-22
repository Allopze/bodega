CREATE TABLE "pdtp_obligation_reminders" (
	"id" text PRIMARY KEY NOT NULL,
	"obligation_id" text NOT NULL,
	"recipient_user_id" text NOT NULL,
	"reminder_window" text NOT NULL,
	"status" text DEFAULT 'sent' NOT NULL,
	"sent_at" timestamp with time zone,
	"error_message" text,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "pdtp_obligation_reminders_window_check" CHECK ("pdtp_obligation_reminders"."reminder_window" IN ('due_7d', 'due_1d', 'overdue')),
	CONSTRAINT "pdtp_obligation_reminders_status_check" CHECK ("pdtp_obligation_reminders"."status" IN ('sent', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "pdtp_obligations" (
	"id" text PRIMARY KEY NOT NULL,
	"program_id" text NOT NULL,
	"activity_id" text NOT NULL,
	"worksite_id" text NOT NULL,
	"mode" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"trigger_type" text,
	"source_type" text,
	"source_id" text,
	"source_occurred_at" timestamp with time zone,
	"due_at" timestamp with time zone,
	"planned_quantity" numeric(10, 2) DEFAULT 1 NOT NULL,
	"completed_quantity" numeric(10, 2) DEFAULT 0 NOT NULL,
	"idempotency_key" text NOT NULL,
	"origin" text NOT NULL,
	"manual_reason" text,
	"source_metadata_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by_user_id" text,
	"reported_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"cancelled_by_user_id" text,
	"cancelled_at" timestamp with time zone,
	"cancellation_reason" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "pdtp_obligations_mode_check" CHECK ("pdtp_obligations"."mode" IN ('on_demand', 'triggered')),
	CONSTRAINT "pdtp_obligations_status_check" CHECK ("pdtp_obligations"."status" IN ('pending', 'overdue', 'reported', 'completed', 'cancelled')),
	CONSTRAINT "pdtp_obligations_origin_check" CHECK ("pdtp_obligations"."origin" IN ('manual', 'integration')),
	CONSTRAINT "pdtp_obligations_quantity_check" CHECK ("pdtp_obligations"."planned_quantity" > 0 AND "pdtp_obligations"."completed_quantity" >= 0),
	CONSTRAINT "pdtp_obligations_manual_reason_check" CHECK ("pdtp_obligations"."origin" <> 'manual' OR length(trim(COALESCE("pdtp_obligations"."manual_reason", ''))) >= 10),
	CONSTRAINT "pdtp_obligations_cancel_reason_check" CHECK ("pdtp_obligations"."status" <> 'cancelled' OR length(trim(COALESCE("pdtp_obligations"."cancellation_reason", ''))) >= 10)
);
--> statement-breakpoint
DROP INDEX "pdtp_executions_activity_scope_period_unique";--> statement-breakpoint
ALTER TABLE "pdtp_executions" ADD COLUMN "obligation_id" text;--> statement-breakpoint
ALTER TABLE "pdtp_obligation_reminders" ADD CONSTRAINT "pdtp_obligation_reminders_obligation_id_pdtp_obligations_id_fk" FOREIGN KEY ("obligation_id") REFERENCES "public"."pdtp_obligations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdtp_obligation_reminders" ADD CONSTRAINT "pdtp_obligation_reminders_recipient_user_id_users_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdtp_obligations" ADD CONSTRAINT "pdtp_obligations_program_id_pdtp_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."pdtp_programs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdtp_obligations" ADD CONSTRAINT "pdtp_obligations_activity_id_pdtp_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."pdtp_activities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdtp_obligations" ADD CONSTRAINT "pdtp_obligations_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdtp_obligations" ADD CONSTRAINT "pdtp_obligations_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdtp_obligations" ADD CONSTRAINT "pdtp_obligations_cancelled_by_user_id_users_id_fk" FOREIGN KEY ("cancelled_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pdtp_obligation_reminders_dedupe_unique" ON "pdtp_obligation_reminders" USING btree ("obligation_id","recipient_user_id","reminder_window");--> statement-breakpoint
CREATE INDEX "pdtp_obligation_reminders_status_idx" ON "pdtp_obligation_reminders" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "pdtp_obligations_idempotency_key_unique" ON "pdtp_obligations" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "pdtp_obligations_scope_status_due_idx" ON "pdtp_obligations" USING btree ("worksite_id","status","due_at");--> statement-breakpoint
CREATE INDEX "pdtp_obligations_program_mode_idx" ON "pdtp_obligations" USING btree ("program_id","mode");--> statement-breakpoint
CREATE INDEX "pdtp_obligations_source_idx" ON "pdtp_obligations" USING btree ("source_type","source_id");--> statement-breakpoint
ALTER TABLE "pdtp_executions" ADD CONSTRAINT "pdtp_executions_obligation_id_pdtp_obligations_id_fk" FOREIGN KEY ("obligation_id") REFERENCES "public"."pdtp_obligations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pdtp_executions_obligation_unique" ON "pdtp_executions" USING btree ("obligation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pdtp_executions_activity_scope_period_unique" ON "pdtp_executions" USING btree ("activity_id","worksite_id","year","month","week") WHERE "pdtp_executions"."obligation_id" IS NULL;