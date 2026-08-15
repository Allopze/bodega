ALTER TABLE "dte_sync_runs" ADD COLUMN "reconciliation_status" text DEFAULT 'not_run' NOT NULL;--> statement-breakpoint
ALTER TABLE "dte_sync_runs" ADD COLUMN "reconciliation_error" text;--> statement-breakpoint
CREATE UNIQUE INDEX "dte_documents_purchase_invoice_single_unique" ON "dte_documents" USING btree ("purchase_order_invoice_id") WHERE "dte_documents"."purchase_order_invoice_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "dte_sync_runs_reconciliation_status_idx" ON "dte_sync_runs" USING btree ("reconciliation_status");--> statement-breakpoint
ALTER TABLE "dte_sync_runs" ADD CONSTRAINT "dte_sync_runs_reconciliation_status_valid" CHECK ("dte_sync_runs"."reconciliation_status" IN ('not_run', 'success', 'partial', 'failed'));