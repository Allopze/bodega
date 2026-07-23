CREATE TABLE "prevention_incident_classification_catalog" (
	"id" text PRIMARY KEY NOT NULL,
	"category" text NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "prevention_incident_classification_cat_valid" CHECK ("prevention_incident_classification_catalog"."category" IN ('accident_type', 'situation', 'causal_agent', 'source', 'body_zone', 'mutual_status'))
);
--> statement-breakpoint
CREATE TABLE "prevention_incident_diffusion" (
	"id" text PRIMARY KEY NOT NULL,
	"incident_id" text NOT NULL,
	"one_page_summary" text NOT NULL,
	"root_cause_text" text NOT NULL,
	"action_plan_summary" text NOT NULL,
	"diffused_at" timestamp with time zone NOT NULL,
	"evidence_ref" text,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prevention_incident_followups" (
	"id" text PRIMARY KEY NOT NULL,
	"incident_id" text NOT NULL,
	"followup_date" text NOT NULL,
	"note" text NOT NULL,
	"status" text DEFAULT 'completed' NOT NULL,
	"evidence_ref" text,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prevention_incident_statements" (
	"id" text PRIMARY KEY NOT NULL,
	"incident_id" text NOT NULL,
	"kind" text NOT NULL,
	"deponent_name" text NOT NULL,
	"deponent_role" text,
	"statement_text" text NOT NULL,
	"signed_at" timestamp with time zone,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prevention_incident_statement_kind_valid" CHECK ("prevention_incident_statements"."kind" IN ('involved', 'witness', 'cphs'))
);
--> statement-breakpoint
ALTER TABLE "prevention_incident_investigations" ADD COLUMN "preliminary_report_text" text;--> statement-breakpoint
ALTER TABLE "prevention_incident_investigations" ADD COLUMN "preliminary_report_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "prevention_incident_investigations" ADD COLUMN "definitive_report_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "prevention_incident_investigations" ADD COLUMN "risk_probability" integer;--> statement-breakpoint
ALTER TABLE "prevention_incident_investigations" ADD COLUMN "risk_consequence" integer;--> statement-breakpoint
ALTER TABLE "prevention_incident_investigations" ADD COLUMN "risk_level" text;--> statement-breakpoint
ALTER TABLE "prevention_incident_diffusion" ADD CONSTRAINT "prevention_incident_diffusion_incident_id_prevention_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."prevention_incidents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_incident_diffusion" ADD CONSTRAINT "prevention_incident_diffusion_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_incident_followups" ADD CONSTRAINT "prevention_incident_followups_incident_id_prevention_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."prevention_incidents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_incident_followups" ADD CONSTRAINT "prevention_incident_followups_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_incident_statements" ADD CONSTRAINT "prevention_incident_statements_incident_id_prevention_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."prevention_incidents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_incident_statements" ADD CONSTRAINT "prevention_incident_statements_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "prevention_incident_classification_cat_code_unique" ON "prevention_incident_classification_catalog" USING btree ("category","code");--> statement-breakpoint
CREATE INDEX "prevention_incident_diffusion_incident_idx" ON "prevention_incident_diffusion" USING btree ("incident_id");--> statement-breakpoint
CREATE INDEX "prevention_incident_followups_incident_idx" ON "prevention_incident_followups" USING btree ("incident_id");--> statement-breakpoint
CREATE INDEX "prevention_incident_statements_incident_idx" ON "prevention_incident_statements" USING btree ("incident_id");