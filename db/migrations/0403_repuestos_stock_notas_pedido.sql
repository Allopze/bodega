CREATE TABLE "mant_parts_allocation_sources" (
	"id" text PRIMARY KEY NOT NULL,
	"allocation_id" text NOT NULL,
	"source" text NOT NULL,
	"quantity" numeric(10, 2) NOT NULL,
	"note_item_id" text,
	"request_item_id" text,
	"receipt_id" text,
	"dispatch_guide_id" text,
	"actor_user_id" text NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mant_parts_allocation_sources_source_valid" CHECK (
    ("mant_parts_allocation_sources"."source" IN ('recepcion', 'stock_existente', 'traslado') AND "mant_parts_allocation_sources"."quantity" > 0)
    OR ("mant_parts_allocation_sources"."source" IN ('anulacion_recepcion', 'anulacion_guia', 'cotejo', 'ajuste', 'liberacion') AND "mant_parts_allocation_sources"."quantity" < 0)
  )
);
--> statement-breakpoint
CREATE TABLE "mant_parts_allocations" (
	"id" text PRIMARY KEY NOT NULL,
	"work_order_id" text NOT NULL,
	"worksite_id" text NOT NULL,
	"product_id" text NOT NULL,
	"quantity" numeric(10, 2) DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'activa' NOT NULL,
	"released_quantity" numeric(10, 2) DEFAULT 0 NOT NULL,
	"released_by_user_id" text,
	"released_at" timestamp with time zone,
	"release_reason" text,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mant_parts_allocations_quantity_valid" CHECK ("mant_parts_allocations"."quantity" >= 0 AND "mant_parts_allocations"."released_quantity" >= 0),
	CONSTRAINT "mant_parts_allocations_status_valid" CHECK ("mant_parts_allocations"."status" IN ('activa', 'liberada')),
	CONSTRAINT "mant_parts_allocations_release_valid" CHECK (
    ("mant_parts_allocations"."status" = 'activa' AND "mant_parts_allocations"."released_at" IS NULL AND "mant_parts_allocations"."released_by_user_id" IS NULL AND "mant_parts_allocations"."release_reason" IS NULL AND "mant_parts_allocations"."released_quantity" = 0)
    OR ("mant_parts_allocations"."status" = 'liberada' AND "mant_parts_allocations"."released_at" IS NOT NULL AND "mant_parts_allocations"."released_by_user_id" IS NOT NULL
      AND char_length(trim(coalesce("mant_parts_allocations"."release_reason", ''))) >= 3)
  )
);
--> statement-breakpoint
CREATE TABLE "mant_parts_note_items" (
	"id" text PRIMARY KEY NOT NULL,
	"note_id" text NOT NULL,
	"description" text NOT NULL,
	"quantity" numeric(10, 2) NOT NULL,
	"unit_of_measure" text DEFAULT 'unidad' NOT NULL,
	"part_number" text,
	"product_id" text,
	"resolution" text DEFAULT 'pendiente' NOT NULL,
	"resolution_reason" text,
	"resolved_by_user_id" text,
	"resolved_at" timestamp with time zone,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mant_parts_note_items_description_valid" CHECK (char_length(trim("mant_parts_note_items"."description")) BETWEEN 3 AND 300),
	CONSTRAINT "mant_parts_note_items_quantity_positive" CHECK ("mant_parts_note_items"."quantity" > 0),
	CONSTRAINT "mant_parts_note_items_resolution_valid" CHECK ("mant_parts_note_items"."resolution" IN ('pendiente', 'desde_stock', 'en_compra', 'rechazada')),
	CONSTRAINT "mant_parts_note_items_rejected_reason" CHECK ("mant_parts_note_items"."resolution" <> 'rechazada' OR char_length(trim(coalesce("mant_parts_note_items"."resolution_reason", ''))) >= 5),
	CONSTRAINT "mant_parts_note_items_from_stock_product" CHECK ("mant_parts_note_items"."resolution" <> 'desde_stock' OR "mant_parts_note_items"."product_id" IS NOT NULL),
	CONSTRAINT "mant_parts_note_items_resolved_valid" CHECK (
    ("mant_parts_note_items"."resolution" = 'pendiente' AND "mant_parts_note_items"."resolved_at" IS NULL AND "mant_parts_note_items"."resolved_by_user_id" IS NULL)
    OR ("mant_parts_note_items"."resolution" <> 'pendiente' AND "mant_parts_note_items"."resolved_at" IS NOT NULL AND "mant_parts_note_items"."resolved_by_user_id" IS NOT NULL)
  )
);
--> statement-breakpoint
CREATE TABLE "mant_parts_notes" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"work_order_id" text NOT NULL,
	"vehicle_id" text NOT NULL,
	"worksite_id" text NOT NULL,
	"requested_by_user_id" text NOT NULL,
	"device_id" text,
	"client_op_id" text,
	"equipment_stopped" boolean DEFAULT false NOT NULL,
	"notes" text,
	"status" text DEFAULT 'enviada' NOT NULL,
	"voided_by_user_id" text,
	"voided_at" timestamp with time zone,
	"void_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mant_parts_notes_status_valid" CHECK ("mant_parts_notes"."status" IN ('enviada', 'en_gestion', 'cerrada', 'anulada')),
	CONSTRAINT "mant_parts_notes_notes_valid" CHECK ("mant_parts_notes"."notes" IS NULL OR char_length("mant_parts_notes"."notes") <= 500),
	CONSTRAINT "mant_parts_notes_void_valid" CHECK (
    ("mant_parts_notes"."status" = 'anulada' AND "mant_parts_notes"."voided_at" IS NOT NULL AND "mant_parts_notes"."voided_by_user_id" IS NOT NULL
      AND char_length(trim(coalesce("mant_parts_notes"."void_reason", ''))) >= 5)
    OR ("mant_parts_notes"."status" <> 'anulada' AND "mant_parts_notes"."voided_at" IS NULL AND "mant_parts_notes"."voided_by_user_id" IS NULL AND "mant_parts_notes"."void_reason" IS NULL)
  )
);
--> statement-breakpoint
ALTER TABLE "inventory_movements" DROP CONSTRAINT IF EXISTS "inventory_movements_type_valid";--> statement-breakpoint
ALTER TABLE "mant_work_order_events" DROP CONSTRAINT IF EXISTS "mant_work_order_events_type_valid";--> statement-breakpoint
ALTER TABLE "purchase_request_items" ADD COLUMN "parts_note_item_id" text;--> statement-breakpoint
ALTER TABLE "mant_record_parts" ADD COLUMN "product_id" text;--> statement-breakpoint
ALTER TABLE "mant_record_parts" ADD COLUMN "source" text DEFAULT 'texto' NOT NULL;--> statement-breakpoint
ALTER TABLE "mant_record_parts" ADD COLUMN "allocation_id" text;--> statement-breakpoint
ALTER TABLE "mant_record_parts" ADD COLUMN "inventory_movement_id" text;--> statement-breakpoint
ALTER TABLE "mant_record_parts" ADD COLUMN "reversal_movement_id" text;--> statement-breakpoint
ALTER TABLE "mant_record_parts" ADD COLUMN "stock_status" text DEFAULT 'no_aplica' NOT NULL;--> statement-breakpoint
ALTER TABLE "mant_record_parts" ADD COLUMN "stock_note" text;--> statement-breakpoint
ALTER TABLE "mant_parts_allocation_sources" ADD CONSTRAINT "mant_parts_allocation_sources_receipt_id_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."receipts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mant_parts_allocation_sources" ADD CONSTRAINT "mant_parts_allocation_sources_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mant_parts_allocation_sources" ADD CONSTRAINT "mant_parts_alloc_sources_allocation_fk" FOREIGN KEY ("allocation_id") REFERENCES "public"."mant_parts_allocations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mant_parts_allocation_sources" ADD CONSTRAINT "mant_parts_alloc_sources_note_item_fk" FOREIGN KEY ("note_item_id") REFERENCES "public"."mant_parts_note_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mant_parts_allocation_sources" ADD CONSTRAINT "mant_parts_alloc_sources_request_item_fk" FOREIGN KEY ("request_item_id") REFERENCES "public"."purchase_request_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mant_parts_allocation_sources" ADD CONSTRAINT "mant_parts_alloc_sources_guide_fk" FOREIGN KEY ("dispatch_guide_id") REFERENCES "public"."dispatch_guides"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mant_parts_allocations" ADD CONSTRAINT "mant_parts_allocations_work_order_id_mant_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."mant_work_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mant_parts_allocations" ADD CONSTRAINT "mant_parts_allocations_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mant_parts_allocations" ADD CONSTRAINT "mant_parts_allocations_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mant_parts_allocations" ADD CONSTRAINT "mant_parts_allocations_released_by_user_id_users_id_fk" FOREIGN KEY ("released_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mant_parts_allocations" ADD CONSTRAINT "mant_parts_allocations_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mant_parts_note_items" ADD CONSTRAINT "mant_parts_note_items_note_id_mant_parts_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."mant_parts_notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mant_parts_note_items" ADD CONSTRAINT "mant_parts_note_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mant_parts_note_items" ADD CONSTRAINT "mant_parts_note_items_resolved_by_user_id_users_id_fk" FOREIGN KEY ("resolved_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mant_parts_notes" ADD CONSTRAINT "mant_parts_notes_work_order_id_mant_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."mant_work_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mant_parts_notes" ADD CONSTRAINT "mant_parts_notes_vehicle_id_fuel_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."fuel_vehicles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mant_parts_notes" ADD CONSTRAINT "mant_parts_notes_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mant_parts_notes" ADD CONSTRAINT "mant_parts_notes_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mant_parts_notes" ADD CONSTRAINT "mant_parts_notes_voided_by_user_id_users_id_fk" FOREIGN KEY ("voided_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mant_parts_allocation_sources_allocation_idx" ON "mant_parts_allocation_sources" USING btree ("allocation_id","created_at");--> statement-breakpoint
CREATE INDEX "mant_parts_allocation_sources_receipt_idx" ON "mant_parts_allocation_sources" USING btree ("receipt_id");--> statement-breakpoint
CREATE INDEX "mant_parts_allocation_sources_guide_idx" ON "mant_parts_allocation_sources" USING btree ("dispatch_guide_id");--> statement-breakpoint
CREATE INDEX "mant_parts_allocation_sources_note_item_idx" ON "mant_parts_allocation_sources" USING btree ("note_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mant_parts_allocations_active_unique" ON "mant_parts_allocations" USING btree ("work_order_id","worksite_id","product_id") WHERE "mant_parts_allocations"."status" = 'activa';--> statement-breakpoint
CREATE INDEX "mant_parts_allocations_stock_idx" ON "mant_parts_allocations" USING btree ("worksite_id","product_id") WHERE "mant_parts_allocations"."status" = 'activa';--> statement-breakpoint
CREATE INDEX "mant_parts_allocations_work_order_idx" ON "mant_parts_allocations" USING btree ("work_order_id");--> statement-breakpoint
CREATE INDEX "mant_parts_note_items_note_idx" ON "mant_parts_note_items" USING btree ("note_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mant_parts_note_items_order_unique" ON "mant_parts_note_items" USING btree ("note_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "mant_parts_notes_code_unique" ON "mant_parts_notes" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "mant_parts_notes_client_op_unique" ON "mant_parts_notes" USING btree ("client_op_id");--> statement-breakpoint
CREATE INDEX "mant_parts_notes_work_order_idx" ON "mant_parts_notes" USING btree ("work_order_id");--> statement-breakpoint
CREATE INDEX "mant_parts_notes_worksite_status_idx" ON "mant_parts_notes" USING btree ("worksite_id","status");--> statement-breakpoint
ALTER TABLE "purchase_request_items" ADD CONSTRAINT "purchase_request_items_parts_note_item_fk" FOREIGN KEY ("parts_note_item_id") REFERENCES "public"."mant_parts_note_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mant_record_parts" ADD CONSTRAINT "mant_record_parts_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mant_record_parts" ADD CONSTRAINT "mant_record_parts_allocation_id_mant_parts_allocations_id_fk" FOREIGN KEY ("allocation_id") REFERENCES "public"."mant_parts_allocations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mant_record_parts" ADD CONSTRAINT "mant_record_parts_movement_fk" FOREIGN KEY ("inventory_movement_id") REFERENCES "public"."inventory_movements"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mant_record_parts" ADD CONSTRAINT "mant_record_parts_reversal_fk" FOREIGN KEY ("reversal_movement_id") REFERENCES "public"."inventory_movements"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "purchase_request_items_parts_note_item_idx" ON "purchase_request_items" USING btree ("parts_note_item_id");--> statement-breakpoint
CREATE INDEX "mant_record_parts_allocation_idx" ON "mant_record_parts" USING btree ("allocation_id");--> statement-breakpoint
CREATE INDEX "mant_record_parts_pending_idx" ON "mant_record_parts" USING btree ("stock_status") WHERE "mant_record_parts"."stock_status" = 'pendiente_conciliar';--> statement-breakpoint
CREATE UNIQUE INDEX "mant_record_parts_movement_unique" ON "mant_record_parts" USING btree ("inventory_movement_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mant_record_parts_reversal_unique" ON "mant_record_parts" USING btree ("reversal_movement_id");--> statement-breakpoint
ALTER TABLE "purchase_request_items" ADD CONSTRAINT "purchase_request_items_parts_note_needs_work_order" CHECK ("purchase_request_items"."parts_note_item_id" IS NULL OR "purchase_request_items"."work_order_id" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_type_valid" CHECK (
    "inventory_movements"."type" IN ('ingreso_oc', 'egreso_entrega', 'ingreso_devolucion', 'egreso_desecho', 'retiro_epp_trabajador', 'ajuste', 'egreso_traslado', 'ingreso_traslado', 'ingreso_anulacion', 'egreso_anulacion', 'egreso_mantencion')
  );--> statement-breakpoint
ALTER TABLE "mant_record_parts" ADD CONSTRAINT "mant_record_parts_source_valid" CHECK ("mant_record_parts"."source" IN ('stock', 'externo', 'texto'));--> statement-breakpoint
ALTER TABLE "mant_record_parts" ADD CONSTRAINT "mant_record_parts_stock_product" CHECK ("mant_record_parts"."source" <> 'stock' OR "mant_record_parts"."product_id" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "mant_record_parts" ADD CONSTRAINT "mant_record_parts_stock_status_valid" CHECK (
    ("mant_record_parts"."stock_status" = 'no_aplica' AND "mant_record_parts"."source" <> 'stock' AND "mant_record_parts"."inventory_movement_id" IS NULL AND "mant_record_parts"."reversal_movement_id" IS NULL)
    OR ("mant_record_parts"."stock_status" = 'descontado' AND "mant_record_parts"."source" = 'stock' AND "mant_record_parts"."inventory_movement_id" IS NOT NULL AND "mant_record_parts"."reversal_movement_id" IS NULL)
    OR ("mant_record_parts"."stock_status" = 'pendiente_conciliar' AND "mant_record_parts"."source" = 'stock' AND "mant_record_parts"."inventory_movement_id" IS NULL AND "mant_record_parts"."reversal_movement_id" IS NULL)
    OR ("mant_record_parts"."stock_status" = 'revertido' AND "mant_record_parts"."source" = 'stock' AND "mant_record_parts"."inventory_movement_id" IS NOT NULL AND "mant_record_parts"."reversal_movement_id" IS NOT NULL)
    OR ("mant_record_parts"."stock_status" = 'sin_movimiento' AND "mant_record_parts"."source" = 'stock' AND "mant_record_parts"."inventory_movement_id" IS NULL AND "mant_record_parts"."reversal_movement_id" IS NULL
      AND char_length(trim(coalesce("mant_record_parts"."stock_note", ''))) >= 5)
  );--> statement-breakpoint
ALTER TABLE "mant_work_order_events" ADD CONSTRAINT "mant_work_order_events_type_valid" CHECK ("mant_work_order_events"."type" IN ('created', 'edited', 'assigned', 'unassigned', 'taken', 'started', 'entry_updated', 'estimate_changed', 'item_added', 'items_marked', 'finished', 'received', 'rejected', 'conformed', 'voided', 'reopened', 'record_linked', 'parts_note_created', 'parts_note_resolved', 'parts_allocated', 'parts_consumed', 'parts_released'));