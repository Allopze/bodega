CREATE TABLE "prevention_epp_history" (
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
CREATE TABLE "prevention_epp_requirements" (
	"id" text PRIMARY KEY NOT NULL,
	"epp_type_id" text NOT NULL,
	"scope_type" text NOT NULL,
	"scope_value" text,
	"worksite_id" text,
	"enforcement" text DEFAULT 'warning' NOT NULL,
	"reason" text NOT NULL,
	"legal_requirement_id" text,
	"risk_entry_id" text,
	"preferred_family_id" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prevention_epp_requirement_scope_valid" CHECK ("prevention_epp_requirements"."scope_type" IN ('global', 'worksite', 'position', 'task')),
	CONSTRAINT "prevention_epp_requirement_enforcement_valid" CHECK ("prevention_epp_requirements"."enforcement" IN ('blocking', 'warning')),
	CONSTRAINT "prevention_epp_requirement_reason_valid" CHECK (length("prevention_epp_requirements"."reason") >= 10),
	CONSTRAINT "prevention_epp_requirement_scope_value_present" CHECK ("prevention_epp_requirements"."scope_type" IN ('global', 'worksite') OR length("prevention_epp_requirements"."scope_value") >= 1)
);
--> statement-breakpoint
ALTER TABLE "prevention_capa_actions" DROP CONSTRAINT "prevention_capa_source_type_valid";--> statement-breakpoint
ALTER TABLE "prevention_epp_history" ADD CONSTRAINT "prevention_epp_history_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_epp_history" ADD CONSTRAINT "prevention_epp_history_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_epp_requirements" ADD CONSTRAINT "prevention_epp_requirements_epp_type_id_epp_types_id_fk" FOREIGN KEY ("epp_type_id") REFERENCES "public"."epp_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_epp_requirements" ADD CONSTRAINT "prevention_epp_requirements_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_epp_requirements" ADD CONSTRAINT "prevention_epp_requirements_legal_requirement_id_prevention_legal_requirements_id_fk" FOREIGN KEY ("legal_requirement_id") REFERENCES "public"."prevention_legal_requirements"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_epp_requirements" ADD CONSTRAINT "prevention_epp_requirements_risk_entry_id_prevention_risk_entries_id_fk" FOREIGN KEY ("risk_entry_id") REFERENCES "public"."prevention_risk_entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_epp_requirements" ADD CONSTRAINT "prevention_epp_requirements_preferred_family_id_epp_product_families_id_fk" FOREIGN KEY ("preferred_family_id") REFERENCES "public"."epp_product_families"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_epp_requirements" ADD CONSTRAINT "prevention_epp_requirements_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "prevention_epp_history_entity_idx" ON "prevention_epp_history" USING btree ("entity_type","entity_id","created_at");--> statement-breakpoint
CREATE INDEX "prevention_epp_requirement_scope_idx" ON "prevention_epp_requirements" USING btree ("scope_type","is_active");--> statement-breakpoint
CREATE INDEX "prevention_epp_requirement_worksite_idx" ON "prevention_epp_requirements" USING btree ("worksite_id","is_active");--> statement-breakpoint
ALTER TABLE "prevention_capa_actions" ADD CONSTRAINT "prevention_capa_source_type_valid" CHECK ("prevention_capa_actions"."source_type" IN ('pdtp', 'sst_evaluation', 'ppa', 'incident', 'risk', 'legal_requirement', 'training', 'work_permit', 'inspection', 'cphs', 'emergency', 'change', 'epp', 'manual'));