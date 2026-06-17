CREATE TABLE "sst_action_plan" (
	"id" text PRIMARY KEY NOT NULL,
	"evaluation_id" text NOT NULL,
	"n" integer NOT NULL,
	"hallazgo" text NOT NULL,
	"accion" text NOT NULL,
	"responsable" text NOT NULL,
	"plazo" text NOT NULL,
	"estado" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sst_evaluations" (
	"id" text PRIMARY KEY NOT NULL,
	"worksite_id" text NOT NULL,
	"worker_id" text NOT NULL,
	"created_by" text NOT NULL,
	"definicion_code" text NOT NULL,
	"definicion_version" text NOT NULL,
	"tipo" text NOT NULL,
	"motivo" text,
	"motivo_otro" text,
	"descripcion_evento" text,
	"equipo_patente" text,
	"fecha_evaluacion" text NOT NULL,
	"estado" text DEFAULT 'borrador' NOT NULL,
	"cargos_json" jsonb,
	"resultado_final" text,
	"porcentaje_cumplimiento" real,
	"resultado_eficacia" text,
	"restricciones" text,
	"observaciones_generales" text,
	"schema_json" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sst_responses" (
	"id" text PRIMARY KEY NOT NULL,
	"evaluation_id" text NOT NULL,
	"seccion_id" text NOT NULL,
	"item_id" text NOT NULL,
	"estado" text,
	"observacion" text,
	"accion_correctiva" text
);
--> statement-breakpoint
CREATE TABLE "sst_scheduled_followups" (
	"id" text PRIMARY KEY NOT NULL,
	"evaluation_id" text NOT NULL,
	"instancia" text NOT NULL,
	"fecha_programada" text NOT NULL,
	"cumple" boolean,
	"observaciones" text,
	"realizado" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workers" ADD COLUMN "supervisor" text;--> statement-breakpoint
ALTER TABLE "workers" ADD COLUMN "prevencionista" text;--> statement-breakpoint
ALTER TABLE "sst_action_plan" ADD CONSTRAINT "sst_action_plan_evaluation_id_sst_evaluations_id_fk" FOREIGN KEY ("evaluation_id") REFERENCES "public"."sst_evaluations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sst_evaluations" ADD CONSTRAINT "sst_evaluations_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sst_evaluations" ADD CONSTRAINT "sst_evaluations_worker_id_workers_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sst_evaluations" ADD CONSTRAINT "sst_evaluations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sst_responses" ADD CONSTRAINT "sst_responses_evaluation_id_sst_evaluations_id_fk" FOREIGN KEY ("evaluation_id") REFERENCES "public"."sst_evaluations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sst_scheduled_followups" ADD CONSTRAINT "sst_scheduled_followups_evaluation_id_sst_evaluations_id_fk" FOREIGN KEY ("evaluation_id") REFERENCES "public"."sst_evaluations"("id") ON DELETE cascade ON UPDATE no action;