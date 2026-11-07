ALTER TABLE "purchase_request_items" ADD COLUMN "vehicle_id" text;--> statement-breakpoint
ALTER TABLE "purchase_request_items" ADD COLUMN "work_order_id" text;--> statement-breakpoint
ALTER TABLE "purchase_request_items" ADD COLUMN "estimated_unit_price" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "purchase_request_items" ADD CONSTRAINT "purchase_request_items_vehicle_id_fuel_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."fuel_vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_request_items" ADD CONSTRAINT "purchase_request_items_work_order_id_mant_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."mant_work_orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "purchase_request_items_vehicle_idx" ON "purchase_request_items" USING btree ("vehicle_id");--> statement-breakpoint
CREATE INDEX "purchase_request_items_work_order_idx" ON "purchase_request_items" USING btree ("work_order_id");--> statement-breakpoint
ALTER TABLE "purchase_request_items" ADD CONSTRAINT "purchase_request_items_work_order_needs_vehicle" CHECK ("purchase_request_items"."work_order_id" IS NULL OR "purchase_request_items"."vehicle_id" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "purchase_request_items" ADD CONSTRAINT "purchase_request_items_one_asset_subject" CHECK (NOT ("purchase_request_items"."vehicle_id" IS NOT NULL AND ("purchase_request_items"."equipment_id" IS NOT NULL OR "purchase_request_items"."emergency_resource_id" IS NOT NULL)));