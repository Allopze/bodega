CREATE TABLE "mant_brands" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"name_key" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE "mant_drivers" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"name_key" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	"worker_id" text
);
--> statement-breakpoint
CREATE TABLE "mant_equipment_history" (
	"id" text PRIMARY KEY NOT NULL,
	"vehicle_id" text NOT NULL,
	"action" text NOT NULL,
	"summary" text NOT NULL,
	"changes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mant_equipment_history_action_valid" CHECK ("mant_equipment_history"."action" IN ('create', 'update', 'schedule_change', 'retire', 'reactivate', 'import', 'initial_reading'))
);
--> statement-breakpoint
CREATE TABLE "mant_equipment_profiles" (
	"vehicle_id" text PRIMARY KEY NOT NULL,
	"brand_id" text NOT NULL,
	"schedule_id" text,
	"initial_reading" numeric(14, 1),
	"initial_reading_date" text,
	"no_plate" boolean DEFAULT false NOT NULL,
	"retired_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	CONSTRAINT "mant_equipment_profiles_initial_reading_valid" CHECK ("mant_equipment_profiles"."initial_reading" IS NULL OR "mant_equipment_profiles"."initial_reading" >= 0),
	CONSTRAINT "mant_equipment_profiles_initial_reading_date" CHECK (("mant_equipment_profiles"."initial_reading" IS NULL) = ("mant_equipment_profiles"."initial_reading_date" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "mant_oils" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"name_key" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE "mant_work_types" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"name_key" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE "mant_workshops" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"name_key" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE "mant_worksite_settings" (
	"worksite_id" text PRIMARY KEY NOT NULL,
	"folio_code" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	CONSTRAINT "mant_worksite_settings_folio_code_valid" CHECK ("mant_worksite_settings"."folio_code" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
CREATE TABLE "mant_schedule_brand_rules" (
	"id" text PRIMARY KEY NOT NULL,
	"schedule_id" text NOT NULL,
	"item_id" text,
	"sheet_activity" text NOT NULL,
	"brand_id" text NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mant_schedule_brand_rules_value_valid" CHECK ("mant_schedule_brand_rules"."value" IN ('A', 'W', 'X'))
);
--> statement-breakpoint
CREATE TABLE "mant_schedule_groups" (
	"id" text PRIMARY KEY NOT NULL,
	"schedule_id" text NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mant_schedule_intervals" (
	"id" text PRIMARY KEY NOT NULL,
	"schedule_id" text NOT NULL,
	"value" integer NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"needs_review" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mant_schedule_intervals_value_positive" CHECK ("mant_schedule_intervals"."value" > 0)
);
--> statement-breakpoint
CREATE TABLE "mant_schedule_item_intervals" (
	"item_id" text NOT NULL,
	"interval_id" text NOT NULL,
	"applies" boolean DEFAULT true NOT NULL,
	CONSTRAINT "mant_schedule_item_intervals_pk" PRIMARY KEY("item_id","interval_id")
);
--> statement-breakpoint
CREATE TABLE "mant_schedule_items" (
	"id" text PRIMARY KEY NOT NULL,
	"schedule_id" text NOT NULL,
	"group_id" text NOT NULL,
	"item_key" text NOT NULL,
	"name" text NOT NULL,
	"note" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mant_schedule_versions" (
	"schedule_id" text NOT NULL,
	"version" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"summary" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	CONSTRAINT "mant_schedule_versions_pk" PRIMARY KEY("schedule_id","version")
);
--> statement-breakpoint
CREATE TABLE "mant_schedules" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"name_key" text NOT NULL,
	"unit" text NOT NULL,
	"origin" text,
	"version" integer DEFAULT 1 NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	CONSTRAINT "mant_schedules_unit_valid" CHECK ("mant_schedules"."unit" IN ('km', 'h')),
	CONSTRAINT "mant_schedules_version_positive" CHECK ("mant_schedules"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "mant_folio_counters" (
	"worksite_id" text NOT NULL,
	"kind" text NOT NULL,
	"last" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mant_folio_counters_pk" PRIMARY KEY("worksite_id","kind"),
	CONSTRAINT "mant_folio_counters_kind_valid" CHECK ("mant_folio_counters"."kind" IN ('P', 'C'))
);
--> statement-breakpoint
CREATE TABLE "mant_record_correctives" (
	"record_id" text PRIMARY KEY NOT NULL,
	"work_types" jsonb NOT NULL,
	"oils" jsonb NOT NULL,
	"description" text NOT NULL,
	"no_parts" boolean DEFAULT false NOT NULL,
	"hours" numeric(4, 1) NOT NULL,
	"in_workshop" boolean NOT NULL,
	"workshop_entry_date" text,
	"work_order" text,
	CONSTRAINT "mant_record_correctives_description_valid" CHECK (char_length(trim("mant_record_correctives"."description")) >= 5),
	CONSTRAINT "mant_record_correctives_hours_valid" CHECK ("mant_record_correctives"."hours" >= 0.5 AND "mant_record_correctives"."hours" <= 72 AND ("mant_record_correctives"."hours" * 2) = floor("mant_record_correctives"."hours" * 2)),
	CONSTRAINT "mant_record_correctives_workshop_valid" CHECK (NOT "mant_record_correctives"."in_workshop" OR "mant_record_correctives"."workshop_entry_date" IS NOT NULL),
	CONSTRAINT "mant_record_correctives_work_types_valid" CHECK (jsonb_array_length("mant_record_correctives"."work_types") >= 1)
);
--> statement-breakpoint
CREATE TABLE "mant_record_drivers" (
	"record_id" text NOT NULL,
	"driver_id" text NOT NULL,
	"driver_name" text NOT NULL,
	CONSTRAINT "mant_record_drivers_pk" PRIMARY KEY("record_id","driver_id")
);
--> statement-breakpoint
CREATE TABLE "mant_record_items" (
	"id" text PRIMARY KEY NOT NULL,
	"record_id" text NOT NULL,
	"item_key" text NOT NULL,
	"group_name" text NOT NULL,
	"item_name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"value" text NOT NULL,
	"reason" text,
	"manufacturer_warning" boolean DEFAULT false NOT NULL,
	CONSTRAINT "mant_record_items_value_valid" CHECK ("mant_record_items"."value" IN ('R', 'NR', 'NA')),
	CONSTRAINT "mant_record_items_reason_valid" CHECK ("mant_record_items"."value" <> 'NR' OR char_length(trim(coalesce("mant_record_items"."reason", ''))) >= 3)
);
--> statement-breakpoint
CREATE TABLE "mant_record_observations" (
	"id" text PRIMARY KEY NOT NULL,
	"record_id" text NOT NULL,
	"text" text NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"response" text,
	"responded_by" text,
	"responded_at" timestamp with time zone,
	CONSTRAINT "mant_record_observations_text_valid" CHECK (char_length(trim("mant_record_observations"."text")) >= 3),
	CONSTRAINT "mant_record_observations_response_valid" CHECK (
    ("mant_record_observations"."response" IS NULL AND "mant_record_observations"."responded_by" IS NULL AND "mant_record_observations"."responded_at" IS NULL)
    OR (char_length(trim("mant_record_observations"."response")) >= 2 AND "mant_record_observations"."responded_by" IS NOT NULL AND "mant_record_observations"."responded_at" IS NOT NULL)
  )
);
--> statement-breakpoint
CREATE TABLE "mant_record_parts" (
	"id" text PRIMARY KEY NOT NULL,
	"record_id" text NOT NULL,
	"quantity" numeric(10, 2) NOT NULL,
	"description" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "mant_record_parts_quantity_positive" CHECK ("mant_record_parts"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "mant_record_photos" (
	"id" text PRIMARY KEY NOT NULL,
	"record_id" text,
	"kind" text NOT NULL,
	"storage_key" text NOT NULL,
	"mime_type" text NOT NULL,
	"sha256" text NOT NULL,
	"bytes" integer NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"exif" jsonb,
	"taken_at_exif" timestamp with time zone,
	"stamped_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"uploaded_by" text NOT NULL,
	"device_id" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "mant_record_photos_kind_valid" CHECK ("mant_record_photos"."kind" IN ('filtros', 'sticker', 'correctiva')),
	CONSTRAINT "mant_record_photos_bytes_valid" CHECK ("mant_record_photos"."bytes" > 0 AND "mant_record_photos"."bytes" <= 10485760)
);
--> statement-breakpoint
CREATE TABLE "mant_record_voids" (
	"id" text PRIMARY KEY NOT NULL,
	"record_id" text NOT NULL,
	"reason" text NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mant_record_voids_reason_valid" CHECK (char_length(trim("mant_record_voids"."reason")) >= 5)
);
--> statement-breakpoint
CREATE TABLE "mant_records" (
	"id" text PRIMARY KEY NOT NULL,
	"folio" text,
	"kind" text NOT NULL,
	"vehicle_id" text NOT NULL,
	"equipment_snapshot" jsonb NOT NULL,
	"worksite_id" text NOT NULL,
	"out_of_worksite" boolean DEFAULT false NOT NULL,
	"reading" numeric(14, 1) NOT NULL,
	"unit" text NOT NULL,
	"work_date" text NOT NULL,
	"registered_by" text NOT NULL,
	"executor_kind" text NOT NULL,
	"executor_user_id" text,
	"executor_workshop_id" text,
	"executor_name" text NOT NULL,
	"signed_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"offline_since" timestamp with time zone,
	"device_id" text,
	"app_version" text,
	"status" text DEFAULT 'vigente' NOT NULL,
	"review" text DEFAULT 'pendiente' NOT NULL,
	"reading_jump_alert" boolean DEFAULT false NOT NULL,
	"reading_jump_confirmed" boolean DEFAULT false NOT NULL,
	"duplicate_of_record_id" text,
	"duplicate_confirmed" boolean DEFAULT false NOT NULL,
	"corrects_record_id" text,
	"schedule_id" text,
	"schedule_version" integer,
	"schedule_name_snapshot" text,
	"interval_value" integer,
	"suggested_interval_value" integer,
	"manual_schedule_reason" text,
	"notes" text,
	"pdf_storage_key" text,
	"pdf_generated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mant_records_kind_valid" CHECK ("mant_records"."kind" IN ('P', 'C')),
	CONSTRAINT "mant_records_unit_valid" CHECK ("mant_records"."unit" IN ('km', 'h')),
	CONSTRAINT "mant_records_reading_valid" CHECK ("mant_records"."reading" >= 0),
	CONSTRAINT "mant_records_status_valid" CHECK ("mant_records"."status" IN ('vigente', 'anulado')),
	CONSTRAINT "mant_records_review_valid" CHECK ("mant_records"."review" IN ('pendiente', 'observado', 'revisado')),
	CONSTRAINT "mant_records_executor_valid" CHECK (
    ("mant_records"."executor_kind" = 'yo' AND "mant_records"."executor_user_id" = "mant_records"."registered_by" AND "mant_records"."executor_workshop_id" IS NULL)
    OR ("mant_records"."executor_kind" = 'otro_mecanico' AND "mant_records"."executor_user_id" IS NOT NULL AND "mant_records"."executor_workshop_id" IS NULL)
    OR ("mant_records"."executor_kind" = 'externo' AND "mant_records"."executor_workshop_id" IS NOT NULL AND "mant_records"."executor_user_id" IS NULL)
  ),
	CONSTRAINT "mant_records_preventive_complete" CHECK (
    "mant_records"."kind" <> 'P' OR (
      "mant_records"."schedule_version" IS NOT NULL AND "mant_records"."schedule_name_snapshot" IS NOT NULL
      AND "mant_records"."interval_value" IS NOT NULL AND "mant_records"."suggested_interval_value" IS NOT NULL
      AND char_length(trim(coalesce("mant_records"."notes", ''))) >= 3
      AND ("mant_records"."interval_value" = "mant_records"."suggested_interval_value"
           OR char_length(trim(coalesce("mant_records"."manual_schedule_reason", ''))) >= 3)
    )
  )
);
--> statement-breakpoint
CREATE TABLE "mant_workshop_updates" (
	"id" text PRIMARY KEY NOT NULL,
	"record_id" text NOT NULL,
	"kind" text NOT NULL,
	"note" text,
	"exit_date" text,
	"user_id" text NOT NULL,
	"device_id" text,
	"created_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mant_workshop_updates_kind_valid" CHECK ("mant_workshop_updates"."kind" IN ('sigue', 'salio')),
	CONSTRAINT "mant_workshop_updates_payload_valid" CHECK (
    ("mant_workshop_updates"."kind" = 'sigue' AND char_length(trim(coalesce("mant_workshop_updates"."note", ''))) >= 3 AND "mant_workshop_updates"."exit_date" IS NULL)
    OR ("mant_workshop_updates"."kind" = 'salio' AND "mant_workshop_updates"."exit_date" IS NOT NULL)
  )
);
--> statement-breakpoint
CREATE TABLE "mant_device_credentials" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"device_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"label" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoked_by" text
);
--> statement-breakpoint
ALTER TABLE "mant_brands" ADD CONSTRAINT "mant_brands_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mant_drivers" ADD CONSTRAINT "mant_drivers_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mant_drivers" ADD CONSTRAINT "mant_drivers_worker_id_workers_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mant_equipment_history" ADD CONSTRAINT "mant_equipment_history_vehicle_id_fuel_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."fuel_vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mant_equipment_history" ADD CONSTRAINT "mant_equipment_history_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mant_equipment_profiles" ADD CONSTRAINT "mant_equipment_profiles_vehicle_id_fuel_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."fuel_vehicles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mant_equipment_profiles" ADD CONSTRAINT "mant_equipment_profiles_brand_id_mant_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."mant_brands"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mant_equipment_profiles" ADD CONSTRAINT "mant_equipment_profiles_schedule_id_mant_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."mant_schedules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mant_equipment_profiles" ADD CONSTRAINT "mant_equipment_profiles_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mant_oils" ADD CONSTRAINT "mant_oils_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mant_work_types" ADD CONSTRAINT "mant_work_types_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mant_workshops" ADD CONSTRAINT "mant_workshops_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mant_worksite_settings" ADD CONSTRAINT "mant_worksite_settings_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mant_worksite_settings" ADD CONSTRAINT "mant_worksite_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mant_schedule_brand_rules" ADD CONSTRAINT "mant_schedule_brand_rules_schedule_id_mant_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."mant_schedules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mant_schedule_brand_rules" ADD CONSTRAINT "mant_schedule_brand_rules_item_id_mant_schedule_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."mant_schedule_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mant_schedule_brand_rules" ADD CONSTRAINT "mant_schedule_brand_rules_brand_id_mant_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."mant_brands"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mant_schedule_groups" ADD CONSTRAINT "mant_schedule_groups_schedule_id_mant_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."mant_schedules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mant_schedule_intervals" ADD CONSTRAINT "mant_schedule_intervals_schedule_id_mant_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."mant_schedules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mant_schedule_item_intervals" ADD CONSTRAINT "mant_schedule_item_intervals_item_id_mant_schedule_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."mant_schedule_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mant_schedule_item_intervals" ADD CONSTRAINT "mant_schedule_item_intervals_interval_id_mant_schedule_intervals_id_fk" FOREIGN KEY ("interval_id") REFERENCES "public"."mant_schedule_intervals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mant_schedule_items" ADD CONSTRAINT "mant_schedule_items_schedule_id_mant_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."mant_schedules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mant_schedule_items" ADD CONSTRAINT "mant_schedule_items_group_id_mant_schedule_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."mant_schedule_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mant_schedule_versions" ADD CONSTRAINT "mant_schedule_versions_schedule_id_mant_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."mant_schedules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mant_schedule_versions" ADD CONSTRAINT "mant_schedule_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mant_schedules" ADD CONSTRAINT "mant_schedules_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mant_schedules" ADD CONSTRAINT "mant_schedules_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mant_folio_counters" ADD CONSTRAINT "mant_folio_counters_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mant_record_correctives" ADD CONSTRAINT "mant_record_correctives_record_id_mant_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."mant_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mant_record_drivers" ADD CONSTRAINT "mant_record_drivers_record_id_mant_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."mant_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mant_record_drivers" ADD CONSTRAINT "mant_record_drivers_driver_id_mant_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."mant_drivers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mant_record_items" ADD CONSTRAINT "mant_record_items_record_id_mant_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."mant_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mant_record_observations" ADD CONSTRAINT "mant_record_observations_record_id_mant_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."mant_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mant_record_observations" ADD CONSTRAINT "mant_record_observations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mant_record_observations" ADD CONSTRAINT "mant_record_observations_responded_by_users_id_fk" FOREIGN KEY ("responded_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mant_record_parts" ADD CONSTRAINT "mant_record_parts_record_id_mant_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."mant_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mant_record_photos" ADD CONSTRAINT "mant_record_photos_record_id_mant_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."mant_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mant_record_photos" ADD CONSTRAINT "mant_record_photos_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mant_record_voids" ADD CONSTRAINT "mant_record_voids_record_id_mant_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."mant_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mant_record_voids" ADD CONSTRAINT "mant_record_voids_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mant_records" ADD CONSTRAINT "mant_records_vehicle_id_fuel_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."fuel_vehicles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mant_records" ADD CONSTRAINT "mant_records_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mant_records" ADD CONSTRAINT "mant_records_registered_by_users_id_fk" FOREIGN KEY ("registered_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mant_records" ADD CONSTRAINT "mant_records_executor_user_id_users_id_fk" FOREIGN KEY ("executor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mant_records" ADD CONSTRAINT "mant_records_executor_workshop_id_mant_workshops_id_fk" FOREIGN KEY ("executor_workshop_id") REFERENCES "public"."mant_workshops"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mant_records" ADD CONSTRAINT "mant_records_duplicate_of_record_id_mant_records_id_fk" FOREIGN KEY ("duplicate_of_record_id") REFERENCES "public"."mant_records"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mant_records" ADD CONSTRAINT "mant_records_corrects_record_id_mant_records_id_fk" FOREIGN KEY ("corrects_record_id") REFERENCES "public"."mant_records"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mant_records" ADD CONSTRAINT "mant_records_schedule_id_mant_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."mant_schedules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mant_workshop_updates" ADD CONSTRAINT "mant_workshop_updates_record_id_mant_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."mant_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mant_workshop_updates" ADD CONSTRAINT "mant_workshop_updates_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mant_device_credentials" ADD CONSTRAINT "mant_device_credentials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mant_device_credentials" ADD CONSTRAINT "mant_device_credentials_revoked_by_users_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mant_brands_name_key_unique" ON "mant_brands" USING btree ("name_key");--> statement-breakpoint
CREATE UNIQUE INDEX "mant_drivers_name_key_unique" ON "mant_drivers" USING btree ("name_key");--> statement-breakpoint
CREATE INDEX "mant_drivers_worker_idx" ON "mant_drivers" USING btree ("worker_id");--> statement-breakpoint
CREATE INDEX "mant_equipment_history_vehicle_idx" ON "mant_equipment_history" USING btree ("vehicle_id","created_at");--> statement-breakpoint
CREATE INDEX "mant_equipment_profiles_schedule_idx" ON "mant_equipment_profiles" USING btree ("schedule_id");--> statement-breakpoint
CREATE INDEX "mant_equipment_profiles_brand_idx" ON "mant_equipment_profiles" USING btree ("brand_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mant_oils_name_key_unique" ON "mant_oils" USING btree ("name_key");--> statement-breakpoint
CREATE UNIQUE INDEX "mant_work_types_name_key_unique" ON "mant_work_types" USING btree ("name_key");--> statement-breakpoint
CREATE UNIQUE INDEX "mant_workshops_name_key_unique" ON "mant_workshops" USING btree ("name_key");--> statement-breakpoint
CREATE UNIQUE INDEX "mant_worksite_settings_folio_code_unique" ON "mant_worksite_settings" USING btree ("folio_code");--> statement-breakpoint
CREATE UNIQUE INDEX "mant_schedule_brand_rules_unique" ON "mant_schedule_brand_rules" USING btree ("schedule_id","sheet_activity","brand_id");--> statement-breakpoint
CREATE INDEX "mant_schedule_brand_rules_item_idx" ON "mant_schedule_brand_rules" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "mant_schedule_groups_schedule_idx" ON "mant_schedule_groups" USING btree ("schedule_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "mant_schedule_intervals_value_unique" ON "mant_schedule_intervals" USING btree ("schedule_id","value");--> statement-breakpoint
CREATE INDEX "mant_schedule_item_intervals_interval_idx" ON "mant_schedule_item_intervals" USING btree ("interval_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mant_schedule_items_key_unique" ON "mant_schedule_items" USING btree ("schedule_id","item_key");--> statement-breakpoint
CREATE INDEX "mant_schedule_items_group_idx" ON "mant_schedule_items" USING btree ("group_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "mant_schedules_name_key_live_unique" ON "mant_schedules" USING btree ("name_key") WHERE "mant_schedules"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "mant_record_items_record_idx" ON "mant_record_items" USING btree ("record_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mant_record_items_key_unique" ON "mant_record_items" USING btree ("record_id","item_key");--> statement-breakpoint
CREATE INDEX "mant_record_observations_record_idx" ON "mant_record_observations" USING btree ("record_id","created_at");--> statement-breakpoint
CREATE INDEX "mant_record_parts_record_idx" ON "mant_record_parts" USING btree ("record_id");--> statement-breakpoint
CREATE INDEX "mant_record_photos_record_idx" ON "mant_record_photos" USING btree ("record_id");--> statement-breakpoint
CREATE INDEX "mant_record_photos_orphan_idx" ON "mant_record_photos" USING btree ("uploaded_by","received_at") WHERE "mant_record_photos"."record_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "mant_record_voids_record_unique" ON "mant_record_voids" USING btree ("record_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mant_records_folio_unique" ON "mant_records" USING btree ("folio");--> statement-breakpoint
CREATE INDEX "mant_records_vehicle_date_idx" ON "mant_records" USING btree ("vehicle_id","work_date" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "mant_records_worksite_date_idx" ON "mant_records" USING btree ("worksite_id","work_date");--> statement-breakpoint
CREATE INDEX "mant_records_registered_by_idx" ON "mant_records" USING btree ("registered_by");--> statement-breakpoint
CREATE INDEX "mant_records_executor_idx" ON "mant_records" USING btree ("executor_user_id");--> statement-breakpoint
CREATE INDEX "mant_records_status_idx" ON "mant_records" USING btree ("status");--> statement-breakpoint
CREATE INDEX "mant_records_review_idx" ON "mant_records" USING btree ("review");--> statement-breakpoint
CREATE INDEX "mant_workshop_updates_record_idx" ON "mant_workshop_updates" USING btree ("record_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "mant_device_credentials_token_hash_unique" ON "mant_device_credentials" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "mant_device_credentials_live_unique" ON "mant_device_credentials" USING btree ("user_id","device_id") WHERE "mant_device_credentials"."revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX "mant_device_credentials_user_idx" ON "mant_device_credentials" USING btree ("user_id","created_at");