CREATE TABLE "fuel_vehicle_personal_use_periods" (
	"id" text PRIMARY KEY NOT NULL,
	"vehicle_id" text NOT NULL,
	"started_on" text NOT NULL,
	"ended_on" text,
	"note" text,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fuel_vehicle_personal_use_periods_dates_valid" CHECK ("fuel_vehicle_personal_use_periods"."ended_on" IS NULL OR "fuel_vehicle_personal_use_periods"."ended_on" >= "fuel_vehicle_personal_use_periods"."started_on"),
	CONSTRAINT "fuel_vehicle_personal_use_periods_started_format" CHECK ("fuel_vehicle_personal_use_periods"."started_on" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
	CONSTRAINT "fuel_vehicle_personal_use_periods_ended_format" CHECK ("fuel_vehicle_personal_use_periods"."ended_on" IS NULL OR "fuel_vehicle_personal_use_periods"."ended_on" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')
);
--> statement-breakpoint
ALTER TABLE "fuel_vehicle_personal_use_periods" ADD CONSTRAINT "fuel_vehicle_personal_use_periods_vehicle_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."fuel_vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_vehicle_personal_use_periods" ADD CONSTRAINT "fuel_vehicle_personal_use_periods_created_by_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "fuel_vehicle_personal_use_periods_open_unique" ON "fuel_vehicle_personal_use_periods" USING btree ("vehicle_id") WHERE "fuel_vehicle_personal_use_periods"."ended_on" IS NULL;--> statement-breakpoint
CREATE INDEX "fuel_vehicle_personal_use_periods_vehicle_started_idx" ON "fuel_vehicle_personal_use_periods" USING btree ("vehicle_id","started_on");
--> statement-breakpoint
-- Uso personal: sin solapes entre períodos del mismo equipo (inclusivos; término nulo = abierto).
-- Bloquea la fila del equipo para que dos altas simultáneas no pasen las dos el chequeo.
CREATE OR REPLACE FUNCTION "fuel_vehicle_personal_use_no_overlap"() RETURNS trigger AS $$
DECLARE
  v_other record;
BEGIN
  PERFORM 1 FROM "fuel_vehicles" WHERE "id" = NEW."vehicle_id" FOR UPDATE;
  SELECT "started_on", "ended_on" INTO v_other FROM "fuel_vehicle_personal_use_periods"
  WHERE "vehicle_id" = NEW."vehicle_id"
    AND "id" <> NEW."id"
    AND "started_on" <= coalesce(NEW."ended_on", '9999-12-31')
    AND coalesce("ended_on", '9999-12-31') >= NEW."started_on"
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'PERSONAL_USE_OVERLAP: el equipo % ya tiene un uso personal desde % hasta %', NEW."vehicle_id", v_other."started_on", coalesce(v_other."ended_on", '(en curso)');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "fuel_vehicle_personal_use_no_overlap" ON "fuel_vehicle_personal_use_periods";
--> statement-breakpoint
CREATE TRIGGER "fuel_vehicle_personal_use_no_overlap" BEFORE INSERT OR UPDATE ON "fuel_vehicle_personal_use_periods"
FOR EACH ROW EXECUTE FUNCTION "fuel_vehicle_personal_use_no_overlap"();
