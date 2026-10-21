CREATE TABLE "fuel_provider_event_revisions" (
	"id" text PRIMARY KEY NOT NULL,
	"transaction_id" text NOT NULL,
	"sync_run_id" text NOT NULL,
	"source_file_id" text,
	"fingerprint" text NOT NULL,
	"quantity" numeric(14, 4),
	"unit_price" numeric(14, 4),
	"amount" numeric(14, 2),
	"amount_basis" text DEFAULT 'reported' NOT NULL,
	"status" text NOT NULL,
	"payload_hash" text NOT NULL,
	"raw_payload" jsonb,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fuel_provider_event_revisions_amount_basis_valid" CHECK ("fuel_provider_event_revisions"."amount_basis" = 'reported'),
	CONSTRAINT "fuel_provider_event_revisions_status_valid" CHECK ("fuel_provider_event_revisions"."status" IN ('accepted', 'rejected', 'pending', 'superseded', 'correction_review'))
);
--> statement-breakpoint
CREATE TABLE "fuel_provider_files" (
	"id" text PRIMARY KEY NOT NULL,
	"sync_run_id" text NOT NULL,
	"provider" text NOT NULL,
	"source_account" text NOT NULL,
	"channel" text NOT NULL,
	"product" text NOT NULL,
	"period_month" text NOT NULL,
	"original_file_name" text NOT NULL,
	"storage_path" text NOT NULL,
	"source_sha256" text NOT NULL,
	"encrypted_sha256" text NOT NULL,
	"encryption_iv" text NOT NULL,
	"encryption_auth_tag" text NOT NULL,
	"encryption_key_version" text NOT NULL,
	"parser_version" text NOT NULL,
	"source_bytes" integer NOT NULL,
	"rows_received" integer DEFAULT 0 NOT NULL,
	"rows_accepted" integer DEFAULT 0 NOT NULL,
	"rows_rejected" integer DEFAULT 0 NOT NULL,
	"rows_pending" integer DEFAULT 0 NOT NULL,
	"quantity_total" numeric(14, 4) DEFAULT 0 NOT NULL,
	"amount_total" numeric(14, 2) DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'archived' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fuel_provider_files_provider_valid" CHECK ("fuel_provider_files"."provider" IN ('copec', 'aramco')),
	CONSTRAINT "fuel_provider_files_channel_valid" CHECK ("fuel_provider_files"."channel" IN ('TCT', 'TAE')),
	CONSTRAINT "fuel_provider_files_product_valid" CHECK ("fuel_provider_files"."product" IN ('diesel', 'bluemax')),
	CONSTRAINT "fuel_provider_files_status_valid" CHECK ("fuel_provider_files"."status" IN ('archived', 'processed', 'invalid')),
	CONSTRAINT "fuel_provider_files_counts_valid" CHECK ("fuel_provider_files"."source_bytes" > 0 AND "fuel_provider_files"."rows_received" >= 0 AND "fuel_provider_files"."rows_accepted" >= 0 AND "fuel_provider_files"."rows_rejected" >= 0 AND "fuel_provider_files"."rows_pending" >= 0)
);
--> statement-breakpoint
CREATE TABLE "fuel_provider_period_coverage" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"source_account" text NOT NULL,
	"channel" text NOT NULL,
	"product" text NOT NULL,
	"period_month" text NOT NULL,
	"status" text DEFAULT 'unknown' NOT NULL,
	"source_availability" text DEFAULT 'unknown' NOT NULL,
	"sync_run_id" text,
	"source_file_id" text,
	"rows_received" integer DEFAULT 0 NOT NULL,
	"rows_accepted" integer DEFAULT 0 NOT NULL,
	"rows_rejected" integer DEFAULT 0 NOT NULL,
	"quantity_total" numeric(14, 4) DEFAULT 0 NOT NULL,
	"amount_total" numeric(14, 2) DEFAULT 0 NOT NULL,
	"parser_version" text,
	"evidence" text,
	"evidence_actor_user_id" text,
	"rows_pending" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fuel_provider_coverage_provider_valid" CHECK ("fuel_provider_period_coverage"."provider" IN ('copec', 'aramco')),
	CONSTRAINT "fuel_provider_coverage_channel_valid" CHECK ("fuel_provider_period_coverage"."channel" IN ('TCT', 'TAE')),
	CONSTRAINT "fuel_provider_coverage_product_valid" CHECK ("fuel_provider_period_coverage"."product" IN ('diesel', 'bluemax')),
	CONSTRAINT "fuel_provider_coverage_status_valid" CHECK ("fuel_provider_period_coverage"."status" IN ('unknown', 'incomplete', 'failed', 'complete', 'legitimate_empty')),
	CONSTRAINT "fuel_provider_coverage_source_valid" CHECK ("fuel_provider_period_coverage"."source_availability" IN ('unknown', 'available', 'unavailable')),
	CONSTRAINT "fuel_provider_coverage_period_valid" CHECK ("fuel_provider_period_coverage"."period_month" ~ '^\d{4}-(0[1-9]|1[0-2])-01$'),
	CONSTRAINT "fuel_provider_coverage_counts_valid" CHECK ("fuel_provider_period_coverage"."rows_received" >= 0 AND "fuel_provider_period_coverage"."rows_accepted" >= 0 AND "fuel_provider_period_coverage"."rows_rejected" >= 0 AND "fuel_provider_period_coverage"."rows_pending" >= 0),
	CONSTRAINT "fuel_provider_coverage_empty_evidence" CHECK ("fuel_provider_period_coverage"."status" <> 'legitimate_empty' OR ("fuel_provider_period_coverage"."source_availability" = 'available' AND "fuel_provider_period_coverage"."evidence" IS NOT NULL AND length(trim("fuel_provider_period_coverage"."evidence")) > 0 AND "fuel_provider_period_coverage"."evidence_actor_user_id" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "fuel_provider_transactions" ADD COLUMN "storage_location_id" text;--> statement-breakpoint
ALTER TABLE "fuel_provider_transactions" ADD COLUMN "amount_basis" text DEFAULT 'reported' NOT NULL;--> statement-breakpoint
ALTER TABLE "fuel_provider_event_revisions" ADD CONSTRAINT "fuel_provider_event_rev_transaction_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."fuel_provider_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_provider_event_revisions" ADD CONSTRAINT "fuel_provider_event_rev_run_fk" FOREIGN KEY ("sync_run_id") REFERENCES "public"."fuel_provider_sync_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_provider_event_revisions" ADD CONSTRAINT "fuel_provider_event_rev_file_fk" FOREIGN KEY ("source_file_id") REFERENCES "public"."fuel_provider_files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_provider_files" ADD CONSTRAINT "fuel_provider_files_run_fk" FOREIGN KEY ("sync_run_id") REFERENCES "public"."fuel_provider_sync_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_provider_period_coverage" ADD CONSTRAINT "fuel_provider_coverage_run_fk" FOREIGN KEY ("sync_run_id") REFERENCES "public"."fuel_provider_sync_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_provider_period_coverage" ADD CONSTRAINT "fuel_provider_coverage_file_fk" FOREIGN KEY ("source_file_id") REFERENCES "public"."fuel_provider_files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_provider_period_coverage" ADD CONSTRAINT "fuel_provider_coverage_actor_fk" FOREIGN KEY ("evidence_actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "fuel_provider_event_revision_unique" ON "fuel_provider_event_revisions" USING btree ("transaction_id","fingerprint","source_file_id");--> statement-breakpoint
CREATE INDEX "fuel_provider_event_revision_observed_idx" ON "fuel_provider_event_revisions" USING btree ("transaction_id","observed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "fuel_provider_files_evidence_unique" ON "fuel_provider_files" USING btree ("sync_run_id","channel","product","period_month","source_sha256");--> statement-breakpoint
CREATE INDEX "fuel_provider_files_period_idx" ON "fuel_provider_files" USING btree ("provider","source_account","channel","product","period_month");--> statement-breakpoint
CREATE UNIQUE INDEX "fuel_provider_coverage_period_unique" ON "fuel_provider_period_coverage" USING btree ("provider","source_account","channel","product","period_month");--> statement-breakpoint
CREATE INDEX "fuel_provider_coverage_status_idx" ON "fuel_provider_period_coverage" USING btree ("provider","status","period_month");--> statement-breakpoint
ALTER TABLE "fuel_provider_transactions" ADD CONSTRAINT "fuel_provider_tx_storage_fk" FOREIGN KEY ("storage_location_id") REFERENCES "public"."fuel_storage_locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_provider_transactions" ADD CONSTRAINT "fuel_provider_transactions_amount_basis_valid" CHECK ("fuel_provider_transactions"."amount_basis" = 'reported');