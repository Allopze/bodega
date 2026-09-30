CREATE TABLE "prevention_risk_factors" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prevention_risk_locations" (
	"id" text PRIMARY KEY NOT NULL,
	"worksite_id" text NOT NULL,
	"name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prevention_risk_matrix_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"matrix_id" text NOT NULL,
	"version_number" integer NOT NULL,
	"period" integer,
	"round_id" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"snapshot_sha256" text NOT NULL,
	"change_summary" text NOT NULL,
	"elaborated_by_user_id" text NOT NULL,
	"technical_reviewer_user_id" text NOT NULL,
	"approver_user_id" text NOT NULL,
	"elaborated_by_name" text NOT NULL,
	"technical_reviewer_name" text NOT NULL,
	"approver_name" text NOT NULL,
	"approved_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prevention_risk_matrix_versions_number_positive" CHECK ("prevention_risk_matrix_versions"."version_number" > 0)
);
--> statement-breakpoint
CREATE TABLE "prevention_risk_observations" (
	"id" text PRIMARY KEY NOT NULL,
	"matrix_id" text NOT NULL,
	"entry_id" text,
	"entry_label" text,
	"round_id" text NOT NULL,
	"stage" text NOT NULL,
	"author_user_id" text NOT NULL,
	"body" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"response" text,
	"responded_by_user_id" text,
	"responded_at" timestamp with time zone,
	"resolved_by_user_id" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prevention_risk_observations_stage_valid" CHECK ("prevention_risk_observations"."stage" IN ('technical', 'legal_rrhh')),
	CONSTRAINT "prevention_risk_observations_status_valid" CHECK ("prevention_risk_observations"."status" IN ('open', 'answered', 'resolved')),
	CONSTRAINT "prevention_risk_observations_body_length" CHECK (length(trim("prevention_risk_observations"."body")) >= 5),
	CONSTRAINT "prevention_risk_observations_answer_present" CHECK ("prevention_risk_observations"."status" <> 'answered' OR "prevention_risk_observations"."response" IS NOT NULL),
	CONSTRAINT "prevention_risk_observations_resolution_present" CHECK ("prevention_risk_observations"."status" <> 'resolved' OR "prevention_risk_observations"."resolved_by_user_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "prevention_risk_review_rounds" (
	"id" text PRIMARY KEY NOT NULL,
	"matrix_id" text NOT NULL,
	"round_number" integer NOT NULL,
	"stage" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"snapshot_sha256" text NOT NULL,
	"submitted_by_user_id" text NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"opened_at" timestamp with time zone,
	"opened_by_user_id" text,
	"decision" text,
	"decided_by_user_id" text,
	"decided_at" timestamp with time zone,
	"decision_comment" text,
	CONSTRAINT "prevention_risk_review_rounds_stage_valid" CHECK ("prevention_risk_review_rounds"."stage" IN ('technical', 'legal_rrhh')),
	CONSTRAINT "prevention_risk_review_rounds_decision_valid" CHECK ("prevention_risk_review_rounds"."decision" IS NULL OR "prevention_risk_review_rounds"."decision" IN ('observed', 'approved')),
	CONSTRAINT "prevention_risk_review_rounds_decision_complete" CHECK (("prevention_risk_review_rounds"."decision" IS NULL) = ("prevention_risk_review_rounds"."decided_by_user_id" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "prevention_risk_entries" DROP CONSTRAINT IF EXISTS "prevention_risk_entries_inherent_level_valid";--> statement-breakpoint
ALTER TABLE "prevention_risk_entries" DROP CONSTRAINT IF EXISTS "prevention_risk_entries_residual_level_valid";--> statement-breakpoint
DROP INDEX IF EXISTS "prevention_risk_entries_matrix_identity_unique";--> statement-breakpoint
ALTER TABLE "prevention_risk_controls" ALTER COLUMN "responsible_snapshot" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "prevention_risk_entries" ALTER COLUMN "process_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "prevention_risk_entries" ALTER COLUMN "task_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "prevention_risk_entries" ALTER COLUMN "position_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "prevention_risk_entries" ALTER COLUMN "hazard" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "prevention_risk_entries" ALTER COLUMN "risk_factor" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "prevention_risk_entries" ALTER COLUMN "expected_event_or_damage" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "prevention_risk_entries" ALTER COLUMN "exposed_people_description" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "prevention_risk_entries" ALTER COLUMN "gender_considerations" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "prevention_risk_entries" ALTER COLUMN "sensitive_worker_considerations" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "prevention_risk_entries" ALTER COLUMN "inherent_dimensions" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "prevention_risk_entries" ALTER COLUMN "inherent_level" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "prevention_risk_entries" ALTER COLUMN "residual_dimensions" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "prevention_risk_entries" ALTER COLUMN "residual_level" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "prevention_risk_entries" ALTER COLUMN "responsible_snapshot" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "prevention_risk_positions" ALTER COLUMN "task_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "prevention_risk_tasks" ALTER COLUMN "process_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "worksites" ADD COLUMN "commune" text;--> statement-breakpoint
ALTER TABLE "prevention_risk_entries" ADD COLUMN "row_number" integer;--> statement-breakpoint
ALTER TABLE "prevention_risk_entries" ADD COLUMN "location_id" text;--> statement-breakpoint
ALTER TABLE "prevention_risk_entries" ADD COLUMN "risk_factor_id" text;--> statement-breakpoint
ALTER TABLE "prevention_risk_entries" ADD COLUMN "is_routine" boolean;--> statement-breakpoint
ALTER TABLE "prevention_risk_entries" ADD COLUMN "risk" text;--> statement-breakpoint
ALTER TABLE "prevention_risk_entries" ADD COLUMN "probable_damage" text;--> statement-breakpoint
ALTER TABLE "prevention_risk_entries" ADD COLUMN "exposed_female" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "prevention_risk_entries" ADD COLUMN "exposed_male" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "prevention_risk_entries" ADD COLUMN "exposed_other" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "prevention_risk_entries" ADD COLUMN "probability" integer;--> statement-breakpoint
ALTER TABLE "prevention_risk_entries" ADD COLUMN "consequence" integer;--> statement-breakpoint
ALTER TABLE "prevention_risk_entries" ADD COLUMN "magnitude" integer GENERATED ALWAYS AS ("probability" * "consequence") STORED;--> statement-breakpoint
ALTER TABLE "prevention_risk_entries" ADD COLUMN "classification" text GENERATED ALWAYS AS (CASE WHEN "probability" IS NULL OR "consequence" IS NULL THEN NULL WHEN "probability" * "consequence" <= 2 THEN 'tolerable' WHEN "probability" * "consequence" = 4 THEN 'moderate' WHEN "probability" * "consequence" = 8 THEN 'important' ELSE 'intolerable' END) STORED;--> statement-breakpoint
ALTER TABLE "prevention_risk_entries" ADD COLUMN "controlled_status" text;--> statement-breakpoint
ALTER TABLE "prevention_risk_matrices" ADD COLUMN "review_state" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "prevention_risk_matrices" ADD COLUMN "period" integer;--> statement-breakpoint
ALTER TABLE "prevention_risk_matrices" ADD COLUMN "is_legacy" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "prevention_risk_matrices" ADD COLUMN "iper_code" text;--> statement-breakpoint
ALTER TABLE "prevention_risk_matrices" ADD COLUMN "elaborated_on" text;--> statement-breakpoint
ALTER TABLE "prevention_risk_matrices" ADD COLUMN "updated_on" text;--> statement-breakpoint
ALTER TABLE "prevention_risk_matrices" ADD COLUMN "company_name" text;--> statement-breakpoint
ALTER TABLE "prevention_risk_matrices" ADD COLUMN "company_rut" text;--> statement-breakpoint
ALTER TABLE "prevention_risk_matrices" ADD COLUMN "company_address" text;--> statement-breakpoint
ALTER TABLE "prevention_risk_matrices" ADD COLUMN "company_commune" text;--> statement-breakpoint
ALTER TABLE "prevention_risk_matrices" ADD COLUMN "economic_activity" text;--> statement-breakpoint
ALTER TABLE "prevention_risk_matrices" ADD COLUMN "adherent_number" text;--> statement-breakpoint
ALTER TABLE "prevention_risk_matrices" ADD COLUMN "worksite_name" text;--> statement-breakpoint
ALTER TABLE "prevention_risk_matrices" ADD COLUMN "site_representative_user_id" text;--> statement-breakpoint
ALTER TABLE "prevention_risk_matrices" ADD COLUMN "site_representative_name" text;--> statement-breakpoint
ALTER TABLE "prevention_risk_matrices" ADD COLUMN "headcount_total" integer;--> statement-breakpoint
ALTER TABLE "prevention_risk_matrices" ADD COLUMN "headcount_male" integer;--> statement-breakpoint
ALTER TABLE "prevention_risk_matrices" ADD COLUMN "headcount_female" integer;--> statement-breakpoint
ALTER TABLE "prevention_risk_matrices" ADD COLUMN "headcount_other" integer;--> statement-breakpoint
ALTER TABLE "prevention_risk_positions" ADD COLUMN "worksite_id" text;--> statement-breakpoint
ALTER TABLE "prevention_risk_positions" ADD COLUMN "normalized_name" text;--> statement-breakpoint
ALTER TABLE "prevention_risk_processes" ADD COLUMN "normalized_name" text;--> statement-breakpoint
ALTER TABLE "prevention_risk_tasks" ADD COLUMN "worksite_id" text;--> statement-breakpoint
ALTER TABLE "prevention_risk_tasks" ADD COLUMN "normalized_name" text;--> statement-breakpoint
ALTER TABLE "prevention_risk_locations" ADD CONSTRAINT "prevention_risk_locations_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_risk_matrix_versions" ADD CONSTRAINT "prevention_risk_matrix_versions_matrix_id_prevention_risk_matrices_id_fk" FOREIGN KEY ("matrix_id") REFERENCES "public"."prevention_risk_matrices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_risk_matrix_versions" ADD CONSTRAINT "prevention_risk_matrix_versions_round_id_prevention_risk_review_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."prevention_risk_review_rounds"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_risk_matrix_versions" ADD CONSTRAINT "prevention_risk_matrix_versions_elaborated_by_user_id_users_id_fk" FOREIGN KEY ("elaborated_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_risk_matrix_versions" ADD CONSTRAINT "prevention_risk_matrix_versions_technical_reviewer_user_id_users_id_fk" FOREIGN KEY ("technical_reviewer_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_risk_matrix_versions" ADD CONSTRAINT "prevention_risk_matrix_versions_approver_user_id_users_id_fk" FOREIGN KEY ("approver_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_risk_observations" ADD CONSTRAINT "prevention_risk_observations_matrix_id_prevention_risk_matrices_id_fk" FOREIGN KEY ("matrix_id") REFERENCES "public"."prevention_risk_matrices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_risk_observations" ADD CONSTRAINT "prevention_risk_observations_entry_id_prevention_risk_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."prevention_risk_entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_risk_observations" ADD CONSTRAINT "prevention_risk_observations_round_id_prevention_risk_review_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."prevention_risk_review_rounds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_risk_observations" ADD CONSTRAINT "prevention_risk_observations_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_risk_observations" ADD CONSTRAINT "prevention_risk_observations_responded_by_user_id_users_id_fk" FOREIGN KEY ("responded_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_risk_observations" ADD CONSTRAINT "prevention_risk_observations_resolved_by_user_id_users_id_fk" FOREIGN KEY ("resolved_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_risk_review_rounds" ADD CONSTRAINT "prevention_risk_review_rounds_matrix_id_prevention_risk_matrices_id_fk" FOREIGN KEY ("matrix_id") REFERENCES "public"."prevention_risk_matrices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_risk_review_rounds" ADD CONSTRAINT "prevention_risk_review_rounds_submitted_by_user_id_users_id_fk" FOREIGN KEY ("submitted_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_risk_review_rounds" ADD CONSTRAINT "prevention_risk_review_rounds_opened_by_user_id_users_id_fk" FOREIGN KEY ("opened_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_risk_review_rounds" ADD CONSTRAINT "prevention_risk_review_rounds_decided_by_user_id_users_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "prevention_risk_factors_code_unique" ON "prevention_risk_factors" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "prevention_risk_factors_name_unique" ON "prevention_risk_factors" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "prevention_risk_locations_scope_name_unique" ON "prevention_risk_locations" USING btree ("worksite_id","normalized_name");--> statement-breakpoint
CREATE UNIQUE INDEX "prevention_risk_matrix_versions_matrix_number_unique" ON "prevention_risk_matrix_versions" USING btree ("matrix_id","version_number");--> statement-breakpoint
CREATE INDEX "prevention_risk_observations_matrix_status_idx" ON "prevention_risk_observations" USING btree ("matrix_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "prevention_risk_review_rounds_matrix_round_unique" ON "prevention_risk_review_rounds" USING btree ("matrix_id","round_number");--> statement-breakpoint
CREATE UNIQUE INDEX "prevention_risk_review_rounds_one_open_unique" ON "prevention_risk_review_rounds" USING btree ("matrix_id") WHERE "prevention_risk_review_rounds"."decision" IS NULL;--> statement-breakpoint
ALTER TABLE "prevention_risk_entries" ADD CONSTRAINT "prevention_risk_entries_location_id_prevention_risk_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."prevention_risk_locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_risk_entries" ADD CONSTRAINT "prevention_risk_entries_risk_factor_id_prevention_risk_factors_id_fk" FOREIGN KEY ("risk_factor_id") REFERENCES "public"."prevention_risk_factors"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_risk_matrices" ADD CONSTRAINT "prevention_risk_matrices_site_representative_user_id_users_id_fk" FOREIGN KEY ("site_representative_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_risk_positions" ADD CONSTRAINT "prevention_risk_positions_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_risk_tasks" ADD CONSTRAINT "prevention_risk_tasks_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "prevention_risk_entries_matrix_row_idx" ON "prevention_risk_entries" USING btree ("matrix_id","row_number");--> statement-breakpoint
CREATE UNIQUE INDEX "prevention_risk_matrices_scope_period_open_unique" ON "prevention_risk_matrices" USING btree ("worksite_id","period") WHERE "prevention_risk_matrices"."status" <> 'superseded' AND "prevention_risk_matrices"."period" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "prevention_risk_positions_scope_name_unique" ON "prevention_risk_positions" USING btree ("worksite_id","normalized_name");--> statement-breakpoint
CREATE UNIQUE INDEX "prevention_risk_processes_scope_name_unique" ON "prevention_risk_processes" USING btree ("worksite_id","normalized_name");--> statement-breakpoint
CREATE UNIQUE INDEX "prevention_risk_tasks_scope_name_unique" ON "prevention_risk_tasks" USING btree ("worksite_id","normalized_name");--> statement-breakpoint
ALTER TABLE "prevention_risk_entries" ADD CONSTRAINT "prevention_risk_entries_probability_valid" CHECK ("prevention_risk_entries"."probability" IS NULL OR "prevention_risk_entries"."probability" IN (1, 2, 4));--> statement-breakpoint
ALTER TABLE "prevention_risk_entries" ADD CONSTRAINT "prevention_risk_entries_consequence_valid" CHECK ("prevention_risk_entries"."consequence" IS NULL OR "prevention_risk_entries"."consequence" IN (1, 2, 4));--> statement-breakpoint
ALTER TABLE "prevention_risk_entries" ADD CONSTRAINT "prevention_risk_entries_controlled_valid" CHECK ("prevention_risk_entries"."controlled_status" IS NULL OR "prevention_risk_entries"."controlled_status" IN ('yes', 'partial', 'no'));--> statement-breakpoint
ALTER TABLE "prevention_risk_entries" ADD CONSTRAINT "prevention_risk_entries_exposed_non_negative" CHECK ("prevention_risk_entries"."exposed_female" >= 0 AND "prevention_risk_entries"."exposed_male" >= 0 AND "prevention_risk_entries"."exposed_other" >= 0);--> statement-breakpoint
ALTER TABLE "prevention_risk_entries" ADD CONSTRAINT "prevention_risk_entries_row_number_positive" CHECK ("prevention_risk_entries"."row_number" IS NULL OR "prevention_risk_entries"."row_number" >= 1);--> statement-breakpoint
ALTER TABLE "prevention_risk_entries" ADD CONSTRAINT "prevention_risk_entries_inherent_level_valid" CHECK ("prevention_risk_entries"."inherent_level" IN ('low', 'medium', 'high', 'critical') OR "prevention_risk_entries"."inherent_level" IS NULL);--> statement-breakpoint
ALTER TABLE "prevention_risk_entries" ADD CONSTRAINT "prevention_risk_entries_residual_level_valid" CHECK ("prevention_risk_entries"."residual_level" IN ('low', 'medium', 'high', 'critical') OR "prevention_risk_entries"."residual_level" IS NULL);--> statement-breakpoint
ALTER TABLE "prevention_risk_matrices" ADD CONSTRAINT "prevention_risk_matrices_review_state_valid" CHECK ("prevention_risk_matrices"."review_state" IN ('none', 'in_review', 'observed', 'pending_approval'));--> statement-breakpoint
ALTER TABLE "prevention_risk_matrices" ADD CONSTRAINT "prevention_risk_matrices_dates_order" CHECK ("prevention_risk_matrices"."elaborated_on" IS NULL OR "prevention_risk_matrices"."updated_on" IS NULL OR "prevention_risk_matrices"."updated_on" >= "prevention_risk_matrices"."elaborated_on");--> statement-breakpoint
ALTER TABLE "prevention_risk_matrices" ADD CONSTRAINT "prevention_risk_matrices_headcount_sum" CHECK ("prevention_risk_matrices"."headcount_total" IS NULL OR "prevention_risk_matrices"."headcount_male" IS NULL OR "prevention_risk_matrices"."headcount_female" IS NULL OR "prevention_risk_matrices"."headcount_other" IS NULL OR "prevention_risk_matrices"."headcount_male" + "prevention_risk_matrices"."headcount_female" + "prevention_risk_matrices"."headcount_other" = "prevention_risk_matrices"."headcount_total");--> statement-breakpoint
ALTER TABLE "prevention_risk_matrices" ADD CONSTRAINT "prevention_risk_matrices_headcount_non_negative" CHECK (coalesce("prevention_risk_matrices"."headcount_total", 0) >= 0 AND coalesce("prevention_risk_matrices"."headcount_male", 0) >= 0 AND coalesce("prevention_risk_matrices"."headcount_female", 0) >= 0 AND coalesce("prevention_risk_matrices"."headcount_other", 0) >= 0);--> statement-breakpoint
ALTER TABLE "prevention_risk_matrices" ADD CONSTRAINT "prevention_risk_matrices_period_valid" CHECK ("prevention_risk_matrices"."period" IS NULL OR "prevention_risk_matrices"."period" BETWEEN 2000 AND 2100);--> statement-breakpoint
-- MIPER F1: toda matriz existente es de la metodología anterior (inherente/residual).
UPDATE "prevention_risk_matrices" SET "is_legacy" = true;--> statement-breakpoint
-- El flujo nuevo sólo conoce draft | published | superseded (0345 lo exige).
UPDATE "prevention_risk_matrices" SET "status" = 'draft' WHERE "status" IN ('in_review', 'reviewed', 'approved');--> statement-breakpoint
INSERT INTO "prevention_risk_factors" ("id", "code", "name", "sort_order") VALUES
  ('riskfactor-locativo', 'locativo', 'Locativo', 10),
  ('riskfactor-mecanico', 'mecanico', 'Mecánico', 20),
  ('riskfactor-fisico', 'fisico', 'Físico', 30),
  ('riskfactor-quimico', 'quimico', 'Químico', 40),
  ('riskfactor-biologico', 'biologico', 'Biológico', 50),
  ('riskfactor-electrico', 'electrico', 'Eléctrico', 60),
  ('riskfactor-ergonomico', 'ergonomico', 'Ergonómico', 70),
  ('riskfactor-psicosocial', 'psicosocial', 'Psicosocial', 80),
  ('riskfactor-factor-humano', 'factor_humano', 'Factor humano', 90),
  ('riskfactor-ambiente', 'ambiente_trabajo', 'Ambiente de trabajo', 100),
  ('riskfactor-transito', 'transito', 'Tránsito', 110)
ON CONFLICT ("code") DO NOTHING;--> statement-breakpoint
CREATE OR REPLACE FUNCTION prevention_risk_matrix_versions_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Las versiones selladas de la MIPER son inmutables';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
DROP TRIGGER IF EXISTS prevention_risk_matrix_versions_immutable_trg ON "prevention_risk_matrix_versions";--> statement-breakpoint
CREATE TRIGGER prevention_risk_matrix_versions_immutable_trg
  BEFORE UPDATE OR DELETE ON "prevention_risk_matrix_versions"
  FOR EACH ROW EXECUTE FUNCTION prevention_risk_matrix_versions_immutable();