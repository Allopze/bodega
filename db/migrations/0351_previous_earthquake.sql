CREATE TABLE "prevention_incident_re20_policy" (
	"id" text PRIMARY KEY NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"policy" jsonb NOT NULL,
	"updated_by_user_id" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "prevention_incident_re20_policy_version_positive" CHECK ("prevention_incident_re20_policy"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "prevention_incident_re20_quality_reviews" (
	"id" text PRIMARY KEY NOT NULL,
	"incident_id" text NOT NULL,
	"workspace_version" integer NOT NULL,
	"criteria" jsonb NOT NULL,
	"decision" text NOT NULL,
	"observation" text,
	"reviewer_role" text DEFAULT 'RE-20 quality reviewer' NOT NULL,
	"reviewer_user_id" text NOT NULL,
	"reviewed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "prevention_incident_re20_review_version_positive" CHECK ("prevention_incident_re20_quality_reviews"."workspace_version" >= 1),
	CONSTRAINT "prevention_incident_re20_review_decision_valid" CHECK ("prevention_incident_re20_quality_reviews"."decision" IN ('approved', 'changes_required'))
);
--> statement-breakpoint
CREATE TABLE "prevention_incident_re20_workspaces" (
	"id" text PRIMARY KEY NOT NULL,
	"incident_id" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"policy_version" integer DEFAULT 1 NOT NULL,
	"policy_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"encrypted_sensitive_payload" text,
	"sensitive_iv" text,
	"sensitive_auth_tag" text,
	"sensitive_key_version" text,
	"created_by_user_id" text NOT NULL,
	"updated_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "prevention_incident_re20_workspace_version_positive" CHECK ("prevention_incident_re20_workspaces"."version" >= 1),
	CONSTRAINT "prevention_incident_re20_policy_version_positive" CHECK ("prevention_incident_re20_workspaces"."policy_version" >= 1),
	CONSTRAINT "prevention_incident_re20_sensitive_payload_complete" CHECK (
    ("prevention_incident_re20_workspaces"."encrypted_sensitive_payload" IS NULL AND "prevention_incident_re20_workspaces"."sensitive_iv" IS NULL AND "prevention_incident_re20_workspaces"."sensitive_auth_tag" IS NULL AND "prevention_incident_re20_workspaces"."sensitive_key_version" IS NULL)
    OR ("prevention_incident_re20_workspaces"."encrypted_sensitive_payload" IS NOT NULL AND "prevention_incident_re20_workspaces"."sensitive_iv" IS NOT NULL AND "prevention_incident_re20_workspaces"."sensitive_auth_tag" IS NOT NULL AND "prevention_incident_re20_workspaces"."sensitive_key_version" IS NOT NULL)
  )
);
--> statement-breakpoint
ALTER TABLE "prevention_incident_classification_catalog" DROP CONSTRAINT IF EXISTS "prevention_incident_classification_cat_valid";--> statement-breakpoint
ALTER TABLE "prevention_incident_statements" ALTER COLUMN "deponent_name" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "prevention_incident_statements" ALTER COLUMN "statement_text" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "prevention_incident_statements" ADD COLUMN "encrypted_payload" text;--> statement-breakpoint
ALTER TABLE "prevention_incident_statements" ADD COLUMN "encrypted_iv" text;--> statement-breakpoint
ALTER TABLE "prevention_incident_statements" ADD COLUMN "encrypted_auth_tag" text;--> statement-breakpoint
ALTER TABLE "prevention_incident_statements" ADD COLUMN "encrypted_key_version" text;--> statement-breakpoint
ALTER TABLE "prevention_incident_re20_policy" ADD CONSTRAINT "prevention_incident_re20_policy_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_incident_re20_quality_reviews" ADD CONSTRAINT "prevention_incident_re20_quality_reviews_incident_id_prevention_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."prevention_incidents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_incident_re20_quality_reviews" ADD CONSTRAINT "prevention_incident_re20_quality_reviews_reviewer_user_id_users_id_fk" FOREIGN KEY ("reviewer_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_incident_re20_workspaces" ADD CONSTRAINT "prevention_incident_re20_workspaces_incident_id_prevention_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."prevention_incidents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_incident_re20_workspaces" ADD CONSTRAINT "prevention_incident_re20_workspaces_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_incident_re20_workspaces" ADD CONSTRAINT "prevention_incident_re20_workspaces_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "prevention_incident_re20_review_version_unique" ON "prevention_incident_re20_quality_reviews" USING btree ("incident_id","workspace_version","reviewed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "prevention_incident_re20_workspace_incident_unique" ON "prevention_incident_re20_workspaces" USING btree ("incident_id");--> statement-breakpoint
ALTER TABLE "prevention_incident_classification_catalog" ADD CONSTRAINT "prevention_incident_classification_cat_valid" CHECK ("prevention_incident_classification_catalog"."category" IN (
    'event_type', 'mutual_classification', 'potential_severity', 'mutual_status', 'situation', 'activity', 'accident_type', 'causal_agent', 'agent_category', 'source', 'body_zone', 'loss',
    'temperature', 'weather', 'shift_system', 'physical_conditions', 'causal_event_id', 'causal_relation', 'control_type', 'corrective_preventive', 'action_scope', 'priority',
    'action_status', 'effectiveness', 'residual_risk', 'evidence_type', 'declarant_quality', 'investigation_role', 'quality_result', 'review_result', 'cphs_decision',
    'yes_no', 'yes_no_unverified', 'yes_no_not_applicable', 'authorization_license', 'worker_sex', 'legacy_substandard_act', 'legacy_substandard_condition',
    'legacy_personal_factor', 'legacy_work_factor', 'legacy_root_cause', 'legacy_probability', 'legacy_severity', 'legacy_marital_status', 'legacy_incident_type'
  ));--> statement-breakpoint
ALTER TABLE "prevention_incident_statements" ADD CONSTRAINT "prevention_incident_statement_payload_complete" CHECK (
    ("prevention_incident_statements"."encrypted_payload" IS NULL AND "prevention_incident_statements"."encrypted_iv" IS NULL AND "prevention_incident_statements"."encrypted_auth_tag" IS NULL AND "prevention_incident_statements"."encrypted_key_version" IS NULL AND "prevention_incident_statements"."statement_text" IS NOT NULL)
    OR ("prevention_incident_statements"."encrypted_payload" IS NOT NULL AND "prevention_incident_statements"."encrypted_iv" IS NOT NULL AND "prevention_incident_statements"."encrypted_auth_tag" IS NOT NULL AND "prevention_incident_statements"."encrypted_key_version" IS NOT NULL AND "prevention_incident_statements"."statement_text" IS NULL)
  );
