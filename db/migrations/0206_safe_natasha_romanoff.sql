CREATE TABLE "fuel_provider_mappings" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"source_account" text NOT NULL,
	"external_key" text NOT NULL,
	"normalized_value" text NOT NULL,
	"worksite_id" text NOT NULL,
	"vehicle_id" text,
	"version" integer DEFAULT 1 NOT NULL,
	"is_active" text DEFAULT 'true' NOT NULL,
	"decided_by" text NOT NULL,
	"reason" text NOT NULL,
	"effective_from" text NOT NULL,
	"effective_to" text,
	"supersedes_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fuel_provider_mappings_provider_valid" CHECK ("fuel_provider_mappings"."provider" IN ('copec', 'aramco')),
	CONSTRAINT "fuel_provider_mappings_active_valid" CHECK ("fuel_provider_mappings"."is_active" IN ('true', 'false'))
);
--> statement-breakpoint
CREATE TABLE "fuel_provider_rejections" (
	"id" text PRIMARY KEY NOT NULL,
	"sync_run_id" text NOT NULL,
	"provider" text NOT NULL,
	"source_account" text NOT NULL,
	"source_row_key" text NOT NULL,
	"code" text NOT NULL,
	"message" text NOT NULL,
	"source_product" text,
	"source_plate" text,
	"occurred_at" text,
	"quantity" numeric(14, 4),
	"amount" numeric(14, 2),
	"worksite_id" text,
	"status" text DEFAULT 'open' NOT NULL,
	"raw_payload" jsonb,
	"resolved_by" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fuel_provider_rejections_provider_valid" CHECK ("fuel_provider_rejections"."provider" IN ('copec', 'aramco')),
	CONSTRAINT "fuel_provider_rejections_status_valid" CHECK ("fuel_provider_rejections"."status" IN ('open', 'resolved', 'dismissed'))
);
--> statement-breakpoint
CREATE TABLE "fuel_provider_sync_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"trigger" text DEFAULT 'manual' NOT NULL,
	"requested_from" text NOT NULL,
	"requested_to" text NOT NULL,
	"received_from" text,
	"received_to" text,
	"status" text DEFAULT 'running' NOT NULL,
	"correlation_id" text NOT NULL,
	"actor_user_id" text,
	"pages" integer DEFAULT 0 NOT NULL,
	"files" integer DEFAULT 0 NOT NULL,
	"rows_received" integer DEFAULT 0 NOT NULL,
	"rows_accepted" integer DEFAULT 0 NOT NULL,
	"rows_rejected" integer DEFAULT 0 NOT NULL,
	"rows_pending" integer DEFAULT 0 NOT NULL,
	"rows_reprocessed" integer DEFAULT 0 NOT NULL,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "fuel_provider_sync_runs_provider_valid" CHECK ("fuel_provider_sync_runs"."provider" IN ('copec', 'aramco')),
	CONSTRAINT "fuel_provider_sync_runs_trigger_valid" CHECK ("fuel_provider_sync_runs"."trigger" IN ('manual', 'cron', 'reprocess')),
	CONSTRAINT "fuel_provider_sync_runs_status_valid" CHECK ("fuel_provider_sync_runs"."status" IN ('running', 'success', 'partial', 'failed')),
	CONSTRAINT "fuel_provider_sync_runs_period_valid" CHECK ("fuel_provider_sync_runs"."requested_from" <= "fuel_provider_sync_runs"."requested_to"),
	CONSTRAINT "fuel_provider_sync_runs_counts_valid" CHECK (
    "fuel_provider_sync_runs"."rows_received" >= 0 AND "fuel_provider_sync_runs"."rows_accepted" >= 0 AND
    "fuel_provider_sync_runs"."rows_rejected" >= 0 AND "fuel_provider_sync_runs"."rows_pending" >= 0 AND
    "fuel_provider_sync_runs"."rows_reprocessed" >= 0
  )
);
--> statement-breakpoint
CREATE TABLE "fuel_provider_transactions" (
	"id" text PRIMARY KEY NOT NULL,
	"sync_run_id" text NOT NULL,
	"provider" text NOT NULL,
	"source_account" text NOT NULL,
	"identity_key" text NOT NULL,
	"external_id" text,
	"fingerprint" text NOT NULL,
	"source_row_key" text NOT NULL,
	"worksite_id" text,
	"vehicle_id" text,
	"product_id" text,
	"source_product" text,
	"source_plate" text,
	"occurred_at" text,
	"quantity" numeric(14, 4),
	"unit_price" numeric(14, 4),
	"amount" numeric(14, 2),
	"status" text NOT NULL,
	"resolution_code" text,
	"resolution_message" text,
	"raw_payload" jsonb,
	"payload_hash" text NOT NULL,
	"supersedes_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fuel_provider_transactions_provider_valid" CHECK ("fuel_provider_transactions"."provider" IN ('copec', 'aramco')),
	CONSTRAINT "fuel_provider_transactions_status_valid" CHECK ("fuel_provider_transactions"."status" IN ('accepted', 'rejected', 'pending', 'superseded')),
	CONSTRAINT "fuel_provider_transactions_values_valid" CHECK (
    ("fuel_provider_transactions"."quantity" IS NULL OR "fuel_provider_transactions"."quantity" >= 0) AND
    ("fuel_provider_transactions"."amount" IS NULL OR "fuel_provider_transactions"."amount" >= 0) AND
    ("fuel_provider_transactions"."unit_price" IS NULL OR "fuel_provider_transactions"."unit_price" >= 0)
  )
);
--> statement-breakpoint
ALTER TABLE "fuel_provider_mappings" ADD CONSTRAINT "fuel_provider_mappings_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_provider_mappings" ADD CONSTRAINT "fuel_provider_mappings_vehicle_id_fuel_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."fuel_vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_provider_mappings" ADD CONSTRAINT "fuel_provider_mappings_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_provider_rejections" ADD CONSTRAINT "fuel_provider_rejections_sync_run_id_fuel_provider_sync_runs_id_fk" FOREIGN KEY ("sync_run_id") REFERENCES "public"."fuel_provider_sync_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_provider_rejections" ADD CONSTRAINT "fuel_provider_rejections_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_provider_rejections" ADD CONSTRAINT "fuel_provider_rejections_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_provider_sync_runs" ADD CONSTRAINT "fuel_provider_sync_runs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_provider_transactions" ADD CONSTRAINT "fuel_provider_transactions_sync_run_id_fuel_provider_sync_runs_id_fk" FOREIGN KEY ("sync_run_id") REFERENCES "public"."fuel_provider_sync_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_provider_transactions" ADD CONSTRAINT "fuel_provider_transactions_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_provider_transactions" ADD CONSTRAINT "fuel_provider_transactions_vehicle_id_fuel_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."fuel_vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_provider_transactions" ADD CONSTRAINT "fuel_provider_transactions_product_id_fuel_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."fuel_products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "fuel_provider_mappings_version_unique" ON "fuel_provider_mappings" USING btree ("provider","source_account","external_key","version");--> statement-breakpoint
CREATE UNIQUE INDEX "fuel_provider_mappings_active_unique" ON "fuel_provider_mappings" USING btree ("provider","source_account","external_key") WHERE "fuel_provider_mappings"."is_active" = 'true';--> statement-breakpoint
CREATE INDEX "fuel_provider_mappings_worksite_idx" ON "fuel_provider_mappings" USING btree ("worksite_id");--> statement-breakpoint
CREATE INDEX "fuel_provider_mappings_vehicle_idx" ON "fuel_provider_mappings" USING btree ("vehicle_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fuel_provider_rejections_source_unique" ON "fuel_provider_rejections" USING btree ("provider","source_account","source_row_key","code");--> statement-breakpoint
CREATE INDEX "fuel_provider_rejections_run_idx" ON "fuel_provider_rejections" USING btree ("sync_run_id");--> statement-breakpoint
CREATE INDEX "fuel_provider_rejections_worksite_status_idx" ON "fuel_provider_rejections" USING btree ("worksite_id","status");--> statement-breakpoint
CREATE INDEX "fuel_provider_sync_runs_provider_started_idx" ON "fuel_provider_sync_runs" USING btree ("provider","started_at");--> statement-breakpoint
CREATE INDEX "fuel_provider_sync_runs_status_idx" ON "fuel_provider_sync_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "fuel_provider_sync_runs_correlation_idx" ON "fuel_provider_sync_runs" USING btree ("correlation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fuel_provider_transactions_identity_unique" ON "fuel_provider_transactions" USING btree ("provider","source_account","identity_key");--> statement-breakpoint
CREATE INDEX "fuel_provider_transactions_run_idx" ON "fuel_provider_transactions" USING btree ("sync_run_id");--> statement-breakpoint
CREATE INDEX "fuel_provider_transactions_worksite_idx" ON "fuel_provider_transactions" USING btree ("worksite_id");--> statement-breakpoint
CREATE INDEX "fuel_provider_transactions_status_idx" ON "fuel_provider_transactions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "fuel_provider_transactions_occurred_idx" ON "fuel_provider_transactions" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "fuel_provider_transactions_source_plate_idx" ON "fuel_provider_transactions" USING btree ("source_plate");