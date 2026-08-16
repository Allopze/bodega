CREATE TABLE "prevention_protocol_applicabilities" (
	"id" text PRIMARY KEY NOT NULL,
	"protocol_code" text NOT NULL,
	"worksite_id" text NOT NULL,
	"status" text DEFAULT 'pending_assessment' NOT NULL,
	"justification" text,
	"periodicity_months" integer,
	"last_assessed_on" text,
	"next_assessment_on" text,
	"assessed_by_user_id" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prevention_protocol_applicability_status_valid" CHECK ("prevention_protocol_applicabilities"."status" IN ('applicable', 'not_applicable', 'pending_assessment')),
	CONSTRAINT "prevention_protocol_applicability_justification_required" CHECK ("prevention_protocol_applicabilities"."status" <> 'not_applicable' OR length(trim(COALESCE("prevention_protocol_applicabilities"."justification", ''))) >= 10),
	CONSTRAINT "prevention_protocol_applicability_version_positive" CHECK ("prevention_protocol_applicabilities"."version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "prevention_protocol_applicabilities" ADD CONSTRAINT "prevention_protocol_applicabilities_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_protocol_applicabilities" ADD CONSTRAINT "prevention_protocol_applicabilities_assessed_by_user_id_users_id_fk" FOREIGN KEY ("assessed_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "prevention_protocol_applicability_unique" ON "prevention_protocol_applicabilities" USING btree ("worksite_id","protocol_code");--> statement-breakpoint
CREATE INDEX "prevention_protocol_applicability_due_idx" ON "prevention_protocol_applicabilities" USING btree ("next_assessment_on");