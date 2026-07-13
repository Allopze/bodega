CREATE TABLE "fuel_tae_evidence" (
	"id" text PRIMARY KEY NOT NULL,
	"submission_id" text NOT NULL,
	"kind" text NOT NULL,
	"file_name" text NOT NULL,
	"file_path" text,
	"file_size" integer,
	"mime_type" text,
	"sha256" text,
	"external_url" text,
	"captured_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fuel_tae_evidence_kind_valid" CHECK ("fuel_tae_evidence"."kind" IN ('odometer', 'liter_meter', 'removed_seal', 'installed_seal'))
);
--> statement-breakpoint
CREATE TABLE "fuel_tae_import_batches" (
	"id" text PRIMARY KEY NOT NULL,
	"file_name" text NOT NULL,
	"file_path" text,
	"file_hash" text NOT NULL,
	"status" text DEFAULT 'imported' NOT NULL,
	"total_rows" integer DEFAULT 0 NOT NULL,
	"valid_rows" integer DEFAULT 0 NOT NULL,
	"observed_rows" integer DEFAULT 0 NOT NULL,
	"invalid_rows" integer DEFAULT 0 NOT NULL,
	"total_liters" numeric(14, 4) DEFAULT 0 NOT NULL,
	"imported_by" text NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fuel_tae_import_batches_status_valid" CHECK ("fuel_tae_import_batches"."status" IN ('imported', 'reverted'))
);
--> statement-breakpoint
CREATE TABLE "fuel_tae_loading_points" (
	"id" text PRIMARY KEY NOT NULL,
	"worksite_id" text NOT NULL,
	"name" text NOT NULL,
	"type" text DEFAULT 'other' NOT NULL,
	"import_aliases" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fuel_tae_loading_points_type_valid" CHECK ("fuel_tae_loading_points"."type" IN ('fixed_dispenser', 'truck_dispenser', 'pickup_tank', 'tae', 'other'))
);
--> statement-breakpoint
CREATE TABLE "fuel_tae_public_links" (
	"id" text PRIMARY KEY NOT NULL,
	"worksite_id" text NOT NULL,
	"loading_point_id" text,
	"label" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fuel_tae_public_links_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "fuel_tae_submissions" (
	"id" text PRIMARY KEY NOT NULL,
	"client_submission_id" text NOT NULL,
	"import_batch_id" text,
	"source" text DEFAULT 'public_pwa' NOT NULL,
	"legacy_source_id" text,
	"public_result_token" text NOT NULL,
	"public_result_revoked_at" timestamp with time zone,
	"worksite_id" text NOT NULL,
	"loading_point_id" text,
	"vehicle_id" text,
	"equipment_code_snapshot" text NOT NULL,
	"plate_snapshot" text,
	"loaded_at" timestamp with time zone NOT NULL,
	"submitted_at" timestamp with time zone NOT NULL,
	"driver_worker_id" text,
	"driver_name_snapshot" text NOT NULL,
	"supervisor_worker_id" text,
	"supervisor_name_snapshot" text NOT NULL,
	"manual_identity" boolean DEFAULT false NOT NULL,
	"meter_type" text NOT NULL,
	"meter_reading" numeric(14, 2),
	"meter_unavailable_reason" text,
	"liters" numeric(12, 4) NOT NULL,
	"removed_seal_number" text,
	"installed_seal_number" text,
	"no_seal_reason" text,
	"notes" text,
	"status" text DEFAULT 'submitted' NOT NULL,
	"review_note" text,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"raw_row" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fuel_tae_submissions_client_submission_id_unique" UNIQUE("client_submission_id"),
	CONSTRAINT "fuel_tae_submissions_public_result_token_unique" UNIQUE("public_result_token"),
	CONSTRAINT "fuel_tae_submissions_source_valid" CHECK ("fuel_tae_submissions"."source" IN ('public_pwa', 'legacy_xlsx')),
	CONSTRAINT "fuel_tae_submissions_meter_type_valid" CHECK ("fuel_tae_submissions"."meter_type" IN ('odometer', 'hour_meter')),
	CONSTRAINT "fuel_tae_submissions_liters_positive" CHECK ("fuel_tae_submissions"."liters" > 0),
	CONSTRAINT "fuel_tae_submissions_status_valid" CHECK ("fuel_tae_submissions"."status" IN ('submitted', 'observed', 'validated', 'voided'))
);
--> statement-breakpoint
ALTER TABLE "fuel_tae_evidence" ADD CONSTRAINT "fuel_tae_evidence_submission_id_fuel_tae_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."fuel_tae_submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_tae_import_batches" ADD CONSTRAINT "fuel_tae_import_batches_imported_by_users_id_fk" FOREIGN KEY ("imported_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_tae_loading_points" ADD CONSTRAINT "fuel_tae_loading_points_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_tae_public_links" ADD CONSTRAINT "fuel_tae_public_links_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_tae_public_links" ADD CONSTRAINT "fuel_tae_public_links_loading_point_id_fuel_tae_loading_points_id_fk" FOREIGN KEY ("loading_point_id") REFERENCES "public"."fuel_tae_loading_points"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_tae_public_links" ADD CONSTRAINT "fuel_tae_public_links_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_tae_submissions" ADD CONSTRAINT "fuel_tae_submissions_import_batch_id_fuel_tae_import_batches_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."fuel_tae_import_batches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_tae_submissions" ADD CONSTRAINT "fuel_tae_submissions_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_tae_submissions" ADD CONSTRAINT "fuel_tae_submissions_loading_point_id_fuel_tae_loading_points_id_fk" FOREIGN KEY ("loading_point_id") REFERENCES "public"."fuel_tae_loading_points"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_tae_submissions" ADD CONSTRAINT "fuel_tae_submissions_vehicle_id_fuel_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."fuel_vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_tae_submissions" ADD CONSTRAINT "fuel_tae_submissions_driver_worker_id_workers_id_fk" FOREIGN KEY ("driver_worker_id") REFERENCES "public"."workers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_tae_submissions" ADD CONSTRAINT "fuel_tae_submissions_supervisor_worker_id_workers_id_fk" FOREIGN KEY ("supervisor_worker_id") REFERENCES "public"."workers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_tae_submissions" ADD CONSTRAINT "fuel_tae_submissions_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "fuel_tae_evidence_submission_kind_unique" ON "fuel_tae_evidence" USING btree ("submission_id","kind");--> statement-breakpoint
CREATE INDEX "fuel_tae_evidence_submission_idx" ON "fuel_tae_evidence" USING btree ("submission_id");--> statement-breakpoint
CREATE INDEX "fuel_tae_import_batches_hash_idx" ON "fuel_tae_import_batches" USING btree ("file_hash");--> statement-breakpoint
CREATE INDEX "fuel_tae_import_batches_status_idx" ON "fuel_tae_import_batches" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "fuel_tae_loading_points_worksite_name_unique" ON "fuel_tae_loading_points" USING btree ("worksite_id","name");--> statement-breakpoint
CREATE INDEX "fuel_tae_loading_points_worksite_idx" ON "fuel_tae_loading_points" USING btree ("worksite_id");--> statement-breakpoint
CREATE INDEX "fuel_tae_public_links_worksite_idx" ON "fuel_tae_public_links" USING btree ("worksite_id");--> statement-breakpoint
CREATE INDEX "fuel_tae_public_links_loading_point_idx" ON "fuel_tae_public_links" USING btree ("loading_point_id");--> statement-breakpoint
CREATE INDEX "fuel_tae_submissions_worksite_loaded_idx" ON "fuel_tae_submissions" USING btree ("worksite_id","loaded_at");--> statement-breakpoint
CREATE INDEX "fuel_tae_submissions_vehicle_loaded_idx" ON "fuel_tae_submissions" USING btree ("vehicle_id","loaded_at");--> statement-breakpoint
CREATE INDEX "fuel_tae_submissions_loading_point_idx" ON "fuel_tae_submissions" USING btree ("loading_point_id");--> statement-breakpoint
CREATE INDEX "fuel_tae_submissions_status_idx" ON "fuel_tae_submissions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "fuel_tae_submissions_import_batch_idx" ON "fuel_tae_submissions" USING btree ("import_batch_id");--> statement-breakpoint
CREATE INDEX "fuel_tae_submissions_installed_seal_idx" ON "fuel_tae_submissions" USING btree ("installed_seal_number");--> statement-breakpoint
CREATE UNIQUE INDEX "fuel_tae_submissions_legacy_source_unique" ON "fuel_tae_submissions" USING btree ("import_batch_id","legacy_source_id") WHERE "fuel_tae_submissions"."legacy_source_id" IS NOT NULL;