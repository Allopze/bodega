CREATE TABLE "purchase_order_invoice_reconciliation_reviews" (
	"id" text PRIMARY KEY NOT NULL,
	"purchase_order_id" text NOT NULL,
	"fingerprint" text NOT NULL,
	"reason" text NOT NULL,
	"evidence" jsonb NOT NULL,
	"reviewed_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "po_invoice_reconciliation_reviews_reason_length" CHECK (char_length("purchase_order_invoice_reconciliation_reviews"."reason") BETWEEN 10 AND 1000)
);
--> statement-breakpoint
ALTER TABLE "product_supplier_price_history" RENAME COLUMN "unit_price" TO "new_price";--> statement-breakpoint
ALTER TABLE "product_supplier_price_history" ALTER COLUMN "new_price" TYPE numeric(12, 2) USING "new_price"::numeric(12, 2);--> statement-breakpoint
ALTER TABLE "product_supplier_price_history" ALTER COLUMN "new_price" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "invoice_reconciliation_status" text DEFAULT 'no_invoices' NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "invoice_reconciliation_fingerprint" text;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "invoice_reconciliation_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "product_supplier_price_history" ADD COLUMN "previous_price" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "product_supplier_price_history" ADD COLUMN "source" text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
ALTER TABLE "product_supplier_price_history" ADD COLUMN "source_id" text;--> statement-breakpoint
ALTER TABLE "purchase_order_invoice_reconciliation_reviews" ADD CONSTRAINT "purchase_order_invoice_reconciliation_reviews_purchase_order_id_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_invoice_reconciliation_reviews" ADD CONSTRAINT "purchase_order_invoice_reconciliation_reviews_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "po_invoice_reconciliation_reviews_order_fingerprint_unique" ON "purchase_order_invoice_reconciliation_reviews" USING btree ("purchase_order_id","fingerprint");--> statement-breakpoint
CREATE INDEX "po_invoice_reconciliation_reviews_order_created_idx" ON "purchase_order_invoice_reconciliation_reviews" USING btree ("purchase_order_id","created_at");--> statement-breakpoint
CREATE INDEX "purchase_orders_invoice_reconciliation_idx" ON "purchase_orders" USING btree ("invoice_reconciliation_status","status");--> statement-breakpoint
CREATE INDEX "product_supplier_price_history_product_supplier_date_idx" ON "product_supplier_price_history" USING btree ("product_id","supplier_id","effective_date");--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_invoice_reconciliation_status_valid" CHECK (
    "purchase_orders"."invoice_reconciliation_status" IN ('no_invoices', 'matched', 'needs_review', 'accepted_exception')
  );--> statement-breakpoint
ALTER TABLE "product_supplier_price_history" ALTER COLUMN "source" DROP DEFAULT;--> statement-breakpoint
UPDATE "purchase_orders" AS po
SET
  "invoice_reconciliation_status" = 'needs_review',
  "invoice_reconciliation_fingerprint" = NULL,
  "invoice_reconciliation_updated_at" = now()
WHERE EXISTS (
  SELECT 1
  FROM "purchase_order_invoices" AS poi
  WHERE poi."purchase_order_id" = po."id"
);--> statement-breakpoint
INSERT INTO "product_supplier_price_history" (
  "id", "product_id", "supplier_id", "previous_price", "new_price",
  "source", "source_id", "effective_date", "created_at"
)
SELECT
  'baseline:' || md5(ps."product_id" || ':' || ps."supplier_id"),
  ps."product_id", ps."supplier_id", NULL, ps."unit_price",
  'baseline', ps."id", COALESCE(ps."last_updated", now()), now()
FROM "product_suppliers" AS ps
WHERE ps."unit_price" IS NOT NULL
ON CONFLICT ("id") DO NOTHING;
