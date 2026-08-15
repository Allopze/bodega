CREATE TABLE "prevention_certification_dossiers" (
	"id" text PRIMARY KEY NOT NULL,
	"committee_id" text NOT NULL,
	"level" text DEFAULT 'bronce' NOT NULL,
	"period_year" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"adherence_confirmed" boolean DEFAULT false NOT NULL,
	"sagecop_registered" boolean DEFAULT false NOT NULL,
	"sagecop_reference" text,
	"contributions_status" text,
	"audited_from" text,
	"audited_to" text,
	"audited_on" text,
	"audit_result" text,
	"gaps_deadline_on" text,
	"valid_until_on" text,
	"submitted_at" timestamp with time zone,
	"submitted_by_user_id" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prevention_certification_dossier_level_valid" CHECK ("prevention_certification_dossiers"."level" IN ('bronce', 'plata', 'oro')),
	CONSTRAINT "prevention_certification_dossier_status_valid" CHECK ("prevention_certification_dossiers"."status" IN ('draft', 'submitted', 'certified', 'rejected')),
	CONSTRAINT "prevention_certification_dossier_year_valid" CHECK ("prevention_certification_dossiers"."period_year" BETWEEN 2020 AND 2100),
	CONSTRAINT "prevention_certification_dossier_period_valid" CHECK ("prevention_certification_dossiers"."audited_from" IS NULL OR "prevention_certification_dossiers"."audited_to" IS NULL OR "prevention_certification_dossiers"."audited_to" >= "prevention_certification_dossiers"."audited_from"),
	CONSTRAINT "prevention_certification_dossier_submit_consistent" CHECK ("prevention_certification_dossiers"."status" = 'draft' OR ("prevention_certification_dossiers"."submitted_at" IS NOT NULL AND "prevention_certification_dossiers"."submitted_by_user_id" IS NOT NULL)),
	CONSTRAINT "prevention_certification_dossier_version_positive" CHECK ("prevention_certification_dossiers"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "prevention_certification_evaluations" (
	"id" text PRIMARY KEY NOT NULL,
	"dossier_id" text NOT NULL,
	"requirement_code" text NOT NULL,
	"status" text NOT NULL,
	"source" text NOT NULL,
	"detail" text,
	"evidence_reference" text,
	"capa_action_id" text,
	"evaluated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"evaluated_by_user_id" text,
	CONSTRAINT "prevention_certification_evaluation_status_valid" CHECK ("prevention_certification_evaluations"."status" IN ('met', 'not_met', 'not_applicable')),
	CONSTRAINT "prevention_certification_evaluation_source_valid" CHECK ("prevention_certification_evaluations"."source" IN ('auto', 'manual'))
);
--> statement-breakpoint
ALTER TABLE "prevention_certification_dossiers" ADD CONSTRAINT "prevention_certification_dossiers_committee_id_prevention_committees_id_fk" FOREIGN KEY ("committee_id") REFERENCES "public"."prevention_committees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_certification_dossiers" ADD CONSTRAINT "prevention_certification_dossiers_submitted_by_user_id_users_id_fk" FOREIGN KEY ("submitted_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_certification_dossiers" ADD CONSTRAINT "prevention_certification_dossiers_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_certification_evaluations" ADD CONSTRAINT "prevention_certification_evaluations_dossier_id_prevention_certification_dossiers_id_fk" FOREIGN KEY ("dossier_id") REFERENCES "public"."prevention_certification_dossiers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_certification_evaluations" ADD CONSTRAINT "prevention_certification_evaluations_capa_action_id_prevention_capa_actions_id_fk" FOREIGN KEY ("capa_action_id") REFERENCES "public"."prevention_capa_actions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_certification_evaluations" ADD CONSTRAINT "prevention_certification_evaluations_evaluated_by_user_id_users_id_fk" FOREIGN KEY ("evaluated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "prevention_certification_dossier_unique" ON "prevention_certification_dossiers" USING btree ("committee_id","level","period_year");--> statement-breakpoint
CREATE UNIQUE INDEX "prevention_certification_evaluation_unique" ON "prevention_certification_evaluations" USING btree ("dossier_id","requirement_code");