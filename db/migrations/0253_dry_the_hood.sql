ALTER TABLE "inventory_movements" DROP CONSTRAINT "inventory_movements_type_valid";--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "voided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "voided_by" text;--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "void_reason" text;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_voided_by_users_id_fk" FOREIGN KEY ("voided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_deliveries_voided_at" ON "deliveries" USING btree ("voided_at");--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_void_complete" CHECK (
    ("deliveries"."voided_at" IS NULL AND "deliveries"."voided_by" IS NULL AND "deliveries"."void_reason" IS NULL)
    OR ("deliveries"."voided_at" IS NOT NULL AND "deliveries"."voided_by" IS NOT NULL
        AND char_length(trim("deliveries"."void_reason")) >= 10)
  );--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_type_valid" CHECK (
    "inventory_movements"."type" IN ('ingreso_oc', 'egreso_entrega', 'ingreso_devolucion', 'egreso_desecho', 'retiro_epp_trabajador', 'ajuste', 'egreso_traslado', 'ingreso_traslado', 'ingreso_anulacion')
  );