CREATE TABLE "fleet_transfer_items" (
	"id" text PRIMARY KEY NOT NULL,
	"transfer_id" text NOT NULL,
	"vehicle_id" text NOT NULL,
	"from_worksite_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fleet_transfers" (
	"id" text PRIMARY KEY NOT NULL,
	"folio" text NOT NULL,
	"effective_date" text NOT NULL,
	"to_worksite_id" text NOT NULL,
	"reason" text NOT NULL,
	"authorized_by" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"voided_at" timestamp with time zone,
	"voided_by" text,
	"void_reason" text,
	CONSTRAINT "fleet_transfers_folio_unique" UNIQUE("folio"),
	CONSTRAINT "fleet_transfers_reason_valid" CHECK (char_length(trim("fleet_transfers"."reason")) >= 10),
	CONSTRAINT "fleet_transfers_authorized_by_valid" CHECK (char_length(trim("fleet_transfers"."authorized_by")) >= 3),
	CONSTRAINT "fleet_transfers_void_complete" CHECK (
    ("fleet_transfers"."voided_at" IS NULL AND "fleet_transfers"."voided_by" IS NULL AND "fleet_transfers"."void_reason" IS NULL)
    OR ("fleet_transfers"."voided_at" IS NOT NULL AND "fleet_transfers"."voided_by" IS NOT NULL
      AND char_length(trim("fleet_transfers"."void_reason")) >= 10)
  )
);
--> statement-breakpoint
CREATE TABLE "fuel_vehicle_worksite_intervals" (
	"id" text PRIMARY KEY NOT NULL,
	"vehicle_id" text NOT NULL,
	"worksite_id" text NOT NULL,
	"started_on" text,
	"ended_on" text,
	"source" text NOT NULL,
	"transfer_id" text,
	"evidence" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fuel_vehicle_worksite_intervals_source_valid" CHECK ("fuel_vehicle_worksite_intervals"."source" IN ('alta', 'traslado', 'reconstruccion')),
	CONSTRAINT "fuel_vehicle_worksite_intervals_transfer_consistent" CHECK (("fuel_vehicle_worksite_intervals"."source" = 'traslado') = ("fuel_vehicle_worksite_intervals"."transfer_id" IS NOT NULL)),
	CONSTRAINT "fuel_vehicle_worksite_intervals_dates_valid" CHECK ("fuel_vehicle_worksite_intervals"."started_on" IS NULL OR "fuel_vehicle_worksite_intervals"."ended_on" IS NULL OR "fuel_vehicle_worksite_intervals"."ended_on" >= "fuel_vehicle_worksite_intervals"."started_on")
);
--> statement-breakpoint
ALTER TABLE "fleet_gps_alerts" DROP CONSTRAINT IF EXISTS "fleet_gps_alerts_vehicle_worksite_fk";
--> statement-breakpoint
ALTER TABLE "fleet_gps_latest_positions" DROP CONSTRAINT IF EXISTS "fleet_gps_latest_positions_vehicle_worksite_fk";
--> statement-breakpoint
ALTER TABLE "fleet_gps_position_history" DROP CONSTRAINT IF EXISTS "fleet_gps_position_history_vehicle_worksite_fk";
--> statement-breakpoint
ALTER TABLE "fleet_gps_trips" DROP CONSTRAINT IF EXISTS "fleet_gps_trips_vehicle_worksite_fk";
--> statement-breakpoint
ALTER TABLE "fleet_transfer_items" ADD CONSTRAINT "fleet_transfer_items_transfer_id_fleet_transfers_id_fk" FOREIGN KEY ("transfer_id") REFERENCES "public"."fleet_transfers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_transfer_items" ADD CONSTRAINT "fleet_transfer_items_vehicle_id_fuel_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."fuel_vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_transfer_items" ADD CONSTRAINT "fleet_transfer_items_from_worksite_id_worksites_id_fk" FOREIGN KEY ("from_worksite_id") REFERENCES "public"."worksites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_transfers" ADD CONSTRAINT "fleet_transfers_to_worksite_id_worksites_id_fk" FOREIGN KEY ("to_worksite_id") REFERENCES "public"."worksites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_transfers" ADD CONSTRAINT "fleet_transfers_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_transfers" ADD CONSTRAINT "fleet_transfers_voided_by_users_id_fk" FOREIGN KEY ("voided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_vehicle_worksite_intervals" ADD CONSTRAINT "fuel_vehicle_worksite_intervals_vehicle_id_fuel_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."fuel_vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_vehicle_worksite_intervals" ADD CONSTRAINT "fuel_vehicle_worksite_intervals_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_vehicle_worksite_intervals" ADD CONSTRAINT "fuel_vehicle_worksite_intervals_transfer_id_fleet_transfers_id_fk" FOREIGN KEY ("transfer_id") REFERENCES "public"."fleet_transfers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "fleet_transfer_items_transfer_vehicle_unique" ON "fleet_transfer_items" USING btree ("transfer_id","vehicle_id");--> statement-breakpoint
CREATE INDEX "fleet_transfer_items_vehicle_idx" ON "fleet_transfer_items" USING btree ("vehicle_id");--> statement-breakpoint
CREATE INDEX "fleet_transfers_effective_date_idx" ON "fleet_transfers" USING btree ("effective_date");--> statement-breakpoint
CREATE INDEX "fleet_transfers_to_worksite_idx" ON "fleet_transfers" USING btree ("to_worksite_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fuel_vehicle_worksite_intervals_open_unique" ON "fuel_vehicle_worksite_intervals" USING btree ("vehicle_id") WHERE "fuel_vehicle_worksite_intervals"."ended_on" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "fuel_vehicle_worksite_intervals_first_unique" ON "fuel_vehicle_worksite_intervals" USING btree ("vehicle_id") WHERE "fuel_vehicle_worksite_intervals"."started_on" IS NULL;--> statement-breakpoint
CREATE INDEX "fuel_vehicle_worksite_intervals_vehicle_started_idx" ON "fuel_vehicle_worksite_intervals" USING btree ("vehicle_id","started_on");--> statement-breakpoint
CREATE INDEX "fuel_vehicle_worksite_intervals_worksite_idx" ON "fuel_vehicle_worksite_intervals" USING btree ("worksite_id");--> statement-breakpoint
ALTER TABLE "fleet_gps_alerts" ADD CONSTRAINT "fleet_gps_alerts_vehicle_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."fuel_vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_gps_latest_positions" ADD CONSTRAINT "fleet_gps_latest_positions_vehicle_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."fuel_vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_gps_position_history" ADD CONSTRAINT "fleet_gps_position_history_vehicle_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."fuel_vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_gps_trips" ADD CONSTRAINT "fleet_gps_trips_vehicle_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."fuel_vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Estadías por faena. Todo lo de abajo es SQL propio (no lo captura el esquema TS) e idempotente.
-- 1) Backfill: una estadía `alta` sin inicio ni fin por cada vehículo, en su faena actual. Al desplegar,
--    todos los reportes dan lo mismo que hoy. Va ANTES de crear los triggers de consistencia.
INSERT INTO "fuel_vehicle_worksite_intervals" ("id", "vehicle_id", "worksite_id", "started_on", "ended_on", "source")
SELECT 'fvwi_' || "id", "id", "worksite_id", NULL, NULL, 'alta' FROM "fuel_vehicles"
ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- 2) Todo vehículo nuevo abre su primera estadía (sin inicio), sin tocar a quien lo crea.
CREATE OR REPLACE FUNCTION "fuel_vehicles_open_first_stay"() RETURNS trigger AS $$
BEGIN
  INSERT INTO "fuel_vehicle_worksite_intervals" ("id", "vehicle_id", "worksite_id", "started_on", "ended_on", "source")
  VALUES (gen_random_uuid()::text, NEW."id", NEW."worksite_id", NULL, NULL, 'alta');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "fuel_vehicles_open_first_stay" ON "fuel_vehicles";
--> statement-breakpoint
CREATE TRIGGER "fuel_vehicles_open_first_stay"
AFTER INSERT ON "fuel_vehicles"
FOR EACH ROW EXECUTE FUNCTION "fuel_vehicles_open_first_stay"();
--> statement-breakpoint
-- 3) Invariante: `fuel_vehicles.worksite_id` es la faena de la estadía abierta. Hay >= 1 estadía; la
--    primera no tiene inicio; cada siguiente empieza el día después del fin de la anterior; sólo la
--    última está abierta.
CREATE OR REPLACE FUNCTION "fuel_vehicle_check_stays"(p_vehicle text) RETURNS void AS $$
DECLARE
  v_current text;
  v_total integer;
  v_idx integer := 0;
  v_prev_ended text;
  v_last_worksite text;
  r record;
BEGIN
  SELECT "worksite_id" INTO v_current FROM "fuel_vehicles" WHERE "id" = p_vehicle;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  SELECT count(*) INTO v_total FROM "fuel_vehicle_worksite_intervals" WHERE "vehicle_id" = p_vehicle;
  IF v_total = 0 THEN
    RAISE EXCEPTION 'FLEET_STAY_INVARIANT: el equipo % no tiene estadías por faena', p_vehicle;
  END IF;
  FOR r IN
    SELECT "worksite_id", "started_on", "ended_on" FROM "fuel_vehicle_worksite_intervals"
    WHERE "vehicle_id" = p_vehicle ORDER BY "started_on" ASC NULLS FIRST
  LOOP
    v_idx := v_idx + 1;
    IF v_idx = 1 THEN
      IF r."started_on" IS NOT NULL THEN
        RAISE EXCEPTION 'FLEET_STAY_INVARIANT: la primera estadía del equipo % debe quedar sin inicio', p_vehicle;
      END IF;
    ELSIF r."started_on" IS DISTINCT FROM to_char(v_prev_ended::date + 1, 'YYYY-MM-DD') THEN
      RAISE EXCEPTION 'FLEET_STAY_INVARIANT: hueco o solape en las estadías del equipo % (la estadía desde % no empalma con la anterior)', p_vehicle, r."started_on";
    END IF;
    IF v_idx < v_total AND r."ended_on" IS NULL THEN
      RAISE EXCEPTION 'FLEET_STAY_INVARIANT: el equipo % tiene una estadía abierta que no es la última', p_vehicle;
    END IF;
    IF v_idx = v_total AND r."ended_on" IS NOT NULL THEN
      RAISE EXCEPTION 'FLEET_STAY_INVARIANT: el equipo % no tiene una estadía abierta', p_vehicle;
    END IF;
    v_prev_ended := r."ended_on";
    v_last_worksite := r."worksite_id";
  END LOOP;
  IF v_last_worksite IS DISTINCT FROM v_current THEN
    RAISE EXCEPTION 'FLEET_STAY_INVARIANT: la faena del equipo % (%) no es la de su estadía abierta (%)', p_vehicle, v_current, v_last_worksite;
  END IF;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
-- 4) Dos triggers de restricción DIFERIDOS: se evalúan al confirmar la transacción, así el servicio de
--    traslado puede mover estadía y faena en pasos y un UPDATE directo de la faena falla.
CREATE OR REPLACE FUNCTION "fuel_vehicles_stays_consistency"() RETURNS trigger AS $$
BEGIN
  PERFORM "fuel_vehicle_check_stays"(NEW."id");
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "fuel_vehicle_worksite_intervals_consistency"() RETURNS trigger AS $$
BEGIN
  PERFORM "fuel_vehicle_check_stays"(COALESCE(NEW."vehicle_id", OLD."vehicle_id"));
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "fuel_vehicles_stays_consistency" ON "fuel_vehicles";
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "fuel_vehicles_stays_consistency"
AFTER INSERT OR UPDATE OF "worksite_id" ON "fuel_vehicles"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "fuel_vehicles_stays_consistency"();
--> statement-breakpoint
DROP TRIGGER IF EXISTS "fuel_vehicle_worksite_intervals_consistency" ON "fuel_vehicle_worksite_intervals";
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "fuel_vehicle_worksite_intervals_consistency"
AFTER INSERT OR UPDATE OR DELETE ON "fuel_vehicle_worksite_intervals"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "fuel_vehicle_worksite_intervals_consistency"();
--> statement-breakpoint
-- 5) El módulo «Traslados» arranca apagado hasta que corra la reconstrucción del pasado.
INSERT INTO "system_settings" ("key", "value")
VALUES ('submodule.enabled:flota:/flota/traslados', 'false')
ON CONFLICT ("key") DO NOTHING;
