ALTER TABLE "dte_documents" ADD COLUMN "portal_record_id" text;--> statement-breakpoint
CREATE INDEX "dte_documents_portal_record_idx" ON "dte_documents" USING btree ("portal_record_id");--> statement-breakpoint
ALTER TABLE "dte_documents" ADD CONSTRAINT "dte_documents_single_business_link" CHECK (
    "dte_documents"."purchase_order_invoice_id" IS NULL OR "dte_documents"."fuel_load_id" IS NULL
  );