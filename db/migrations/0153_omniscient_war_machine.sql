ALTER TABLE "dte_sync_runs" ADD COLUMN "correlation_id" text;--> statement-breakpoint
CREATE INDEX "dte_sync_runs_correlation_idx" ON "dte_sync_runs" USING btree ("correlation_id");