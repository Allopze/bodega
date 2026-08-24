DROP INDEX "supplier_product_aliases_supplier_name_idx";--> statement-breakpoint
ALTER TABLE "purchase_order_invoice_items" ADD COLUMN "source_dte_document_item_id" text;--> statement-breakpoint
CREATE INDEX "po_invoice_items_source_dte_item_idx" ON "purchase_order_invoice_items" USING btree ("source_dte_document_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_product_aliases_supplier_name_unique" ON "supplier_product_aliases" USING btree ("supplier_id","normalized_name") WHERE "supplier_product_aliases"."normalized_name" IS NOT NULL;