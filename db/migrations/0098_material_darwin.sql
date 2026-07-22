CREATE TABLE "pdtp_approval_decisions" (
	"id" text PRIMARY KEY NOT NULL,
	"program_id" text NOT NULL,
	"step_id" text,
	"step_code" text NOT NULL,
	"step_label" text NOT NULL,
	"step_order" integer NOT NULL,
	"required_permission" text NOT NULL,
	"segregation_rules_snapshot" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"content_version" integer NOT NULL,
	"content_digest" text NOT NULL,
	"decision" text NOT NULL,
	"actor_user_id" text NOT NULL,
	"reason" text,
	"decided_at" timestamp with time zone NOT NULL,
	CONSTRAINT "pdtp_approval_decisions_step_order_check" CHECK ("pdtp_approval_decisions"."step_order" >= 1),
	CONSTRAINT "pdtp_approval_decisions_content_version_check" CHECK ("pdtp_approval_decisions"."content_version" >= 1),
	CONSTRAINT "pdtp_approval_decisions_digest_check" CHECK (length("pdtp_approval_decisions"."content_digest") = 64),
	CONSTRAINT "pdtp_approval_decisions_decision_check" CHECK ("pdtp_approval_decisions"."decision" IN ('approved', 'rejected'))
);
--> statement-breakpoint
CREATE TABLE "pdtp_approval_steps" (
	"id" text PRIMARY KEY NOT NULL,
	"program_id" text NOT NULL,
	"step_order" integer NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"required_permission" text NOT NULL,
	"is_required" boolean DEFAULT true NOT NULL,
	"segregation_rules" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "pdtp_approval_steps_order_check" CHECK ("pdtp_approval_steps"."step_order" >= 1),
	CONSTRAINT "pdtp_approval_steps_code_check" CHECK (length("pdtp_approval_steps"."code") > 0),
	CONSTRAINT "pdtp_approval_steps_label_check" CHECK (length("pdtp_approval_steps"."label") > 0),
	CONSTRAINT "pdtp_approval_steps_permission_check" CHECK (length("pdtp_approval_steps"."required_permission") > 0)
);
--> statement-breakpoint
ALTER TABLE "pdtp_approval_decisions" ADD CONSTRAINT "pdtp_approval_decisions_program_id_pdtp_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."pdtp_programs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdtp_approval_decisions" ADD CONSTRAINT "pdtp_approval_decisions_step_id_pdtp_approval_steps_id_fk" FOREIGN KEY ("step_id") REFERENCES "public"."pdtp_approval_steps"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdtp_approval_decisions" ADD CONSTRAINT "pdtp_approval_decisions_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdtp_approval_steps" ADD CONSTRAINT "pdtp_approval_steps_program_id_pdtp_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."pdtp_programs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pdtp_approval_decisions_program_version_code_unique" ON "pdtp_approval_decisions" USING btree ("program_id","content_version","step_code");--> statement-breakpoint
CREATE INDEX "pdtp_approval_decisions_program_version_idx" ON "pdtp_approval_decisions" USING btree ("program_id","content_version");--> statement-breakpoint
CREATE UNIQUE INDEX "pdtp_approval_steps_program_order_unique" ON "pdtp_approval_steps" USING btree ("program_id","step_order");--> statement-breakpoint
CREATE UNIQUE INDEX "pdtp_approval_steps_program_code_unique" ON "pdtp_approval_steps" USING btree ("program_id","code");--> statement-breakpoint
CREATE INDEX "pdtp_approval_steps_program_idx" ON "pdtp_approval_steps" USING btree ("program_id");