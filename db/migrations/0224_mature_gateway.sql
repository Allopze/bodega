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
ALTER TABLE "prevention_risk_matrix_approvals" ADD CONSTRAINT "prevention_risk_matrix_approvals_matrix_id_prevention_risk_matrices_id_fk" FOREIGN KEY ("matrix_id") REFERENCES "public"."prevention_risk_matrices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_risk_matrix_approvals" ADD CONSTRAINT "prevention_risk_matrix_approvals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "prevention_risk_matrix_approvals_unique" ON "prevention_risk_matrix_approvals" USING btree ("matrix_id","domain");--> statement-breakpoint
CREATE INDEX "prevention_risk_matrix_approvals_matrix_idx" ON "prevention_risk_matrix_approvals" USING btree ("matrix_id");