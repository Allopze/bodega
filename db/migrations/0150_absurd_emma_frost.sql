CREATE TABLE "dispatch_guide_items" (
	"id" text PRIMARY KEY NOT NULL,
	"guide_id" text NOT NULL,
	"product_id" text NOT NULL,
	"quantity" real NOT NULL,
	"unit_of_measure" text DEFAULT 'unidad' NOT NULL,
	"notes" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "dispatch_guide_items_quantity_positive" CHECK ("dispatch_guide_items"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "dispatch_guides" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"origin_worksite_id" text NOT NULL,
	"destination_worksite_id" text NOT NULL,
	"issued_by" text NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dispatcher_worker_id" text,
	"receiver_worker_id" text,
	"vehicle_id" text,
	"driver_worker_id" text,
	"notes" text,
	"dispatched_at" timestamp with time zone,
	"dispatched_by" text,
	"received_at" timestamp with time zone,
	"received_by" text,
	"received_by_worker_id" text,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" text,
	"cancellation_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dispatch_guides_code_unique" UNIQUE("code"),
	CONSTRAINT "dispatch_guides_status_valid" CHECK (
    "dispatch_guides"."status" IN ('draft', 'dispatched', 'received', 'cancelled')
  ),
	CONSTRAINT "dispatch_guides_origin_differs_destination" CHECK (
    "dispatch_guides"."origin_worksite_id" <> "dispatch_guides"."destination_worksite_id"
  ),
	CONSTRAINT "dispatch_guides_dispatch_stamp_valid" CHECK (
    ("dispatch_guides"."status" = 'draft' AND "dispatch_guides"."dispatched_at" IS NULL AND "dispatch_guides"."dispatched_by" IS NULL)
    OR ("dispatch_guides"."status" IN ('dispatched', 'received') AND "dispatch_guides"."dispatched_at" IS NOT NULL AND "dispatch_guides"."dispatched_by" IS NOT NULL)
    OR "dispatch_guides"."status" = 'cancelled'
  ),
	CONSTRAINT "dispatch_guides_receipt_stamp_valid" CHECK (
    ("dispatch_guides"."status" = 'received' AND "dispatch_guides"."received_at" IS NOT NULL AND "dispatch_guides"."received_by" IS NOT NULL)
    OR ("dispatch_guides"."status" IN ('draft', 'dispatched') AND "dispatch_guides"."received_at" IS NULL AND "dispatch_guides"."received_by" IS NULL)
    OR "dispatch_guides"."status" = 'cancelled'
  ),
	CONSTRAINT "dispatch_guides_cancellation_stamp_valid" CHECK (
    ("dispatch_guides"."status" = 'cancelled'
      AND "dispatch_guides"."cancelled_at" IS NOT NULL
      AND "dispatch_guides"."cancelled_by" IS NOT NULL
      AND char_length(trim("dispatch_guides"."cancellation_reason")) >= 5)
    OR ("dispatch_guides"."status" <> 'cancelled'
      AND "dispatch_guides"."cancelled_at" IS NULL
      AND "dispatch_guides"."cancelled_by" IS NULL
      AND "dispatch_guides"."cancellation_reason" IS NULL)
  )
);
--> statement-breakpoint
ALTER TABLE "inventory_movements" DROP CONSTRAINT "inventory_movements_type_valid";--> statement-breakpoint
ALTER TABLE "dispatch_guide_items" ADD CONSTRAINT "dispatch_guide_items_guide_id_dispatch_guides_id_fk" FOREIGN KEY ("guide_id") REFERENCES "public"."dispatch_guides"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatch_guide_items" ADD CONSTRAINT "dispatch_guide_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatch_guides" ADD CONSTRAINT "dispatch_guides_origin_worksite_id_worksites_id_fk" FOREIGN KEY ("origin_worksite_id") REFERENCES "public"."worksites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatch_guides" ADD CONSTRAINT "dispatch_guides_destination_worksite_id_worksites_id_fk" FOREIGN KEY ("destination_worksite_id") REFERENCES "public"."worksites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatch_guides" ADD CONSTRAINT "dispatch_guides_issued_by_users_id_fk" FOREIGN KEY ("issued_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatch_guides" ADD CONSTRAINT "dispatch_guides_dispatcher_worker_id_workers_id_fk" FOREIGN KEY ("dispatcher_worker_id") REFERENCES "public"."workers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatch_guides" ADD CONSTRAINT "dispatch_guides_receiver_worker_id_workers_id_fk" FOREIGN KEY ("receiver_worker_id") REFERENCES "public"."workers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatch_guides" ADD CONSTRAINT "dispatch_guides_vehicle_id_fuel_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."fuel_vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatch_guides" ADD CONSTRAINT "dispatch_guides_driver_worker_id_workers_id_fk" FOREIGN KEY ("driver_worker_id") REFERENCES "public"."workers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatch_guides" ADD CONSTRAINT "dispatch_guides_dispatched_by_users_id_fk" FOREIGN KEY ("dispatched_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatch_guides" ADD CONSTRAINT "dispatch_guides_received_by_users_id_fk" FOREIGN KEY ("received_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatch_guides" ADD CONSTRAINT "dispatch_guides_received_by_worker_id_workers_id_fk" FOREIGN KEY ("received_by_worker_id") REFERENCES "public"."workers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatch_guides" ADD CONSTRAINT "dispatch_guides_cancelled_by_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "dispatch_guide_items_guide_product_unique" ON "dispatch_guide_items" USING btree ("guide_id","product_id");--> statement-breakpoint
CREATE INDEX "dispatch_guide_items_guide_idx" ON "dispatch_guide_items" USING btree ("guide_id");--> statement-breakpoint
CREATE INDEX "dispatch_guides_destination_issued_at_idx" ON "dispatch_guides" USING btree ("destination_worksite_id","issued_at");--> statement-breakpoint
CREATE INDEX "dispatch_guides_status_idx" ON "dispatch_guides" USING btree ("status");--> statement-breakpoint
CREATE INDEX "dispatch_guides_origin_idx" ON "dispatch_guides" USING btree ("origin_worksite_id");--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_type_valid" CHECK (
    "inventory_movements"."type" IN ('ingreso_oc', 'egreso_entrega', 'ingreso_devolucion', 'egreso_desecho', 'retiro_epp_trabajador', 'ajuste', 'egreso_traslado', 'ingreso_traslado')
  );--> statement-breakpoint
-- Custom (no gestionado por Drizzle): `inventory_movements_archive` nació con
-- `CREATE TABLE (LIKE inventory_movements INCLUDING ALL)`, así que se quedó con
-- una copia congelada del CHECK de tipos. Ya estaba desalineado desde que
-- existe `retiro_epp_trabajador`: archivar un movimiento de ese tipo con
-- `archive_old_inventory_movements()` habría fallado. Se sincroniza acá junto a
-- los dos tipos de traslado. Idempotente.
ALTER TABLE inventory_movements_archive DROP CONSTRAINT IF EXISTS inventory_movements_type_valid;--> statement-breakpoint
ALTER TABLE inventory_movements_archive ADD CONSTRAINT inventory_movements_type_valid CHECK (
    type IN ('ingreso_oc', 'egreso_entrega', 'ingreso_devolucion', 'egreso_desecho', 'retiro_epp_trabajador', 'ajuste', 'egreso_traslado', 'ingreso_traslado')
  );