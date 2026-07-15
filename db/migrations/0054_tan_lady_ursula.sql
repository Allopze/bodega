CREATE TABLE "fuel_review_marks" (
	"id" text PRIMARY KEY NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"marked_by" text NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pdtp_action_plan" (
	"id" text PRIMARY KEY NOT NULL,
	"execution_id" text NOT NULL,
	"n" integer NOT NULL,
	"origen" text DEFAULT 'manual' NOT NULL,
	"seccion_id" text,
	"item_id" text,
	"hallazgo" text NOT NULL,
	"accion" text NOT NULL,
	"responsable_role" text NOT NULL,
	"responsable" text NOT NULL,
	"responsable_user_id" text,
	"plazo" text NOT NULL,
	"prioridad" text DEFAULT 'media' NOT NULL,
	"estado" text DEFAULT 'pendiente' NOT NULL,
	"created_by_user_id" text NOT NULL,
	"closed_at" timestamp with time zone,
	"verified_by_user_id" text,
	"verified_at" timestamp with time zone,
	"rejection_reason" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "pdtp_action_plan_origen_check" CHECK ("pdtp_action_plan"."origen" IN ('checklist_item', 'manual')),
	CONSTRAINT "pdtp_action_plan_prioridad_check" CHECK ("pdtp_action_plan"."prioridad" IN ('alta', 'media', 'baja')),
	CONSTRAINT "pdtp_action_plan_estado_check" CHECK ("pdtp_action_plan"."estado" IN ('pendiente', 'en_proceso', 'completado', 'verificado', 'reabierto'))
);
--> statement-breakpoint
CREATE TABLE "pdtp_action_plan_followups" (
	"id" text PRIMARY KEY NOT NULL,
	"action_plan_item_id" text NOT NULL,
	"fecha" text NOT NULL,
	"estado_anterior" text,
	"estado_nuevo" text NOT NULL,
	"observacion" text,
	"evidencia_url" text,
	"evidencia_photos" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pdtp_activity_checklists" (
	"id" text PRIMARY KEY NOT NULL,
	"activity_id" text NOT NULL,
	"program_id" text NOT NULL,
	"version" text DEFAULT '01' NOT NULL,
	"label" text NOT NULL,
	"definition_json" jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "pdtp_activity_checklists_version_check" CHECK (length("pdtp_activity_checklists"."version") > 0)
);
--> statement-breakpoint
CREATE TABLE "pdtp_execution_checklist_responses" (
	"id" text PRIMARY KEY NOT NULL,
	"checklist_instance_id" text NOT NULL,
	"seccion_id" text NOT NULL,
	"item_id" text NOT NULL,
	"estado" text,
	"observacion" text,
	"accion_correctiva" text,
	"responded_by_user_id" text,
	"responded_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "pdtp_execution_checklists" (
	"id" text PRIMARY KEY NOT NULL,
	"execution_id" text NOT NULL,
	"checklist_id" text,
	"definition_snapshot_json" jsonb NOT NULL,
	"overall_status" text DEFAULT 'pendiente' NOT NULL,
	"porcentaje_cumplimiento" real,
	"completed_by_user_id" text,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "pdtp_execution_checklists_status_check" CHECK ("pdtp_execution_checklists"."overall_status" IN ('pendiente', 'en_proceso', 'completado'))
);
--> statement-breakpoint
ALTER TABLE "pdtp_programs" ADD COLUMN "peso_ejecucion" real DEFAULT 0.5 NOT NULL;--> statement-breakpoint
ALTER TABLE "pdtp_programs" ADD COLUMN "peso_verificacion" real DEFAULT 0.3 NOT NULL;--> statement-breakpoint
ALTER TABLE "pdtp_programs" ADD COLUMN "peso_cierre" real DEFAULT 0.2 NOT NULL;--> statement-breakpoint
ALTER TABLE "fuel_review_marks" ADD CONSTRAINT "fuel_review_marks_marked_by_users_id_fk" FOREIGN KEY ("marked_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdtp_action_plan" ADD CONSTRAINT "pdtp_action_plan_execution_id_pdtp_executions_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."pdtp_executions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdtp_action_plan" ADD CONSTRAINT "pdtp_action_plan_responsable_user_id_users_id_fk" FOREIGN KEY ("responsable_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdtp_action_plan" ADD CONSTRAINT "pdtp_action_plan_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdtp_action_plan" ADD CONSTRAINT "pdtp_action_plan_verified_by_user_id_users_id_fk" FOREIGN KEY ("verified_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdtp_action_plan_followups" ADD CONSTRAINT "pdtp_action_plan_followups_action_plan_item_id_pdtp_action_plan_id_fk" FOREIGN KEY ("action_plan_item_id") REFERENCES "public"."pdtp_action_plan"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdtp_action_plan_followups" ADD CONSTRAINT "pdtp_action_plan_followups_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdtp_activity_checklists" ADD CONSTRAINT "pdtp_activity_checklists_activity_id_pdtp_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."pdtp_activities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdtp_activity_checklists" ADD CONSTRAINT "pdtp_activity_checklists_program_id_pdtp_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."pdtp_programs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdtp_execution_checklist_responses" ADD CONSTRAINT "pdtp_execution_checklist_responses_checklist_instance_id_pdtp_execution_checklists_id_fk" FOREIGN KEY ("checklist_instance_id") REFERENCES "public"."pdtp_execution_checklists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdtp_execution_checklist_responses" ADD CONSTRAINT "pdtp_execution_checklist_responses_responded_by_user_id_users_id_fk" FOREIGN KEY ("responded_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdtp_execution_checklists" ADD CONSTRAINT "pdtp_execution_checklists_execution_id_pdtp_executions_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."pdtp_executions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdtp_execution_checklists" ADD CONSTRAINT "pdtp_execution_checklists_checklist_id_pdtp_activity_checklists_id_fk" FOREIGN KEY ("checklist_id") REFERENCES "public"."pdtp_activity_checklists"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdtp_execution_checklists" ADD CONSTRAINT "pdtp_execution_checklists_completed_by_user_id_users_id_fk" FOREIGN KEY ("completed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fuel_review_marks_entity_idx" ON "fuel_review_marks" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "fuel_review_marks_marked_by_idx" ON "fuel_review_marks" USING btree ("marked_by");--> statement-breakpoint
CREATE UNIQUE INDEX "fuel_review_marks_unique_mark" ON "fuel_review_marks" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pdtp_action_plan_execution_n_unique" ON "pdtp_action_plan" USING btree ("execution_id","n");--> statement-breakpoint
CREATE INDEX "pdtp_action_plan_execution_idx" ON "pdtp_action_plan" USING btree ("execution_id");--> statement-breakpoint
CREATE INDEX "pdtp_action_plan_estado_idx" ON "pdtp_action_plan" USING btree ("estado");--> statement-breakpoint
CREATE INDEX "pdtp_action_plan_plazo_idx" ON "pdtp_action_plan" USING btree ("plazo");--> statement-breakpoint
CREATE INDEX "pdtp_action_plan_followups_item_fecha_idx" ON "pdtp_action_plan_followups" USING btree ("action_plan_item_id","fecha");--> statement-breakpoint
CREATE UNIQUE INDEX "pdtp_activity_checklists_activity_active_unique" ON "pdtp_activity_checklists" USING btree ("activity_id") WHERE "pdtp_activity_checklists"."is_active" = true;--> statement-breakpoint
CREATE INDEX "pdtp_activity_checklists_program_idx" ON "pdtp_activity_checklists" USING btree ("program_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pdtp_exec_responses_instance_section_item_unique" ON "pdtp_execution_checklist_responses" USING btree ("checklist_instance_id","seccion_id","item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pdtp_execution_checklists_execution_unique" ON "pdtp_execution_checklists" USING btree ("execution_id");--> statement-breakpoint
ALTER TABLE "pdtp_programs" ADD CONSTRAINT "pdtp_programs_pesos_sum_check" CHECK ("pdtp_programs"."peso_ejecucion" + "pdtp_programs"."peso_verificacion" + "pdtp_programs"."peso_cierre" = 1);