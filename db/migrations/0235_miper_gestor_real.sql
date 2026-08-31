CREATE TABLE "prevention_capa_risk_links" (
	"id" text PRIMARY KEY NOT NULL,
	"capa_action_id" text NOT NULL,
	"risk_entry_id" text NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prevention_risk_matrix_approvals" (
	"id" text PRIMARY KEY NOT NULL,
	"matrix_id" text NOT NULL,
	"domain" text NOT NULL,
	"decision" text NOT NULL,
	"user_id" text NOT NULL,
	"reason" text NOT NULL,
	"decided_at" timestamp with time zone NOT NULL,
	"migrated_from_legacy" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prevention_risk_matrix_approvals_domain_valid" CHECK ("prevention_risk_matrix_approvals"."domain" IN ('prevention', 'operations')),
	CONSTRAINT "prevention_risk_matrix_approvals_decision_valid" CHECK ("prevention_risk_matrix_approvals"."decision" IN ('approved', 'rejected'))
);
--> statement-breakpoint
ALTER TABLE "prevention_risk_entries" DROP CONSTRAINT "prevention_risk_entries_inherent_level_valid";--> statement-breakpoint
ALTER TABLE "prevention_risk_entries" ALTER COLUMN "inherent_dimensions" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "prevention_risk_entries" ALTER COLUMN "inherent_level" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "prevention_risk_entries" ADD COLUMN "risk" text;--> statement-breakpoint
ALTER TABLE "prevention_risk_entries" ADD COLUMN "probability" integer;--> statement-breakpoint
ALTER TABLE "prevention_risk_entries" ADD COLUMN "consequence" integer;--> statement-breakpoint
ALTER TABLE "prevention_risk_entries" ADD COLUMN "risk_magnitude" integer;--> statement-breakpoint
ALTER TABLE "prevention_risk_entries" ADD COLUMN "risk_classification" text;--> statement-breakpoint
ALTER TABLE "prevention_risk_entries" ADD COLUMN "evaluation_divergence" jsonb;--> statement-breakpoint
ALTER TABLE "prevention_risk_entries" ADD COLUMN "is_routine" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "prevention_risk_entries" ADD COLUMN "specific_workplace" text;--> statement-breakpoint
ALTER TABLE "prevention_risk_entries" ADD COLUMN "exposed_workers_female" integer;--> statement-breakpoint
ALTER TABLE "prevention_risk_entries" ADD COLUMN "exposed_workers_male" integer;--> statement-breakpoint
ALTER TABLE "prevention_risk_entries" ADD COLUMN "exposed_workers_other" integer;--> statement-breakpoint
ALTER TABLE "prevention_risk_entries" ADD COLUMN "control_status_text" text;--> statement-breakpoint
ALTER TABLE "prevention_risk_entries" ADD COLUMN "control_deadline_text" text;--> statement-breakpoint
ALTER TABLE "prevention_capa_risk_links" ADD CONSTRAINT "prevention_capa_risk_links_capa_action_id_prevention_capa_actions_id_fk" FOREIGN KEY ("capa_action_id") REFERENCES "public"."prevention_capa_actions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_capa_risk_links" ADD CONSTRAINT "prevention_capa_risk_links_risk_entry_id_prevention_risk_entries_id_fk" FOREIGN KEY ("risk_entry_id") REFERENCES "public"."prevention_risk_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_capa_risk_links" ADD CONSTRAINT "prevention_capa_risk_links_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_risk_matrix_approvals" ADD CONSTRAINT "prevention_risk_matrix_approvals_matrix_id_prevention_risk_matrices_id_fk" FOREIGN KEY ("matrix_id") REFERENCES "public"."prevention_risk_matrices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_risk_matrix_approvals" ADD CONSTRAINT "prevention_risk_matrix_approvals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "prevention_capa_risk_links_unique" ON "prevention_capa_risk_links" USING btree ("capa_action_id","risk_entry_id");--> statement-breakpoint
CREATE INDEX "prevention_capa_risk_links_capa_idx" ON "prevention_capa_risk_links" USING btree ("capa_action_id");--> statement-breakpoint
CREATE INDEX "prevention_capa_risk_links_risk_entry_idx" ON "prevention_capa_risk_links" USING btree ("risk_entry_id");--> statement-breakpoint
CREATE UNIQUE INDEX "prevention_risk_matrix_approvals_unique" ON "prevention_risk_matrix_approvals" USING btree ("matrix_id","domain");--> statement-breakpoint
CREATE INDEX "prevention_risk_matrix_approvals_matrix_idx" ON "prevention_risk_matrix_approvals" USING btree ("matrix_id");--> statement-breakpoint
CREATE INDEX "prevention_risk_entries_matrix_classification_idx" ON "prevention_risk_entries" USING btree ("matrix_id","risk_classification");--> statement-breakpoint
ALTER TABLE "prevention_risk_entries" ADD CONSTRAINT "prevention_risk_entries_probability_valid" CHECK ("prevention_risk_entries"."probability" IS NULL OR "prevention_risk_entries"."probability" IN (1, 2, 4));--> statement-breakpoint
ALTER TABLE "prevention_risk_entries" ADD CONSTRAINT "prevention_risk_entries_consequence_valid" CHECK ("prevention_risk_entries"."consequence" IS NULL OR "prevention_risk_entries"."consequence" IN (1, 2, 4));--> statement-breakpoint
ALTER TABLE "prevention_risk_entries" ADD CONSTRAINT "prevention_risk_entries_magnitude_product" CHECK ("prevention_risk_entries"."risk_magnitude" IS NULL OR ("prevention_risk_entries"."probability" IS NOT NULL AND "prevention_risk_entries"."consequence" IS NOT NULL AND "prevention_risk_entries"."risk_magnitude" = "prevention_risk_entries"."probability" * "prevention_risk_entries"."consequence"));--> statement-breakpoint
ALTER TABLE "prevention_risk_entries" ADD CONSTRAINT "prevention_risk_entries_classification_valid" CHECK ("prevention_risk_entries"."risk_classification" IS NULL OR "prevention_risk_entries"."risk_classification" IN ('tolerable', 'moderado', 'importante', 'intolerable'));--> statement-breakpoint
ALTER TABLE "prevention_risk_entries" ADD CONSTRAINT "prevention_risk_entries_control_status_text_valid" CHECK ("prevention_risk_entries"."control_status_text" IS NULL OR "prevention_risk_entries"."control_status_text" IN ('controlled', 'partial', 'partial_immediate'));--> statement-breakpoint
ALTER TABLE "prevention_risk_entries" ADD CONSTRAINT "prevention_risk_entries_exposed_workers_valid" CHECK (("prevention_risk_entries"."exposed_workers_female" IS NULL OR "prevention_risk_entries"."exposed_workers_female" >= 0) AND ("prevention_risk_entries"."exposed_workers_male" IS NULL OR "prevention_risk_entries"."exposed_workers_male" >= 0) AND ("prevention_risk_entries"."exposed_workers_other" IS NULL OR "prevention_risk_entries"."exposed_workers_other" >= 0));--> statement-breakpoint
ALTER TABLE "prevention_risk_entries" ADD CONSTRAINT "prevention_risk_entries_inherent_level_valid" CHECK ("prevention_risk_entries"."inherent_level" IS NULL OR "prevention_risk_entries"."inherent_level" IN ('low', 'medium', 'high', 'critical'));