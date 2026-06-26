CREATE TABLE "cost_centers" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"worksite_id" text,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cost_centers_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "maintenance_records" (
	"id" text PRIMARY KEY NOT NULL,
	"vehicle_id" text NOT NULL,
	"supplier_id" text,
	"worksite_id" text,
	"cost_center_id" text,
	"maintenance_date" text NOT NULL,
	"maintenance_type" text NOT NULL,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"odometer_reading" numeric(12, 2),
	"hour_meter_reading" numeric(12, 2),
	"net_amount" numeric(14, 2) DEFAULT 0 NOT NULL,
	"tax_amount" numeric(14, 2) DEFAULT 0 NOT NULL,
	"total_amount" numeric(14, 2) DEFAULT 0 NOT NULL,
	"document_number" text,
	"document_name" text,
	"document_path" text,
	"document_mime_type" text,
	"notes" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "maintenance_records_status_valid" CHECK (
    "maintenance_records"."status" IN ('scheduled', 'in_progress', 'completed', 'cancelled')
  ),
	CONSTRAINT "maintenance_records_amounts_non_negative" CHECK (
    "maintenance_records"."net_amount" >= 0
    AND "maintenance_records"."tax_amount" >= 0
    AND "maintenance_records"."total_amount" >= 0
  )
);
--> statement-breakpoint
CREATE TABLE "vehicle_cost_allocations" (
	"id" text PRIMARY KEY NOT NULL,
	"vehicle_id" text NOT NULL,
	"worksite_id" text,
	"cost_center_id" text,
	"purchase_order_item_id" text,
	"fuel_load_id" text,
	"maintenance_record_id" text,
	"cost_category" text DEFAULT 'parts' NOT NULL,
	"allocation_date" text NOT NULL,
	"amount" numeric(14, 2) DEFAULT 0 NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vehicle_cost_allocations_category_valid" CHECK (
    "vehicle_cost_allocations"."cost_category" IN ('fuel', 'parts', 'service', 'maintenance', 'other')
  ),
	CONSTRAINT "vehicle_cost_allocations_amount_non_negative" CHECK ("vehicle_cost_allocations"."amount" >= 0),
	CONSTRAINT "vehicle_cost_allocations_source_present" CHECK (
    "vehicle_cost_allocations"."purchase_order_item_id" IS NOT NULL
    OR "vehicle_cost_allocations"."fuel_load_id" IS NOT NULL
    OR "vehicle_cost_allocations"."maintenance_record_id" IS NOT NULL
  )
);
--> statement-breakpoint
ALTER TABLE "purchase_requests" ADD COLUMN "cost_center_id" text;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "cost_center_id" text;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "closed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "cost_center_id" text;--> statement-breakpoint
ALTER TABLE "fuel_loads" ADD COLUMN "cost_center_id" text;--> statement-breakpoint
ALTER TABLE "fuel_loads" ADD COLUMN "odometer_reading" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "fuel_loads" ADD COLUMN "hour_meter_reading" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "cost_centers" ADD CONSTRAINT "cost_centers_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_records" ADD CONSTRAINT "maintenance_records_vehicle_id_fuel_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."fuel_vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_records" ADD CONSTRAINT "maintenance_records_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_records" ADD CONSTRAINT "maintenance_records_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_records" ADD CONSTRAINT "maintenance_records_cost_center_id_cost_centers_id_fk" FOREIGN KEY ("cost_center_id") REFERENCES "public"."cost_centers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_records" ADD CONSTRAINT "maintenance_records_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_cost_allocations" ADD CONSTRAINT "vehicle_cost_allocations_vehicle_id_fuel_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."fuel_vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_cost_allocations" ADD CONSTRAINT "vehicle_cost_allocations_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_cost_allocations" ADD CONSTRAINT "vehicle_cost_allocations_cost_center_id_cost_centers_id_fk" FOREIGN KEY ("cost_center_id") REFERENCES "public"."cost_centers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_cost_allocations" ADD CONSTRAINT "vehicle_cost_allocations_purchase_order_item_id_purchase_order_items_id_fk" FOREIGN KEY ("purchase_order_item_id") REFERENCES "public"."purchase_order_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_cost_allocations" ADD CONSTRAINT "vehicle_cost_allocations_fuel_load_id_fuel_loads_id_fk" FOREIGN KEY ("fuel_load_id") REFERENCES "public"."fuel_loads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_cost_allocations" ADD CONSTRAINT "vehicle_cost_allocations_maintenance_record_id_maintenance_records_id_fk" FOREIGN KEY ("maintenance_record_id") REFERENCES "public"."maintenance_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cost_centers_worksite_idx" ON "cost_centers" USING btree ("worksite_id");--> statement-breakpoint
CREATE INDEX "cost_centers_active_idx" ON "cost_centers" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "maintenance_records_vehicle_date_idx" ON "maintenance_records" USING btree ("vehicle_id","maintenance_date");--> statement-breakpoint
CREATE INDEX "maintenance_records_worksite_idx" ON "maintenance_records" USING btree ("worksite_id");--> statement-breakpoint
CREATE INDEX "maintenance_records_cost_center_idx" ON "maintenance_records" USING btree ("cost_center_id");--> statement-breakpoint
CREATE INDEX "maintenance_records_status_idx" ON "maintenance_records" USING btree ("status");--> statement-breakpoint
CREATE INDEX "vehicle_cost_allocations_vehicle_date_idx" ON "vehicle_cost_allocations" USING btree ("vehicle_id","allocation_date");--> statement-breakpoint
CREATE INDEX "vehicle_cost_allocations_worksite_idx" ON "vehicle_cost_allocations" USING btree ("worksite_id");--> statement-breakpoint
CREATE INDEX "vehicle_cost_allocations_cost_center_idx" ON "vehicle_cost_allocations" USING btree ("cost_center_id");--> statement-breakpoint
CREATE INDEX "vehicle_cost_allocations_category_idx" ON "vehicle_cost_allocations" USING btree ("cost_category");--> statement-breakpoint
ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_cost_center_id_cost_centers_id_fk" FOREIGN KEY ("cost_center_id") REFERENCES "public"."cost_centers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_cost_center_id_cost_centers_id_fk" FOREIGN KEY ("cost_center_id") REFERENCES "public"."cost_centers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_cost_center_id_cost_centers_id_fk" FOREIGN KEY ("cost_center_id") REFERENCES "public"."cost_centers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_loads" ADD CONSTRAINT "fuel_loads_cost_center_id_cost_centers_id_fk" FOREIGN KEY ("cost_center_id") REFERENCES "public"."cost_centers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "purchase_requests_cost_center_idx" ON "purchase_requests" USING btree ("cost_center_id");--> statement-breakpoint
CREATE INDEX "purchase_orders_cost_center_idx" ON "purchase_orders" USING btree ("cost_center_id");--> statement-breakpoint
CREATE INDEX "fuel_loads_cost_center_idx" ON "fuel_loads" USING btree ("cost_center_id");