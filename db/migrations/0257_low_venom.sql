ALTER TABLE "purchase_order_invoice_items" DROP CONSTRAINT "po_invoice_items_qty_positive";--> statement-breakpoint
ALTER TABLE "purchase_order_invoice_items" DROP CONSTRAINT "po_invoice_items_amounts_non_negative";--> statement-breakpoint
ALTER TABLE "purchase_order_invoices" DROP CONSTRAINT "purchase_order_invoices_amount_non_negative";--> statement-breakpoint
DROP INDEX "purchase_order_invoices_order_number_unique";--> statement-breakpoint
ALTER TABLE "purchase_order_invoices" ADD COLUMN "document_kind" text DEFAULT 'invoice' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_order_invoices_order_number_unique" ON "purchase_order_invoices" USING btree ("purchase_order_id","document_kind","invoice_number");--> statement-breakpoint
ALTER TABLE "purchase_order_invoice_items" ADD CONSTRAINT "po_invoice_items_qty_not_zero" CHECK ("purchase_order_invoice_items"."quantity" <> 0);--> statement-breakpoint
ALTER TABLE "purchase_order_invoice_items" ADD CONSTRAINT "po_invoice_items_sign_consistent" CHECK (
    ("purchase_order_invoice_items"."quantity" > 0 AND "purchase_order_invoice_items"."subtotal" >= 0)
    OR ("purchase_order_invoice_items"."quantity" < 0 AND "purchase_order_invoice_items"."subtotal" <= 0)
  );--> statement-breakpoint
ALTER TABLE "purchase_order_invoice_items" ADD CONSTRAINT "po_invoice_items_unit_price_non_negative" CHECK ("purchase_order_invoice_items"."unit_price" >= 0);--> statement-breakpoint
ALTER TABLE "purchase_order_invoices" ADD CONSTRAINT "purchase_order_invoices_document_kind_valid" CHECK (
    "purchase_order_invoices"."document_kind" IN ('invoice', 'credit_note')
  );--> statement-breakpoint
ALTER TABLE "purchase_order_invoices" ADD CONSTRAINT "purchase_order_invoices_amount_sign_matches_kind" CHECK (
    ("purchase_order_invoices"."document_kind" = 'invoice' AND "purchase_order_invoices"."amount" >= 0)
    OR ("purchase_order_invoices"."document_kind" = 'credit_note' AND "purchase_order_invoices"."amount" <= 0)
  );