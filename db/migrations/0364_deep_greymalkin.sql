ALTER TABLE "fuel_vehicles" ADD COLUMN "serial_number" text;--> statement-breakpoint
CREATE UNIQUE INDEX "fuel_vehicles_serial_number_key" ON "fuel_vehicles" USING btree ("serial_number");