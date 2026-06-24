CREATE TABLE "sst_weekly_evaluations" (
	"id" text PRIMARY KEY NOT NULL,
	"evaluation_id" text NOT NULL,
	"semana" integer NOT NULL,
	"fecha_desbloqueo" text NOT NULL,
	"estado" text DEFAULT 'pendiente' NOT NULL,
	"fecha_completada" text,
	"alert_sent_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "inventory_movements" DROP CONSTRAINT "inventory_movements_type_valid";--> statement-breakpoint
ALTER TABLE "sst_evaluations" ADD COLUMN "evaluator_role" text;--> statement-breakpoint
ALTER TABLE "sst_weekly_evaluations" ADD CONSTRAINT "sst_weekly_evaluations_evaluation_id_sst_evaluations_id_fk" FOREIGN KEY ("evaluation_id") REFERENCES "public"."sst_evaluations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_type_valid" CHECK (
    "inventory_movements"."type" IN ('ingreso_oc', 'egreso_entrega', 'ingreso_devolucion', 'egreso_desecho', 'ajuste')
  );