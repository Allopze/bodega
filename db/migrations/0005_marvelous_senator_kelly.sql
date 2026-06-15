ALTER TABLE "delivery_items" ADD COLUMN "return_quantity" real;--> statement-breakpoint
ALTER TABLE "delivery_items" ADD COLUMN "return_product_id" text;--> statement-breakpoint
ALTER TABLE "delivery_items" ADD COLUMN "return_product_name_free" text;--> statement-breakpoint
ALTER TABLE "delivery_items" ADD COLUMN "return_reason" text;--> statement-breakpoint
ALTER TABLE "delivery_items" ADD COLUMN "return_notes" text;--> statement-breakpoint
ALTER TABLE "delivery_items" ADD CONSTRAINT "delivery_items_return_product_id_products_id_fk" FOREIGN KEY ("return_product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" DROP CONSTRAINT IF EXISTS "inventory_movements_type_valid";--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_type_valid" CHECK ("inventory_movements"."type" IN ('ingreso_oc', 'egreso_entrega', 'ingreso_devolucion', 'egreso_desecho'));