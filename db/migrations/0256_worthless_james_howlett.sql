ALTER TABLE "purchase_order_invoices" ADD COLUMN "link_method" text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase_order_invoices" ADD COLUMN "link_order_reference" text;--> statement-breakpoint
ALTER TABLE "purchase_order_invoices" ADD CONSTRAINT "purchase_order_invoices_link_method_valid" CHECK (
    "purchase_order_invoices"."link_method" IN ('legacy', 'manual_upload', 'dte_candidate')
  );--> statement-breakpoint
ALTER TABLE "purchase_order_invoices" ADD CONSTRAINT "purchase_order_invoices_link_order_reference_valid" CHECK (
    "purchase_order_invoices"."link_order_reference" IS NULL
    OR "purchase_order_invoices"."link_order_reference" IN ('exact', 'correlative', 'year', 'foreign', 'none')
  );