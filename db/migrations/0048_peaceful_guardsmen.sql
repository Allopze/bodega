CREATE TABLE "fuel_cycle_movements" (
	"id" text PRIMARY KEY NOT NULL,
	"event_type" text NOT NULL,
	"worksite_id" text NOT NULL,
	"product_id" text NOT NULL,
	"quantity" numeric(14, 4) NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"supplier_id" text,
	"source_location_id" text,
	"target_location_id" text,
	"vehicle_id" text,
	"document_number" text,
	"source_type" text,
	"source_id" text,
	"notes" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fuel_cycle_movements_event_valid" CHECK ("fuel_cycle_movements"."event_type" IN ('received', 'transfer', 'tank_delivery', 'direct_delivery')),
	CONSTRAINT "fuel_cycle_movements_quantity_positive" CHECK ("fuel_cycle_movements"."quantity" > 0),
	CONSTRAINT "fuel_cycle_movements_shape_valid" CHECK (
    ("fuel_cycle_movements"."event_type" = 'received' AND "fuel_cycle_movements"."target_location_id" IS NOT NULL AND "fuel_cycle_movements"."supplier_id" IS NOT NULL)
    OR ("fuel_cycle_movements"."event_type" = 'transfer' AND "fuel_cycle_movements"."source_location_id" IS NOT NULL AND "fuel_cycle_movements"."target_location_id" IS NOT NULL AND "fuel_cycle_movements"."source_location_id" <> "fuel_cycle_movements"."target_location_id")
    OR ("fuel_cycle_movements"."event_type" = 'tank_delivery' AND "fuel_cycle_movements"."source_location_id" IS NOT NULL AND "fuel_cycle_movements"."vehicle_id" IS NOT NULL)
    OR ("fuel_cycle_movements"."event_type" = 'direct_delivery' AND "fuel_cycle_movements"."vehicle_id" IS NOT NULL AND "fuel_cycle_movements"."supplier_id" IS NOT NULL)
  )
);
--> statement-breakpoint
CREATE TABLE "fuel_storage_locations" (
	"id" text PRIMARY KEY NOT NULL,
	"worksite_id" text NOT NULL,
	"product_id" text NOT NULL,
	"name" text NOT NULL,
	"capacity_liters" numeric(14, 2),
	"is_active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fuel_storage_locations_capacity_positive" CHECK ("fuel_storage_locations"."capacity_liters" IS NULL OR "fuel_storage_locations"."capacity_liters" > 0)
);
--> statement-breakpoint
ALTER TABLE "fuel_cycle_movements" ADD CONSTRAINT "fuel_cycle_movements_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_cycle_movements" ADD CONSTRAINT "fuel_cycle_movements_product_id_fuel_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."fuel_products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_cycle_movements" ADD CONSTRAINT "fuel_cycle_movements_supplier_id_fuel_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."fuel_suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_cycle_movements" ADD CONSTRAINT "fuel_cycle_movements_source_location_id_fuel_storage_locations_id_fk" FOREIGN KEY ("source_location_id") REFERENCES "public"."fuel_storage_locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_cycle_movements" ADD CONSTRAINT "fuel_cycle_movements_target_location_id_fuel_storage_locations_id_fk" FOREIGN KEY ("target_location_id") REFERENCES "public"."fuel_storage_locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_cycle_movements" ADD CONSTRAINT "fuel_cycle_movements_vehicle_id_fuel_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."fuel_vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_cycle_movements" ADD CONSTRAINT "fuel_cycle_movements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_storage_locations" ADD CONSTRAINT "fuel_storage_locations_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_storage_locations" ADD CONSTRAINT "fuel_storage_locations_product_id_fuel_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."fuel_products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fuel_cycle_movements_worksite_time_idx" ON "fuel_cycle_movements" USING btree ("worksite_id","occurred_at");--> statement-breakpoint
CREATE INDEX "fuel_cycle_movements_product_time_idx" ON "fuel_cycle_movements" USING btree ("product_id","occurred_at");--> statement-breakpoint
CREATE INDEX "fuel_cycle_movements_vehicle_time_idx" ON "fuel_cycle_movements" USING btree ("vehicle_id","occurred_at");--> statement-breakpoint
CREATE INDEX "fuel_cycle_movements_source_idx" ON "fuel_cycle_movements" USING btree ("source_type","source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fuel_storage_locations_worksite_name_unique" ON "fuel_storage_locations" USING btree ("worksite_id","name");--> statement-breakpoint
CREATE INDEX "fuel_storage_locations_worksite_product_idx" ON "fuel_storage_locations" USING btree ("worksite_id","product_id");