CREATE TABLE "prevention_change_assessments" (
	"id" text PRIMARY KEY NOT NULL,
	"change_request_id" text NOT NULL,
	"dimension" text NOT NULL,
	"evaluated" boolean DEFAULT false NOT NULL,
	"impacted" boolean DEFAULT false NOT NULL,
	"notes" text,
	"action_required" boolean DEFAULT false NOT NULL,
	"capa_action_id" text,
	"evaluated_by_user_id" text,
	"evaluated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prevention_change_assessment_dimension_valid" CHECK ("prevention_change_assessments"."dimension" IN ('risk', 'permit', 'training', 'document', 'miper', 'emergency')),
	CONSTRAINT "prevention_change_assessment_evaluated_consistent" CHECK ("prevention_change_assessments"."evaluated" = false OR ("prevention_change_assessments"."evaluated_by_user_id" IS NOT NULL AND "prevention_change_assessments"."evaluated_at" IS NOT NULL)),
	CONSTRAINT "prevention_change_assessment_impact_consistent" CHECK ("prevention_change_assessments"."impacted" = true OR "prevention_change_assessments"."action_required" = false),
	CONSTRAINT "prevention_change_assessment_action_consistent" CHECK ("prevention_change_assessments"."action_required" = false OR "prevention_change_assessments"."capa_action_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "prevention_change_history" (
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
CREATE TABLE "prevention_change_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"worksite_id" text NOT NULL,
	"code" text NOT NULL,
	"title" text NOT NULL,
	"change_type" text NOT NULL,
	"description" text NOT NULL,
	"reason" text NOT NULL,
	"risk_level" text DEFAULT 'medium' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"planned_review_date" text,
	"requested_by_user_id" text NOT NULL,
	"approved_by_user_id" text,
	"approved_at" timestamp with time zone,
	"rejected_reason" text,
	"implemented_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prevention_change_requests_code_unique" UNIQUE("code"),
	CONSTRAINT "prevention_change_type_valid" CHECK ("prevention_change_requests"."change_type" IN ('proceso', 'instalacion', 'equipo', 'sustancia', 'proveedor', 'requisito_legal', 'dotacion', 'software', 'procedimiento', 'mandante')),
	CONSTRAINT "prevention_change_risk_level_valid" CHECK ("prevention_change_requests"."risk_level" IN ('low', 'medium', 'high', 'critical')),
	CONSTRAINT "prevention_change_status_valid" CHECK ("prevention_change_requests"."status" IN ('draft', 'under_evaluation', 'approved', 'rejected', 'implemented', 'closed')),
	CONSTRAINT "prevention_change_approved_consistent" CHECK (("prevention_change_requests"."status" <> 'approved') OR ("prevention_change_requests"."approved_by_user_id" IS NOT NULL AND "prevention_change_requests"."approved_at" IS NOT NULL AND "prevention_change_requests"."planned_review_date" IS NOT NULL)),
	CONSTRAINT "prevention_change_rejected_consistent" CHECK (("prevention_change_requests"."status" <> 'rejected') OR ("prevention_change_requests"."rejected_reason" IS NOT NULL AND length("prevention_change_requests"."rejected_reason") >= 5)),
	CONSTRAINT "prevention_change_version_positive" CHECK ("prevention_change_requests"."version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "prevention_change_assessments" ADD CONSTRAINT "prevention_change_assessments_change_request_id_prevention_change_requests_id_fk" FOREIGN KEY ("change_request_id") REFERENCES "public"."prevention_change_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_change_assessments" ADD CONSTRAINT "prevention_change_assessments_capa_action_id_prevention_capa_actions_id_fk" FOREIGN KEY ("capa_action_id") REFERENCES "public"."prevention_capa_actions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_change_assessments" ADD CONSTRAINT "prevention_change_assessments_evaluated_by_user_id_users_id_fk" FOREIGN KEY ("evaluated_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_change_history" ADD CONSTRAINT "prevention_change_history_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_change_history" ADD CONSTRAINT "prevention_change_history_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_change_requests" ADD CONSTRAINT "prevention_change_requests_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_change_requests" ADD CONSTRAINT "prevention_change_requests_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_change_requests" ADD CONSTRAINT "prevention_change_requests_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "prevention_change_assessment_unique" ON "prevention_change_assessments" USING btree ("change_request_id","dimension");--> statement-breakpoint
CREATE INDEX "prevention_change_assessment_request_idx" ON "prevention_change_assessments" USING btree ("change_request_id");--> statement-breakpoint
CREATE INDEX "prevention_change_history_entity_idx" ON "prevention_change_history" USING btree ("entity_type","entity_id","created_at");