CREATE TABLE "purchase_order_invoice_receipts" (
	"invoice_id" text NOT NULL,
	"receipt_id" text NOT NULL,
	"linked_by" text NOT NULL,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_order_invoice_receipts_invoice_id_receipt_id_pk" PRIMARY KEY("invoice_id","receipt_id")
);
--> statement-breakpoint
ALTER TABLE "purchase_orders" DROP CONSTRAINT "purchase_orders_invoice_reconciliation_status_valid";--> statement-breakpoint
ALTER TABLE "purchase_order_invoice_receipts" ADD CONSTRAINT "purchase_order_invoice_receipts_invoice_id_purchase_order_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."purchase_order_invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_invoice_receipts" ADD CONSTRAINT "purchase_order_invoice_receipts_receipt_id_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."receipts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_invoice_receipts" ADD CONSTRAINT "purchase_order_invoice_receipts_linked_by_users_id_fk" FOREIGN KEY ("linked_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "po_invoice_receipts_receipt_idx" ON "purchase_order_invoice_receipts" USING btree ("receipt_id");--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_invoice_reconciliation_status_valid" CHECK (
    "purchase_orders"."invoice_reconciliation_status" IN (
      'no_invoices', 'partially_invoiced', 'awaiting_receipt',
      'matched', 'needs_review', 'accepted_exception'
    )
  );