ALTER TABLE "fuel_provider_sync_runs" DROP CONSTRAINT "fuel_provider_sync_runs_counts_valid";--> statement-breakpoint
ALTER TABLE "fuel_provider_sync_runs" ADD COLUMN "affected_quantity" numeric(14, 4) DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "fuel_provider_sync_runs" ADD COLUMN "affected_amount" numeric(14, 2) DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "fuel_provider_sync_runs" ADD CONSTRAINT "fuel_provider_sync_runs_counts_valid" CHECK (
    "fuel_provider_sync_runs"."rows_received" >= 0 AND "fuel_provider_sync_runs"."rows_accepted" >= 0 AND
    "fuel_provider_sync_runs"."rows_rejected" >= 0 AND "fuel_provider_sync_runs"."rows_pending" >= 0 AND
    "fuel_provider_sync_runs"."rows_reprocessed" >= 0 AND "fuel_provider_sync_runs"."affected_quantity" >= 0 AND
    "fuel_provider_sync_runs"."affected_amount" >= 0
  );