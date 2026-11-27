CREATE TABLE "mant_parts_note_events" (
	"id" text PRIMARY KEY NOT NULL,
	"seq" bigint GENERATED ALWAYS AS IDENTITY (sequence name "mant_parts_note_events_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"note_id" text NOT NULL,
	"kind" text NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"reason" text,
	"actor_user_id" text,
	"item_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mant_parts_note_events_kind_valid" CHECK ("mant_parts_note_events"."kind" IN ('creada', 'transicion', 'migrada')),
	CONSTRAINT "mant_parts_note_events_to_status_valid" CHECK ("mant_parts_note_events"."to_status" IN ('enviada', 'aceptada', 'en_espera', 'en_gestion', 'en_compra', 'recibida_parcial', 'cerrada', 'rechazada', 'anulada')),
	CONSTRAINT "mant_parts_note_events_from_status_valid" CHECK (
    ("mant_parts_note_events"."kind" IN ('creada', 'migrada') AND "mant_parts_note_events"."from_status" IS NULL)
    OR ("mant_parts_note_events"."kind" = 'transicion' AND "mant_parts_note_events"."from_status" IS NOT NULL AND "mant_parts_note_events"."from_status" IN ('enviada', 'aceptada', 'en_espera', 'en_gestion', 'en_compra', 'recibida_parcial', 'cerrada', 'rechazada', 'anulada'))
  )
);
--> statement-breakpoint
ALTER TABLE "purchase_request_items" DROP CONSTRAINT IF EXISTS "purchase_request_items_parts_note_needs_work_order";--> statement-breakpoint
ALTER TABLE "mant_parts_note_items" DROP CONSTRAINT IF EXISTS "mant_parts_note_items_description_valid";--> statement-breakpoint
ALTER TABLE "mant_parts_notes" DROP CONSTRAINT IF EXISTS "mant_parts_notes_status_valid";--> statement-breakpoint
ALTER TABLE "mant_parts_notes" ALTER COLUMN "work_order_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "mant_parts_notes" ALTER COLUMN "vehicle_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "mant_parts_notes" ALTER COLUMN "requested_by_user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "mant_parts_note_items" ADD COLUMN "charge_vehicle_id" text;--> statement-breakpoint
ALTER TABLE "mant_parts_note_items" ADD COLUMN "charge_cost_center_id" text;--> statement-breakpoint
ALTER TABLE "mant_parts_note_items" ADD COLUMN "charge_text" text;--> statement-breakpoint
ALTER TABLE "mant_parts_note_items" ADD COLUMN "suggested_supplier_id" text;--> statement-breakpoint
ALTER TABLE "mant_parts_note_items" ADD COLUMN "supplier_hint" text;--> statement-breakpoint
ALTER TABLE "mant_parts_notes" ADD COLUMN "requested_by_name" text;--> statement-breakpoint
ALTER TABLE "mant_parts_notes" ADD COLUMN "external_ref" text;--> statement-breakpoint
ALTER TABLE "mant_parts_notes" ADD COLUMN "urgent" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "mant_parts_notes" ADD COLUMN "hold_reason" text;--> statement-breakpoint
ALTER TABLE "mant_parts_note_events" ADD CONSTRAINT "mant_parts_note_events_note_id_mant_parts_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."mant_parts_notes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mant_parts_note_events" ADD CONSTRAINT "mant_parts_note_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mant_parts_note_events" ADD CONSTRAINT "mant_parts_note_events_item_id_mant_parts_note_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."mant_parts_note_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mant_parts_note_events_note_idx" ON "mant_parts_note_events" USING btree ("note_id","created_at");--> statement-breakpoint
CREATE INDEX "mant_parts_note_events_note_seq_idx" ON "mant_parts_note_events" USING btree ("note_id","seq");--> statement-breakpoint
ALTER TABLE "mant_parts_note_items" ADD CONSTRAINT "mant_parts_note_items_charge_vehicle_id_fuel_vehicles_id_fk" FOREIGN KEY ("charge_vehicle_id") REFERENCES "public"."fuel_vehicles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mant_parts_note_items" ADD CONSTRAINT "mant_parts_note_items_charge_cost_center_id_cost_centers_id_fk" FOREIGN KEY ("charge_cost_center_id") REFERENCES "public"."cost_centers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mant_parts_note_items" ADD CONSTRAINT "mant_parts_note_items_suggested_supplier_id_suppliers_id_fk" FOREIGN KEY ("suggested_supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mant_parts_note_items_charge_vehicle_idx" ON "mant_parts_note_items" USING btree ("charge_vehicle_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mant_parts_notes_external_ref_unique" ON "mant_parts_notes" USING btree ("external_ref");--> statement-breakpoint
ALTER TABLE "mant_parts_note_items" ADD CONSTRAINT "mant_parts_note_items_charge_one" CHECK (NOT ("mant_parts_note_items"."charge_vehicle_id" IS NOT NULL AND "mant_parts_note_items"."charge_cost_center_id" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "mant_parts_note_items" ADD CONSTRAINT "mant_parts_note_items_description_valid" CHECK (char_length(trim("mant_parts_note_items"."description")) BETWEEN 1 AND 300);--> statement-breakpoint
ALTER TABLE "mant_parts_notes" ADD CONSTRAINT "mant_parts_notes_work_order_vehicle" CHECK ("mant_parts_notes"."vehicle_id" IS NOT NULL OR "mant_parts_notes"."work_order_id" IS NULL);--> statement-breakpoint
ALTER TABLE "mant_parts_notes" ADD CONSTRAINT "mant_parts_notes_requester_valid" CHECK ("mant_parts_notes"."requested_by_user_id" IS NOT NULL OR "mant_parts_notes"."external_ref" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "mant_parts_notes" ADD CONSTRAINT "mant_parts_notes_hold_valid" CHECK (
    ("mant_parts_notes"."status" = 'en_espera' AND char_length(trim(coalesce("mant_parts_notes"."hold_reason", ''))) >= 5)
    OR ("mant_parts_notes"."status" <> 'en_espera' AND "mant_parts_notes"."hold_reason" IS NULL)
  );--> statement-breakpoint
ALTER TABLE "mant_parts_notes" ADD CONSTRAINT "mant_parts_notes_status_valid" CHECK ("mant_parts_notes"."status" IN ('enviada', 'aceptada', 'en_espera', 'en_gestion', 'en_compra', 'recibida_parcial', 'cerrada', 'rechazada', 'anulada'));--> statement-breakpoint
-- Historial de notas de pedido (ADR 0001, 2026-11-27): los eventos son append-only. Un trigger rechaza UPDATE y DELETE.
CREATE OR REPLACE FUNCTION mant_parts_note_events_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'mant_parts_note_events es append-only: no se puede % un evento de nota de pedido', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;--> statement-breakpoint
DROP TRIGGER IF EXISTS "mant_parts_note_events_append_only" ON "mant_parts_note_events";--> statement-breakpoint
CREATE TRIGGER "mant_parts_note_events_append_only"
  BEFORE UPDATE OR DELETE ON "mant_parts_note_events"
  FOR EACH ROW EXECUTE FUNCTION mant_parts_note_events_append_only();--> statement-breakpoint
-- Backfill: la urgencia de las notas existentes sale del «equipo detenido» que ya traían (idempotente).
UPDATE "mant_parts_notes" SET "urgent" = "equipment_stopped" WHERE "urgent" IS DISTINCT FROM "equipment_stopped";--> statement-breakpoint
-- Backfill: un evento «migrada» por cada nota existente, con su estado actual y su fecha de alta. Sólo a las que no tienen historial.
INSERT INTO "mant_parts_note_events" ("id", "note_id", "kind", "from_status", "to_status", "reason", "actor_user_id", "item_id", "created_at")
SELECT 'mig-' || n."id", n."id", 'migrada', NULL, n."status", NULL, NULL, NULL, n."created_at"
FROM "mant_parts_notes" n
WHERE NOT EXISTS (SELECT 1 FROM "mant_parts_note_events" e WHERE e."note_id" = n."id");
