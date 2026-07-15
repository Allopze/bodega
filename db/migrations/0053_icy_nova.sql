CREATE TABLE "fuel_seal_movements" (
	"id" text PRIMARY KEY NOT NULL,
	"submission_id" text NOT NULL,
	"seal_number" text NOT NULL,
	"movement_type" text NOT NULL,
	"changed_by" text,
	"justification" text,
	"is_exception" boolean DEFAULT false NOT NULL,
	"evidence_file_name" text,
	"evidence_file_path" text,
	"evidence_sha256" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fuel_seal_movements_type_valid" CHECK ("fuel_seal_movements"."movement_type" IN ('removed', 'installed'))
);
--> statement-breakpoint
CREATE TABLE "fuel_anomaly_cases" (
	"id" text PRIMARY KEY NOT NULL,
	"rule_id" text NOT NULL,
	"rule_code" text NOT NULL,
	"severity" text DEFAULT 'medium' NOT NULL,
	"worksite_id" text,
	"vehicle_id" text,
	"reference_entity_type" text,
	"reference_entity_id" text,
	"description" text NOT NULL,
	"observed_value" text,
	"expected_value" text,
	"status" text DEFAULT 'open' NOT NULL,
	"assignee_id" text,
	"resolution" text,
	"resolved_by_id" text,
	"resolved_at" timestamp with time zone,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fuel_anomaly_cases_severity_valid" CHECK ("fuel_anomaly_cases"."severity" IN ('low', 'medium', 'high', 'critical')),
	CONSTRAINT "fuel_anomaly_cases_status_valid" CHECK ("fuel_anomaly_cases"."status" IN ('open', 'in_review', 'resolved', 'dismissed', 'reopened'))
);
--> statement-breakpoint
CREATE TABLE "fuel_anomaly_comments" (
	"id" text PRIMARY KEY NOT NULL,
	"case_id" text NOT NULL,
	"user_id" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fuel_anomaly_executions" (
	"id" text PRIMARY KEY NOT NULL,
	"rule_id" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"cases_created" integer DEFAULT 0 NOT NULL,
	"cases_skipped" integer DEFAULT 0 NOT NULL,
	"total_scanned" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"error" text,
	CONSTRAINT "fuel_anomaly_executions_status_valid" CHECK ("fuel_anomaly_executions"."status" IN ('running', 'completed', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "fuel_anomaly_rules" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"severity" text DEFAULT 'medium' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"config" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fuel_anomaly_rules_code_unique" UNIQUE("code"),
	CONSTRAINT "fuel_anomaly_rules_severity_valid" CHECK ("fuel_anomaly_rules"."severity" IN ('low', 'medium', 'high', 'critical'))
);
--> statement-breakpoint
ALTER TABLE "fuel_seal_movements" ADD CONSTRAINT "fuel_seal_movements_submission_id_fuel_tae_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."fuel_tae_submissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_seal_movements" ADD CONSTRAINT "fuel_seal_movements_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_anomaly_cases" ADD CONSTRAINT "fuel_anomaly_cases_rule_id_fuel_anomaly_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."fuel_anomaly_rules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_anomaly_cases" ADD CONSTRAINT "fuel_anomaly_cases_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_anomaly_cases" ADD CONSTRAINT "fuel_anomaly_cases_vehicle_id_fuel_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."fuel_vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_anomaly_cases" ADD CONSTRAINT "fuel_anomaly_cases_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_anomaly_cases" ADD CONSTRAINT "fuel_anomaly_cases_resolved_by_id_users_id_fk" FOREIGN KEY ("resolved_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_anomaly_comments" ADD CONSTRAINT "fuel_anomaly_comments_case_id_fuel_anomaly_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."fuel_anomaly_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_anomaly_comments" ADD CONSTRAINT "fuel_anomaly_comments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_anomaly_executions" ADD CONSTRAINT "fuel_anomaly_executions_rule_id_fuel_anomaly_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."fuel_anomaly_rules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_anomaly_rules" ADD CONSTRAINT "fuel_anomaly_rules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fuel_seal_movements_submission_idx" ON "fuel_seal_movements" USING btree ("submission_id");--> statement-breakpoint
CREATE INDEX "fuel_seal_movements_seal_number_idx" ON "fuel_seal_movements" USING btree ("seal_number");--> statement-breakpoint
CREATE INDEX "fuel_seal_movements_type_idx" ON "fuel_seal_movements" USING btree ("movement_type");--> statement-breakpoint
CREATE INDEX "fuel_anomaly_cases_rule_idx" ON "fuel_anomaly_cases" USING btree ("rule_id");--> statement-breakpoint
CREATE INDEX "fuel_anomaly_cases_status_idx" ON "fuel_anomaly_cases" USING btree ("status");--> statement-breakpoint
CREATE INDEX "fuel_anomaly_cases_worksite_idx" ON "fuel_anomaly_cases" USING btree ("worksite_id");--> statement-breakpoint
CREATE INDEX "fuel_anomaly_cases_reference_idx" ON "fuel_anomaly_cases" USING btree ("reference_entity_type","reference_entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fuel_anomaly_cases_unique_open" ON "fuel_anomaly_cases" USING btree ("rule_code","reference_entity_type","reference_entity_id") WHERE "fuel_anomaly_cases"."status" IN ('open', 'in_review', 'reopened');--> statement-breakpoint
CREATE INDEX "fuel_anomaly_comments_case_idx" ON "fuel_anomaly_comments" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "fuel_anomaly_executions_rule_idx" ON "fuel_anomaly_executions" USING btree ("rule_id");--> statement-breakpoint
CREATE INDEX "fuel_anomaly_executions_status_idx" ON "fuel_anomaly_executions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "fuel_anomaly_rules_code_idx" ON "fuel_anomaly_rules" USING btree ("code");--> statement-breakpoint
CREATE INDEX "fuel_anomaly_rules_active_idx" ON "fuel_anomaly_rules" USING btree ("is_active");