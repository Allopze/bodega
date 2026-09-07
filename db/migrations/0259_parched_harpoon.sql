-- AVISO: el nombre del FK de abajo, "it_asset_retirements_closed_assignment_id_it_asset_assignments_id_fk",
-- mide 68 caracteres. Postgres lo trunca en silencio a 63
-- ("it_asset_retirements_closed_assignment_id_it_asset_assignments_")
-- al crearlo. Cualquier DROP CONSTRAINT futuro copiado literal de este
-- archivo debe usar el nombre TRUNCADO, no el que aparece abajo.
ALTER TABLE "it_asset_history" DROP CONSTRAINT "it_asset_history_action_valid";--> statement-breakpoint
ALTER TABLE "it_asset_retirements" ADD COLUMN "previous_status" text;--> statement-breakpoint
ALTER TABLE "it_asset_retirements" ADD COLUMN "previous_worker_id" text;--> statement-breakpoint
ALTER TABLE "it_asset_retirements" ADD COLUMN "closed_assignment_id" text;--> statement-breakpoint
ALTER TABLE "it_asset_retirements" ADD COLUMN "reversed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "it_asset_retirements" ADD COLUMN "reversed_by_user_id" text;--> statement-breakpoint
ALTER TABLE "it_asset_retirements" ADD COLUMN "reverse_reason" text;--> statement-breakpoint
ALTER TABLE "it_maintenances" ADD COLUMN "voided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "it_maintenances" ADD COLUMN "voided_by_user_id" text;--> statement-breakpoint
ALTER TABLE "it_maintenances" ADD COLUMN "void_reason" text;--> statement-breakpoint
ALTER TABLE "it_asset_retirements" ADD CONSTRAINT "it_asset_retirements_previous_worker_id_workers_id_fk" FOREIGN KEY ("previous_worker_id") REFERENCES "public"."workers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "it_asset_retirements" ADD CONSTRAINT "it_asset_retirements_closed_assignment_id_it_asset_assignments_id_fk" FOREIGN KEY ("closed_assignment_id") REFERENCES "public"."it_asset_assignments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "it_asset_retirements" ADD CONSTRAINT "it_asset_retirements_reversed_by_user_id_users_id_fk" FOREIGN KEY ("reversed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "it_maintenances" ADD CONSTRAINT "it_maintenances_voided_by_user_id_users_id_fk" FOREIGN KEY ("voided_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "it_asset_retirements_reversed_idx" ON "it_asset_retirements" USING btree ("reversed_at");--> statement-breakpoint
CREATE INDEX "it_asset_retirements_asset_created_idx" ON "it_asset_retirements" USING btree ("asset_id","created_at");--> statement-breakpoint
CREATE INDEX "it_maintenances_voided_idx" ON "it_maintenances" USING btree ("voided_at");--> statement-breakpoint
ALTER TABLE "it_asset_history" ADD CONSTRAINT "it_asset_history_action_valid" CHECK ("it_asset_history"."action" IN ('created', 'assigned', 'returned', 'status_changed', 'edited', 'maintenance', 'maintenance_voided', 'ticket', 'document', 'photo', 'warranty', 'retired', 'retirement_reversed'));--> statement-breakpoint
ALTER TABLE "it_asset_retirements" ADD CONSTRAINT "it_asset_retirements_previous_status_valid" CHECK (
    "it_asset_retirements"."previous_status" IS NULL
    OR "it_asset_retirements"."previous_status" IN ('disponible', 'asignado', 'en_prestamo', 'en_reparacion', 'en_bodega')
  );--> statement-breakpoint
ALTER TABLE "it_asset_retirements" ADD CONSTRAINT "it_asset_retirements_reverse_complete" CHECK (
    ("it_asset_retirements"."reversed_at" IS NULL AND "it_asset_retirements"."reversed_by_user_id" IS NULL AND "it_asset_retirements"."reverse_reason" IS NULL)
    OR ("it_asset_retirements"."reversed_at" IS NOT NULL AND "it_asset_retirements"."reversed_by_user_id" IS NOT NULL AND char_length(trim("it_asset_retirements"."reverse_reason")) >= 10)
  );--> statement-breakpoint
ALTER TABLE "it_maintenances" ADD CONSTRAINT "it_maintenances_void_complete" CHECK (
    ("it_maintenances"."voided_at" IS NULL AND "it_maintenances"."voided_by_user_id" IS NULL AND "it_maintenances"."void_reason" IS NULL)
    OR ("it_maintenances"."voided_at" IS NOT NULL AND "it_maintenances"."voided_by_user_id" IS NOT NULL AND char_length(trim("it_maintenances"."void_reason")) >= 10)
  );