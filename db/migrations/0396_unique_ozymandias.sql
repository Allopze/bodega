CREATE TABLE "fleet_operation_day_marks" (
	"id" text PRIMARY KEY NOT NULL,
	"vehicle_id" text NOT NULL,
	"day" text NOT NULL,
	"reason" text NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fleet_operation_day_marks_day_format" CHECK ("fleet_operation_day_marks"."day" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
	CONSTRAINT "fleet_operation_day_marks_reason_valid" CHECK ("fleet_operation_day_marks"."reason" IN ('sin_operacion_programada', 'otro'))
);
--> statement-breakpoint
CREATE TABLE "fleet_operation_shifts" (
	"id" text PRIMARY KEY NOT NULL,
	"vehicle_id" text NOT NULL,
	"shift_date" text NOT NULL,
	"start_hour" integer NOT NULL,
	"end_hour" integer NOT NULL,
	"operator_worker_id" text NOT NULL,
	"operator_name_snapshot" text NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"import_ref" text,
	"created_by" text NOT NULL,
	"updated_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"voided_at" timestamp with time zone,
	"voided_by" text,
	"void_reason" text,
	CONSTRAINT "fleet_operation_shifts_date_format" CHECK ("fleet_operation_shifts"."shift_date" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
	CONSTRAINT "fleet_operation_shifts_hours_valid" CHECK ("fleet_operation_shifts"."start_hour" BETWEEN 0 AND 23 AND "fleet_operation_shifts"."end_hour" BETWEEN 0 AND 23),
	CONSTRAINT "fleet_operation_shifts_not_empty" CHECK ("fleet_operation_shifts"."start_hour" <> "fleet_operation_shifts"."end_hour"),
	CONSTRAINT "fleet_operation_shifts_void_complete" CHECK (
    ("fleet_operation_shifts"."voided_at" IS NULL AND "fleet_operation_shifts"."voided_by" IS NULL AND "fleet_operation_shifts"."void_reason" IS NULL)
    OR ("fleet_operation_shifts"."voided_at" IS NOT NULL AND "fleet_operation_shifts"."voided_by" IS NOT NULL AND "fleet_operation_shifts"."void_reason" IS NOT NULL)
  )
);
--> statement-breakpoint
CREATE TABLE "fuel_telemetry_fetches" (
	"vehicle_id" text NOT NULL,
	"day" text NOT NULL,
	"segments_fetched_at" timestamp with time zone,
	"daily_fetched_at" timestamp with time zone,
	CONSTRAINT "fuel_telemetry_fetches_vehicle_id_day_pk" PRIMARY KEY("vehicle_id","day"),
	CONSTRAINT "fuel_telemetry_fetches_day_format" CHECK ("fuel_telemetry_fetches"."day" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')
);
--> statement-breakpoint
CREATE TABLE "fuel_telemetry_hourly" (
	"vehicle_id" text NOT NULL,
	"day" text NOT NULL,
	"hour" integer NOT NULL,
	"source" text NOT NULL,
	"idle_seconds" integer DEFAULT 0 NOT NULL,
	"working_seconds" integer DEFAULT 0 NOT NULL,
	"running_seconds" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fuel_telemetry_hourly_vehicle_id_day_hour_source_pk" PRIMARY KEY("vehicle_id","day","hour","source"),
	CONSTRAINT "fuel_telemetry_hourly_day_format" CHECK ("fuel_telemetry_hourly"."day" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
	CONSTRAINT "fuel_telemetry_hourly_hour_valid" CHECK ("fuel_telemetry_hourly"."hour" BETWEEN 0 AND 23),
	CONSTRAINT "fuel_telemetry_hourly_seconds_valid" CHECK ("fuel_telemetry_hourly"."idle_seconds" >= 0 AND "fuel_telemetry_hourly"."working_seconds" >= 0 AND "fuel_telemetry_hourly"."running_seconds" >= 0)
);
--> statement-breakpoint
ALTER TABLE "fleet_operation_day_marks" ADD CONSTRAINT "fleet_operation_day_marks_vehicle_id_fuel_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."fuel_vehicles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_operation_day_marks" ADD CONSTRAINT "fleet_operation_day_marks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_operation_shifts" ADD CONSTRAINT "fleet_operation_shifts_vehicle_id_fuel_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."fuel_vehicles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_operation_shifts" ADD CONSTRAINT "fleet_operation_shifts_operator_worker_id_workers_id_fk" FOREIGN KEY ("operator_worker_id") REFERENCES "public"."workers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_operation_shifts" ADD CONSTRAINT "fleet_operation_shifts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_operation_shifts" ADD CONSTRAINT "fleet_operation_shifts_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_operation_shifts" ADD CONSTRAINT "fleet_operation_shifts_voided_by_users_id_fk" FOREIGN KEY ("voided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_telemetry_fetches" ADD CONSTRAINT "fuel_telemetry_fetches_vehicle_id_fuel_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."fuel_vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_telemetry_hourly" ADD CONSTRAINT "fuel_telemetry_hourly_vehicle_id_fuel_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."fuel_vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "fleet_operation_day_marks_vehicle_day_unique" ON "fleet_operation_day_marks" USING btree ("vehicle_id","day");--> statement-breakpoint
CREATE INDEX "fleet_operation_shifts_vehicle_date_idx" ON "fleet_operation_shifts" USING btree ("vehicle_id","shift_date");--> statement-breakpoint
CREATE INDEX "fleet_operation_shifts_operator_date_idx" ON "fleet_operation_shifts" USING btree ("operator_worker_id","shift_date");--> statement-breakpoint
CREATE UNIQUE INDEX "fleet_operation_shifts_import_ref_unique" ON "fleet_operation_shifts" USING btree ("import_ref") WHERE "fleet_operation_shifts"."import_ref" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "fuel_telemetry_hourly_day_idx" ON "fuel_telemetry_hourly" USING btree ("day");--> statement-breakpoint
-- «Turnos y ralentí» (/flota/turnos) arranca apagado: se enciende cuando corrió el backfill de tramos
-- y la importación de los turnos de «Ralentí Cholguán».
INSERT INTO "system_settings" ("key", "value")
VALUES ('submodule.enabled:flota:/flota/turnos', 'false')
ON CONFLICT ("key") DO NOTHING;
