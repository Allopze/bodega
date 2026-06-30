CREATE TABLE "iper_matrices" (
	"id" text PRIMARY KEY NOT NULL,
	"worksite_id" text NOT NULL,
	"code" text NOT NULL,
	"version" integer NOT NULL,
	"title" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"effective_from" text NOT NULL,
	"effective_to" text,
	"created_by" text NOT NULL,
	"closed_by" text,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "iper_risk_items" (
	"id" text PRIMARY KEY NOT NULL,
	"matrix_id" text NOT NULL,
	"process" text NOT NULL,
	"task" text NOT NULL,
	"hazard" text NOT NULL,
	"consequence" text NOT NULL,
	"initial_probability" integer NOT NULL,
	"initial_severity" integer NOT NULL,
	"initial_risk_score" integer NOT NULL,
	"initial_risk_level" text NOT NULL,
	"controls" jsonb NOT NULL,
	"residual_probability" integer NOT NULL,
	"residual_severity" integer NOT NULL,
	"residual_risk_score" integer NOT NULL,
	"residual_risk_level" text NOT NULL,
	"responsible" text NOT NULL,
	"requires_training" boolean DEFAULT false NOT NULL,
	"requires_ppa" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prevention_incident_actions" (
	"id" text PRIMARY KEY NOT NULL,
	"incident_id" text NOT NULL,
	"description" text NOT NULL,
	"responsible" text NOT NULL,
	"due_date" text NOT NULL,
	"status" text DEFAULT 'pendiente' NOT NULL,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prevention_incidents" (
	"id" text PRIMARY KEY NOT NULL,
	"worksite_id" text NOT NULL,
	"worker_id" text,
	"type" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"severity" text DEFAULT 'leve' NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"immediate_cause" text,
	"root_cause" text,
	"location" text,
	"created_by" text NOT NULL,
	"closed_by" text,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "training_courses" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"validity_months" integer,
	"required_for_cargo" jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "training_courses_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "worker_training_assignments" (
	"id" text PRIMARY KEY NOT NULL,
	"course_id" text NOT NULL,
	"worker_id" text NOT NULL,
	"worksite_id" text NOT NULL,
	"completed_at" text NOT NULL,
	"expires_at" text,
	"score" integer,
	"evidence_url" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "iper_matrices" ADD CONSTRAINT "iper_matrices_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iper_matrices" ADD CONSTRAINT "iper_matrices_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iper_matrices" ADD CONSTRAINT "iper_matrices_closed_by_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iper_risk_items" ADD CONSTRAINT "iper_risk_items_matrix_id_iper_matrices_id_fk" FOREIGN KEY ("matrix_id") REFERENCES "public"."iper_matrices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_incident_actions" ADD CONSTRAINT "prevention_incident_actions_incident_id_prevention_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."prevention_incidents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_incidents" ADD CONSTRAINT "prevention_incidents_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_incidents" ADD CONSTRAINT "prevention_incidents_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_incidents" ADD CONSTRAINT "prevention_incidents_closed_by_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_courses" ADD CONSTRAINT "training_courses_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker_training_assignments" ADD CONSTRAINT "worker_training_assignments_course_id_training_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."training_courses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker_training_assignments" ADD CONSTRAINT "worker_training_assignments_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker_training_assignments" ADD CONSTRAINT "worker_training_assignments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "iper_matrices_code_version_unique" ON "iper_matrices" USING btree ("code","version");--> statement-breakpoint
CREATE INDEX "iper_matrices_worksite_status_idx" ON "iper_matrices" USING btree ("worksite_id","status");--> statement-breakpoint
CREATE INDEX "iper_risk_items_matrix_idx" ON "iper_risk_items" USING btree ("matrix_id");--> statement-breakpoint
CREATE INDEX "iper_risk_items_residual_level_idx" ON "iper_risk_items" USING btree ("residual_risk_level");--> statement-breakpoint
CREATE INDEX "prevention_incident_actions_incident_status_idx" ON "prevention_incident_actions" USING btree ("incident_id","status");--> statement-breakpoint
CREATE INDEX "prevention_incidents_worksite_status_idx" ON "prevention_incidents" USING btree ("worksite_id","status");--> statement-breakpoint
CREATE INDEX "prevention_incidents_type_occurred_idx" ON "prevention_incidents" USING btree ("type","occurred_at");--> statement-breakpoint
CREATE INDEX "worker_training_assignments_worker_idx" ON "worker_training_assignments" USING btree ("worker_id");--> statement-breakpoint
CREATE INDEX "worker_training_assignments_worksite_expires_idx" ON "worker_training_assignments" USING btree ("worksite_id","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "worker_training_assignments_worker_course_unique" ON "worker_training_assignments" USING btree ("worker_id","course_id");