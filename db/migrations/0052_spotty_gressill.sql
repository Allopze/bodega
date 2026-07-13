CREATE TABLE "fuel_tae_import_rejections" (
	"id" text PRIMARY KEY NOT NULL,
	"batch_id" text NOT NULL,
	"row_index" integer NOT NULL,
	"stage" text NOT NULL,
	"field" text,
	"message" text NOT NULL,
	"legacy_source_id" text,
	"raw_row" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fuel_tae_import_rejections_stage_valid" CHECK ("fuel_tae_import_rejections"."stage" IN ('parse', 'worksite'))
);
--> statement-breakpoint
CREATE TABLE "fuel_tae_vehicle_mappings" (
	"id" text PRIMARY KEY NOT NULL,
	"worksite_id" text NOT NULL,
	"legacy_code" text NOT NULL,
	"vehicle_id" text,
	"decided_by" text NOT NULL,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "fuel_tae_worker_mappings" (
	"id" text PRIMARY KEY NOT NULL,
	"worksite_id" text NOT NULL,
	"role" text NOT NULL,
	"legacy_name" text NOT NULL,
	"worker_id" text,
	"decided_by" text NOT NULL,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notes" text,
	CONSTRAINT "fuel_tae_worker_mappings_role_valid" CHECK ("fuel_tae_worker_mappings"."role" IN ('driver', 'supervisor'))
);
--> statement-breakpoint
ALTER TABLE "fuel_tae_import_rejections" ADD CONSTRAINT "fuel_tae_import_rejections_batch_id_fuel_tae_import_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."fuel_tae_import_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_tae_vehicle_mappings" ADD CONSTRAINT "fuel_tae_vehicle_mappings_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_tae_vehicle_mappings" ADD CONSTRAINT "fuel_tae_vehicle_mappings_vehicle_id_fuel_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."fuel_vehicles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_tae_vehicle_mappings" ADD CONSTRAINT "fuel_tae_vehicle_mappings_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_tae_worker_mappings" ADD CONSTRAINT "fuel_tae_worker_mappings_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_tae_worker_mappings" ADD CONSTRAINT "fuel_tae_worker_mappings_worker_id_workers_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_tae_worker_mappings" ADD CONSTRAINT "fuel_tae_worker_mappings_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fuel_tae_import_rejections_batch_idx" ON "fuel_tae_import_rejections" USING btree ("batch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fuel_tae_vehicle_mappings_worksite_code_unique" ON "fuel_tae_vehicle_mappings" USING btree ("worksite_id","legacy_code");--> statement-breakpoint
CREATE UNIQUE INDEX "fuel_tae_worker_mappings_worksite_role_name_unique" ON "fuel_tae_worker_mappings" USING btree ("worksite_id","role","legacy_name");