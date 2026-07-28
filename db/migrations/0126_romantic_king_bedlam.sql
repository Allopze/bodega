CREATE TABLE "delivery_item_lots" (
	"id" text PRIMARY KEY NOT NULL,
	"delivery_item_id" text NOT NULL,
	"inventory_lot_id" text NOT NULL,
	"quantity" real NOT NULL,
	CONSTRAINT "delivery_item_lots_quantity_positive" CHECK ("delivery_item_lots"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "inventory_lots" (
	"id" text PRIMARY KEY NOT NULL,
	"worksite_id" text NOT NULL,
	"product_id" text NOT NULL,
	"receipt_item_id" text NOT NULL,
	"lot_number" text NOT NULL,
	"manufactured_at" text NOT NULL,
	"expires_at" text NOT NULL,
	"quantity_received" real NOT NULL,
	"quantity_available" real NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_lots_quantities_valid" CHECK ("inventory_lots"."quantity_received" > 0 AND "inventory_lots"."quantity_available" >= 0 AND "inventory_lots"."quantity_available" <= "inventory_lots"."quantity_received"),
	CONSTRAINT "inventory_lots_dates_valid" CHECK ("inventory_lots"."manufactured_at" <= "inventory_lots"."expires_at")
);
--> statement-breakpoint
ALTER TABLE "delivery_item_lots" ADD CONSTRAINT "delivery_item_lots_delivery_item_id_delivery_items_id_fk" FOREIGN KEY ("delivery_item_id") REFERENCES "public"."delivery_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_item_lots" ADD CONSTRAINT "delivery_item_lots_inventory_lot_id_inventory_lots_id_fk" FOREIGN KEY ("inventory_lot_id") REFERENCES "public"."inventory_lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_lots" ADD CONSTRAINT "inventory_lots_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_lots" ADD CONSTRAINT "inventory_lots_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_lots" ADD CONSTRAINT "inventory_lots_receipt_item_id_receipt_items_id_fk" FOREIGN KEY ("receipt_item_id") REFERENCES "public"."receipt_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_item_lots_unique" ON "delivery_item_lots" USING btree ("delivery_item_id","inventory_lot_id");--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_lots_unique_source" ON "inventory_lots" USING btree ("receipt_item_id");--> statement-breakpoint
CREATE INDEX "inventory_lots_fefo_idx" ON "inventory_lots" USING btree ("worksite_id","product_id","expires_at");