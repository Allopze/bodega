-- El índice único va PRIMERO: Postgres exige que las columnas referenciadas por
-- la FK compuesta ya estén cubiertas por un índice único al crearla.
CREATE UNIQUE INDEX "fuel_vehicles_id_worksite_key" ON "fuel_vehicles" USING btree ("id","worksite_id");--> statement-breakpoint
ALTER TABLE "maintenance_records" ADD CONSTRAINT "maintenance_records_vehicle_worksite_fk" FOREIGN KEY ("vehicle_id","worksite_id") REFERENCES "public"."fuel_vehicles"("id","worksite_id") ON DELETE no action ON UPDATE cascade;
