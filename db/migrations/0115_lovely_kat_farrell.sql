CREATE TABLE "purchase_order_invoice_items" (
	"id" text PRIMARY KEY NOT NULL,
	"invoice_id" text NOT NULL,
	"purchase_order_item_id" text,
	"product_name" text NOT NULL,
	"quantity" real NOT NULL,
	"unit_price" numeric(12, 2) NOT NULL,
	"subtotal" numeric(12, 2) NOT NULL,
	CONSTRAINT "po_invoice_items_qty_positive" CHECK ("purchase_order_invoice_items"."quantity" > 0),
	CONSTRAINT "po_invoice_items_amounts_non_negative" CHECK ("purchase_order_invoice_items"."unit_price" >= 0 AND "purchase_order_invoice_items"."subtotal" >= 0)
);
--> statement-breakpoint
ALTER TABLE "purchase_order_invoice_items" ADD CONSTRAINT "purchase_order_invoice_items_invoice_id_purchase_order_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."purchase_order_invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_invoice_items" ADD CONSTRAINT "purchase_order_invoice_items_purchase_order_item_id_purchase_order_items_id_fk" FOREIGN KEY ("purchase_order_item_id") REFERENCES "public"."purchase_order_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "po_invoice_items_invoice_idx" ON "purchase_order_invoice_items" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "po_invoice_items_oc_item_idx" ON "purchase_order_invoice_items" USING btree ("purchase_order_item_id");