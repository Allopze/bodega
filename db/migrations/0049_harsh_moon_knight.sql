CREATE TABLE "fuel_vehicle_operational_intervals" (
	"id" text PRIMARY KEY NOT NULL,
	"vehicle_id" text NOT NULL,
	"status" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"reason" text,
	"changed_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fuel_vehicle_operational_intervals_status_valid" CHECK ("fuel_vehicle_operational_intervals"."status" IN ('operativo', 'mantencion', 'fuera_servicio')),
	CONSTRAINT "fuel_vehicle_operational_intervals_dates_valid" CHECK ("fuel_vehicle_operational_intervals"."ended_at" IS NULL OR "fuel_vehicle_operational_intervals"."ended_at" > "fuel_vehicle_operational_intervals"."started_at")
);
--> statement-breakpoint
ALTER TABLE "fuel_vehicle_operational_intervals" ADD CONSTRAINT "fuel_vehicle_operational_intervals_vehicle_id_fuel_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."fuel_vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_vehicle_operational_intervals" ADD CONSTRAINT "fuel_vehicle_operational_intervals_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "fuel_vehicle_operational_intervals_open_unique" ON "fuel_vehicle_operational_intervals" USING btree ("vehicle_id") WHERE "fuel_vehicle_operational_intervals"."ended_at" IS NULL;--> statement-breakpoint
CREATE INDEX "fuel_vehicle_operational_intervals_vehicle_started_idx" ON "fuel_vehicle_operational_intervals" USING btree ("vehicle_id","started_at");
--> statement-breakpoint
INSERT INTO "fuel_vehicle_operational_intervals" (
	"id",
	"vehicle_id",
	"status",
	"started_at",
	"reason",
	"changed_by"
)
SELECT
	'fvoi-legacy-' || md5("fuel_vehicles"."id"),
	"fuel_vehicles"."id",
	"fuel_vehicles"."operational_status",
	"fuel_vehicles"."created_at",
	'Intervalo inicial migrado desde el estado vigente',
	NULL
FROM "fuel_vehicles"
WHERE NOT EXISTS (
	SELECT 1
	FROM "fuel_vehicle_operational_intervals"
	WHERE "fuel_vehicle_operational_intervals"."vehicle_id" = "fuel_vehicles"."id"
		AND "fuel_vehicle_operational_intervals"."ended_at" IS NULL
)
ON CONFLICT DO NOTHING;
