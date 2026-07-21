CREATE TABLE "prevention_inspection_answers" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"section_id" text NOT NULL,
	"item_id" text NOT NULL,
	"item_label" text NOT NULL,
	"result" text NOT NULL,
	"value" text,
	"comment" text,
	"evidence_reference" text,
	"dano_potencial" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prevention_inspection_answer_result_valid" CHECK ("prevention_inspection_answers"."result" IN ('conforming', 'non_conforming', 'not_applicable')),
	CONSTRAINT "prevention_inspection_answer_na_has_comment" CHECK ("prevention_inspection_answers"."result" <> 'not_applicable' OR length("prevention_inspection_answers"."comment") >= 3),
	CONSTRAINT "prevention_inspection_answer_dano_valid" CHECK ("prevention_inspection_answers"."dano_potencial" IS NULL OR "prevention_inspection_answers"."dano_potencial" IN ('leve', 'moderado', 'grave', 'fatal'))
);
--> statement-breakpoint
CREATE TABLE "prevention_inspection_findings" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"answer_id" text,
	"description" text NOT NULL,
	"criticality" text NOT NULL,
	"immediate_measure" text,
	"capa_action_id" text,
	"status" text DEFAULT 'open' NOT NULL,
	"closed_by_user_id" text,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prevention_inspection_finding_criticality_valid" CHECK ("prevention_inspection_findings"."criticality" IN ('low', 'medium', 'high', 'critical')),
	CONSTRAINT "prevention_inspection_finding_status_valid" CHECK ("prevention_inspection_findings"."status" IN ('open', 'capa_linked', 'closed')),
	CONSTRAINT "prevention_inspection_finding_closed_consistent" CHECK (("prevention_inspection_findings"."closed_at" IS NULL AND "prevention_inspection_findings"."closed_by_user_id" IS NULL) OR ("prevention_inspection_findings"."closed_at" IS NOT NULL AND "prevention_inspection_findings"."closed_by_user_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "prevention_inspection_history" (
	"id" text PRIMARY KEY NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"worksite_id" text,
	"change_type" text NOT NULL,
	"reason" text NOT NULL,
	"before_state" jsonb,
	"after_state" jsonb,
	"actor_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prevention_inspection_programs" (
	"id" text PRIMARY KEY NOT NULL,
	"template_id" text NOT NULL,
	"worksite_id" text NOT NULL,
	"frequency" text NOT NULL,
	"interval_days" integer NOT NULL,
	"next_due_on" text NOT NULL,
	"assigned_to_user_id" text,
	"risk_entry_id" text,
	"subject_type" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prevention_inspection_program_frequency_valid" CHECK ("prevention_inspection_programs"."frequency" IN ('daily', 'weekly', 'biweekly', 'monthly', 'quarterly', 'biannual', 'annual', 'on_demand')),
	CONSTRAINT "prevention_inspection_program_interval_positive" CHECK ("prevention_inspection_programs"."interval_days" > 0)
);
--> statement-breakpoint
CREATE TABLE "prevention_inspection_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"template_id" text NOT NULL,
	"program_id" text,
	"worksite_id" text NOT NULL,
	"subject_type" text,
	"subject_label" text,
	"scheduled_for" text,
	"status" text DEFAULT 'planned' NOT NULL,
	"assigned_to_user_id" text,
	"executed_by_user_id" text,
	"executed_at" timestamp with time zone,
	"reviewed_by_user_id" text,
	"reviewed_at" timestamp with time zone,
	"review_comment" text,
	"cancelled_by_user_id" text,
	"cancelled_at" timestamp with time zone,
	"cancellation_reason" text,
	"conforming_count" integer DEFAULT 0 NOT NULL,
	"non_conforming_count" integer DEFAULT 0 NOT NULL,
	"not_applicable_count" integer DEFAULT 0 NOT NULL,
	"compliance_percent" integer,
	"location_latitude" text,
	"location_longitude" text,
	"client_submission_id" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prevention_inspection_runs_code_unique" UNIQUE("code"),
	CONSTRAINT "prevention_inspection_run_status_valid" CHECK ("prevention_inspection_runs"."status" IN ('planned', 'in_progress', 'completed', 'reviewed', 'cancelled')),
	CONSTRAINT "prevention_inspection_run_compliance_valid" CHECK ("prevention_inspection_runs"."compliance_percent" IS NULL OR "prevention_inspection_runs"."compliance_percent" BETWEEN 0 AND 100),
	CONSTRAINT "prevention_inspection_run_counts_nonnegative" CHECK ("prevention_inspection_runs"."conforming_count" >= 0 AND "prevention_inspection_runs"."non_conforming_count" >= 0 AND "prevention_inspection_runs"."not_applicable_count" >= 0),
	CONSTRAINT "prevention_inspection_run_cancel_consistent" CHECK (("prevention_inspection_runs"."cancelled_at" IS NULL AND "prevention_inspection_runs"."cancelled_by_user_id" IS NULL) OR ("prevention_inspection_runs"."cancelled_at" IS NOT NULL AND "prevention_inspection_runs"."cancelled_by_user_id" IS NOT NULL AND length("prevention_inspection_runs"."cancellation_reason") >= 5)),
	CONSTRAINT "prevention_inspection_run_review_consistent" CHECK (("prevention_inspection_runs"."reviewed_at" IS NULL AND "prevention_inspection_runs"."reviewed_by_user_id" IS NULL) OR ("prevention_inspection_runs"."reviewed_at" IS NOT NULL AND "prevention_inspection_runs"."reviewed_by_user_id" IS NOT NULL)),
	CONSTRAINT "prevention_inspection_run_version_positive" CHECK ("prevention_inspection_runs"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "prevention_inspection_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"version_label" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"source_definition_code" text,
	"definition_snapshot" jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"legal_framework" text,
	"author_user_id" text NOT NULL,
	"approved_by_user_id" text,
	"approved_at" timestamp with time zone,
	"superseded_at" timestamp with time zone,
	"superseded_by_template_id" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prevention_inspection_template_kind_valid" CHECK ("prevention_inspection_templates"."kind" IN ('inspection', 'observation', 'audit')),
	CONSTRAINT "prevention_inspection_template_status_valid" CHECK ("prevention_inspection_templates"."status" IN ('draft', 'approved', 'superseded')),
	CONSTRAINT "prevention_inspection_template_hash_valid" CHECK (length("prevention_inspection_templates"."content_hash") = 64),
	CONSTRAINT "prevention_inspection_template_approved_consistent" CHECK ("prevention_inspection_templates"."status" <> 'approved' OR ("prevention_inspection_templates"."approved_by_user_id" IS NOT NULL AND "prevention_inspection_templates"."approved_at" IS NOT NULL)),
	CONSTRAINT "prevention_inspection_template_version_positive" CHECK ("prevention_inspection_templates"."version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "prevention_capa_actions" DROP CONSTRAINT "prevention_capa_source_type_valid";--> statement-breakpoint
ALTER TABLE "prevention_inspection_answers" ADD CONSTRAINT "prevention_inspection_answers_run_id_prevention_inspection_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."prevention_inspection_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_inspection_findings" ADD CONSTRAINT "prevention_inspection_findings_run_id_prevention_inspection_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."prevention_inspection_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_inspection_findings" ADD CONSTRAINT "prevention_inspection_findings_answer_id_prevention_inspection_answers_id_fk" FOREIGN KEY ("answer_id") REFERENCES "public"."prevention_inspection_answers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_inspection_findings" ADD CONSTRAINT "prevention_inspection_findings_capa_action_id_prevention_capa_actions_id_fk" FOREIGN KEY ("capa_action_id") REFERENCES "public"."prevention_capa_actions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_inspection_findings" ADD CONSTRAINT "prevention_inspection_findings_closed_by_user_id_users_id_fk" FOREIGN KEY ("closed_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_inspection_history" ADD CONSTRAINT "prevention_inspection_history_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_inspection_history" ADD CONSTRAINT "prevention_inspection_history_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_inspection_programs" ADD CONSTRAINT "prevention_inspection_programs_template_id_prevention_inspection_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."prevention_inspection_templates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_inspection_programs" ADD CONSTRAINT "prevention_inspection_programs_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_inspection_programs" ADD CONSTRAINT "prevention_inspection_programs_assigned_to_user_id_users_id_fk" FOREIGN KEY ("assigned_to_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_inspection_programs" ADD CONSTRAINT "prevention_inspection_programs_risk_entry_id_prevention_risk_entries_id_fk" FOREIGN KEY ("risk_entry_id") REFERENCES "public"."prevention_risk_entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_inspection_programs" ADD CONSTRAINT "prevention_inspection_programs_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_inspection_runs" ADD CONSTRAINT "prevention_inspection_runs_template_id_prevention_inspection_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."prevention_inspection_templates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_inspection_runs" ADD CONSTRAINT "prevention_inspection_runs_program_id_prevention_inspection_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."prevention_inspection_programs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_inspection_runs" ADD CONSTRAINT "prevention_inspection_runs_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_inspection_runs" ADD CONSTRAINT "prevention_inspection_runs_assigned_to_user_id_users_id_fk" FOREIGN KEY ("assigned_to_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_inspection_runs" ADD CONSTRAINT "prevention_inspection_runs_executed_by_user_id_users_id_fk" FOREIGN KEY ("executed_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_inspection_runs" ADD CONSTRAINT "prevention_inspection_runs_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_inspection_runs" ADD CONSTRAINT "prevention_inspection_runs_cancelled_by_user_id_users_id_fk" FOREIGN KEY ("cancelled_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_inspection_runs" ADD CONSTRAINT "prevention_inspection_runs_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_inspection_templates" ADD CONSTRAINT "prevention_inspection_templates_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_inspection_templates" ADD CONSTRAINT "prevention_inspection_templates_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "prevention_inspection_answer_unique" ON "prevention_inspection_answers" USING btree ("run_id","section_id","item_id");--> statement-breakpoint
CREATE INDEX "prevention_inspection_finding_run_idx" ON "prevention_inspection_findings" USING btree ("run_id","status");--> statement-breakpoint
CREATE INDEX "prevention_inspection_history_entity_idx" ON "prevention_inspection_history" USING btree ("entity_type","entity_id","created_at");--> statement-breakpoint
CREATE INDEX "prevention_inspection_program_due_idx" ON "prevention_inspection_programs" USING btree ("next_due_on","is_active");--> statement-breakpoint
CREATE INDEX "prevention_inspection_program_worksite_idx" ON "prevention_inspection_programs" USING btree ("worksite_id","is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "prevention_inspection_run_submission_unique" ON "prevention_inspection_runs" USING btree ("client_submission_id") WHERE "prevention_inspection_runs"."client_submission_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "prevention_inspection_run_worksite_idx" ON "prevention_inspection_runs" USING btree ("worksite_id","status");--> statement-breakpoint
CREATE INDEX "prevention_inspection_run_template_idx" ON "prevention_inspection_runs" USING btree ("template_id","executed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "prevention_inspection_template_version_unique" ON "prevention_inspection_templates" USING btree ("code","version_label");--> statement-breakpoint
CREATE INDEX "prevention_inspection_template_status_idx" ON "prevention_inspection_templates" USING btree ("code","status");--> statement-breakpoint
ALTER TABLE "prevention_capa_actions" ADD CONSTRAINT "prevention_capa_source_type_valid" CHECK ("prevention_capa_actions"."source_type" IN ('pdtp', 'sst_evaluation', 'ppa', 'incident', 'risk', 'legal_requirement', 'training', 'contractor', 'work_permit', 'inspection', 'manual'));