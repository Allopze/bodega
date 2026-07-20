CREATE TABLE "prevention_emergency_contacts" (
	"id" text PRIMARY KEY NOT NULL,
	"plan_id" text NOT NULL,
	"name" text NOT NULL,
	"org" text NOT NULL,
	"role" text,
	"phone" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prevention_emergency_drill_participants" (
	"id" text PRIMARY KEY NOT NULL,
	"drill_id" text NOT NULL,
	"worker_id" text NOT NULL,
	"present" boolean DEFAULT true NOT NULL,
	"role_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prevention_emergency_drills" (
	"id" text PRIMARY KEY NOT NULL,
	"plan_id" text NOT NULL,
	"worksite_id" text NOT NULL,
	"scenario_type" text NOT NULL,
	"scheduled_for" timestamp with time zone NOT NULL,
	"executed_at" timestamp with time zone,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"duration_minutes" integer,
	"evacuation_seconds" integer,
	"observations" text,
	"outcome" text,
	"capa_action_id" text,
	"created_by_user_id" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prevention_emergency_drill_scenario_type_valid" CHECK ("prevention_emergency_drills"."scenario_type" IN ('incendio', 'derrame', 'fuga', 'volcamiento', 'exposicion', 'rescate', 'sismo', 'clima', 'otro')),
	CONSTRAINT "prevention_emergency_drill_status_valid" CHECK ("prevention_emergency_drills"."status" IN ('scheduled', 'completed', 'cancelled')),
	CONSTRAINT "prevention_emergency_drill_outcome_valid" CHECK ("prevention_emergency_drills"."outcome" IS NULL OR "prevention_emergency_drills"."outcome" IN ('satisfactory', 'needs_improvement')),
	CONSTRAINT "prevention_emergency_drill_completed_consistent" CHECK ("prevention_emergency_drills"."status" <> 'completed' OR ("prevention_emergency_drills"."executed_at" IS NOT NULL AND "prevention_emergency_drills"."outcome" IS NOT NULL)),
	CONSTRAINT "prevention_emergency_drill_version_positive" CHECK ("prevention_emergency_drills"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "prevention_emergency_history" (
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
CREATE TABLE "prevention_emergency_plans" (
	"id" text PRIMARY KEY NOT NULL,
	"worksite_id" text NOT NULL,
	"code" text NOT NULL,
	"title" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"description" text,
	"approved_by_user_id" text,
	"approved_at" timestamp with time zone,
	"created_by_user_id" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prevention_emergency_plans_code_unique" UNIQUE("code"),
	CONSTRAINT "prevention_emergency_plan_status_valid" CHECK ("prevention_emergency_plans"."status" IN ('draft', 'approved', 'archived')),
	CONSTRAINT "prevention_emergency_plan_approved_consistent" CHECK (("prevention_emergency_plans"."status" <> 'approved') OR ("prevention_emergency_plans"."approved_by_user_id" IS NOT NULL AND "prevention_emergency_plans"."approved_at" IS NOT NULL)),
	CONSTRAINT "prevention_emergency_plan_version_positive" CHECK ("prevention_emergency_plans"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "prevention_emergency_resources" (
	"id" text PRIMARY KEY NOT NULL,
	"plan_id" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"location" text NOT NULL,
	"last_inspected_at" text,
	"next_inspection_at" text,
	"status" text DEFAULT 'operational' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prevention_emergency_resource_status_valid" CHECK ("prevention_emergency_resources"."status" IN ('operational', 'needs_maintenance', 'out_of_service'))
);
--> statement-breakpoint
CREATE TABLE "prevention_emergency_roles" (
	"id" text PRIMARY KEY NOT NULL,
	"plan_id" text NOT NULL,
	"role_name" text NOT NULL,
	"assignee_worker_id" text NOT NULL,
	"backup_worker_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prevention_emergency_scenarios" (
	"id" text PRIMARY KEY NOT NULL,
	"plan_id" text NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"response_procedure" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prevention_emergency_scenario_type_valid" CHECK ("prevention_emergency_scenarios"."type" IN ('incendio', 'derrame', 'fuga', 'volcamiento', 'exposicion', 'rescate', 'sismo', 'clima', 'otro'))
);
--> statement-breakpoint
ALTER TABLE "prevention_capa_actions" DROP CONSTRAINT "prevention_capa_source_type_valid";--> statement-breakpoint
ALTER TABLE "prevention_emergency_contacts" ADD CONSTRAINT "prevention_emergency_contacts_plan_id_prevention_emergency_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."prevention_emergency_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_emergency_drill_participants" ADD CONSTRAINT "prevention_emergency_drill_participants_drill_id_prevention_emergency_drills_id_fk" FOREIGN KEY ("drill_id") REFERENCES "public"."prevention_emergency_drills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_emergency_drill_participants" ADD CONSTRAINT "prevention_emergency_drill_participants_worker_id_workers_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_emergency_drills" ADD CONSTRAINT "prevention_emergency_drills_plan_id_prevention_emergency_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."prevention_emergency_plans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_emergency_drills" ADD CONSTRAINT "prevention_emergency_drills_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_emergency_drills" ADD CONSTRAINT "prevention_emergency_drills_capa_action_id_prevention_capa_actions_id_fk" FOREIGN KEY ("capa_action_id") REFERENCES "public"."prevention_capa_actions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_emergency_drills" ADD CONSTRAINT "prevention_emergency_drills_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_emergency_history" ADD CONSTRAINT "prevention_emergency_history_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_emergency_history" ADD CONSTRAINT "prevention_emergency_history_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_emergency_plans" ADD CONSTRAINT "prevention_emergency_plans_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_emergency_plans" ADD CONSTRAINT "prevention_emergency_plans_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_emergency_plans" ADD CONSTRAINT "prevention_emergency_plans_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_emergency_resources" ADD CONSTRAINT "prevention_emergency_resources_plan_id_prevention_emergency_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."prevention_emergency_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_emergency_roles" ADD CONSTRAINT "prevention_emergency_roles_plan_id_prevention_emergency_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."prevention_emergency_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_emergency_roles" ADD CONSTRAINT "prevention_emergency_roles_assignee_worker_id_workers_id_fk" FOREIGN KEY ("assignee_worker_id") REFERENCES "public"."workers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_emergency_roles" ADD CONSTRAINT "prevention_emergency_roles_backup_worker_id_workers_id_fk" FOREIGN KEY ("backup_worker_id") REFERENCES "public"."workers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_emergency_scenarios" ADD CONSTRAINT "prevention_emergency_scenarios_plan_id_prevention_emergency_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."prevention_emergency_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "prevention_emergency_contact_plan_idx" ON "prevention_emergency_contacts" USING btree ("plan_id");--> statement-breakpoint
CREATE UNIQUE INDEX "prevention_emergency_drill_participant_unique" ON "prevention_emergency_drill_participants" USING btree ("drill_id","worker_id");--> statement-breakpoint
CREATE INDEX "prevention_emergency_drill_plan_idx" ON "prevention_emergency_drills" USING btree ("plan_id","scheduled_for");--> statement-breakpoint
CREATE INDEX "prevention_emergency_history_entity_idx" ON "prevention_emergency_history" USING btree ("entity_type","entity_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "prevention_emergency_plan_active_worksite_unique" ON "prevention_emergency_plans" USING btree ("worksite_id") WHERE "prevention_emergency_plans"."status" <> 'archived';--> statement-breakpoint
CREATE INDEX "prevention_emergency_resource_plan_idx" ON "prevention_emergency_resources" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX "prevention_emergency_role_plan_idx" ON "prevention_emergency_roles" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX "prevention_emergency_scenario_plan_idx" ON "prevention_emergency_scenarios" USING btree ("plan_id");--> statement-breakpoint
ALTER TABLE "prevention_capa_actions" ADD CONSTRAINT "prevention_capa_source_type_valid" CHECK ("prevention_capa_actions"."source_type" IN ('pdtp', 'sst_evaluation', 'ppa', 'incident', 'risk', 'legal_requirement', 'training', 'work_permit', 'inspection', 'cphs', 'emergency', 'change', 'manual'));