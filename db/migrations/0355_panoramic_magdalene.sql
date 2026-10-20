ALTER TABLE "prevention_incident_re20_quality_reviews" DROP CONSTRAINT IF EXISTS "prevention_incident_re20_review_decision_valid";--> statement-breakpoint
ALTER TABLE "prevention_incident_classification_catalog" ADD COLUMN "sort_order" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "prevention_incident_classification_catalog" ADD COLUMN "parent_code" text;--> statement-breakpoint
ALTER TABLE "prevention_incident_diffusion" ADD COLUMN "measures_table" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "prevention_incident_diffusion" ADD COLUMN "learning" text;--> statement-breakpoint
ALTER TABLE "prevention_incident_diffusion" ADD COLUMN "workspace_version" integer;--> statement-breakpoint
ALTER TABLE "prevention_incident_followups" ADD COLUMN "kind" text DEFAULT 'accident' NOT NULL;--> statement-breakpoint
ALTER TABLE "prevention_incident_followups" ADD COLUMN "measure_id" text;--> statement-breakpoint
ALTER TABLE "prevention_incident_followups" ADD COLUMN "root_cause_id" text;--> statement-breakpoint
ALTER TABLE "prevention_incident_followups" ADD COLUMN "control_type" text;--> statement-breakpoint
ALTER TABLE "prevention_incident_followups" ADD COLUMN "verifier_user_id" text;--> statement-breakpoint
ALTER TABLE "prevention_incident_followups" ADD COLUMN "verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "prevention_incident_followups" ADD COLUMN "residual_risk" text;--> statement-breakpoint
ALTER TABLE "prevention_incident_followups" ADD COLUMN "implemented_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "prevention_incident_followups" ADD COLUMN "verified" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "prevention_incident_followups" ADD COLUMN "effective" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "prevention_incident_followups" ADD COLUMN "lost_days" integer;--> statement-breakpoint
ALTER TABLE "prevention_incident_followups" ADD COLUMN "loss_description" text;--> statement-breakpoint
ALTER TABLE "prevention_incident_followups" ADD CONSTRAINT "prevention_incident_followups_verifier_user_id_users_id_fk" FOREIGN KEY ("verifier_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_incident_followups" ADD CONSTRAINT "prevention_incident_followup_kind_valid" CHECK ("prevention_incident_followups"."kind" IN ('accident', 'damage'));--> statement-breakpoint
ALTER TABLE "prevention_incident_followups" ADD CONSTRAINT "prevention_incident_followup_triple_state" CHECK (
    ("prevention_incident_followups"."effective" = false OR "prevention_incident_followups"."verified" = true)
    AND ("prevention_incident_followups"."verified" = false OR "prevention_incident_followups"."implemented_at" IS NOT NULL)
  );--> statement-breakpoint
ALTER TABLE "prevention_incident_re20_quality_reviews" ADD CONSTRAINT "prevention_incident_re20_review_decision_valid" CHECK ("prevention_incident_re20_quality_reviews"."decision" IN ('approved', 'approved_with_observations', 'changes_required'));--> statement-breakpoint
-- Orden del libro: el código sembrado por 0352 es `r<fila>` de la hoja «Clasificación», así que la fila ya es el orden.
UPDATE "prevention_incident_classification_catalog"
SET "sort_order" = substring("code" from 2)::integer
WHERE "id" LIKE 're20-%' AND "code" ~ '^r[0-9]+$' AND "sort_order" = 0;--> statement-breakpoint
-- Relación agente → categoría (Clasificación columna K): K12:K25 Equipos, K26:K31 Materiales, K32:K44 Ambiente,
-- K45:K63 Ambiente higiénico, K64 Organización del trabajo, K65 Otros. El padre es el `code` de la fila en `agent_category`.
UPDATE "prevention_incident_classification_catalog"
SET "parent_code" = CASE
  WHEN substring("code" from 2)::integer BETWEEN 12 AND 25 THEN 'r12'
  WHEN substring("code" from 2)::integer BETWEEN 26 AND 31 THEN 'r26'
  WHEN substring("code" from 2)::integer BETWEEN 32 AND 44 THEN 'r32'
  WHEN substring("code" from 2)::integer BETWEEN 45 AND 63 THEN 'r45'
  WHEN substring("code" from 2)::integer = 64 THEN 'r64'
  WHEN substring("code" from 2)::integer = 65 THEN 'r65'
END
WHERE "category" = 'causal_agent' AND "id" LIKE 're20-%' AND "code" ~ '^r[0-9]+$' AND "parent_code" IS NULL;
