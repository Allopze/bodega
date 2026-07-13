CREATE TABLE "fuel_products" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"category" text DEFAULT 'other' NOT NULL,
	"unit" text DEFAULT 'liter' NOT NULL,
	"aliases" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"description" text,
	"is_system" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fuel_products_category_valid" CHECK ("fuel_products"."category" IN ('diesel', 'additive', 'gasoline', 'other')),
	CONSTRAINT "fuel_products_unit_valid" CHECK ("fuel_products"."unit" IN ('liter', 'kilogram', 'unit'))
);
--> statement-breakpoint
CREATE TABLE "fuel_vehicle_products" (
	"vehicle_id" text NOT NULL,
	"product_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fuel_vehicle_products_vehicle_id_product_id_pk" PRIMARY KEY("vehicle_id","product_id")
);
--> statement-breakpoint
ALTER TABLE "fuel_loads" ADD COLUMN "product_id" text;--> statement-breakpoint
ALTER TABLE "fuel_tae_submissions" ADD COLUMN "product_id" text;--> statement-breakpoint
ALTER TABLE "fuel_vehicle_products" ADD CONSTRAINT "fuel_vehicle_products_vehicle_id_fuel_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."fuel_vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_vehicle_products" ADD CONSTRAINT "fuel_vehicle_products_product_id_fuel_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."fuel_products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "fuel_products_code_unique" ON "fuel_products" USING btree ("code");--> statement-breakpoint
CREATE INDEX "fuel_products_active_name_idx" ON "fuel_products" USING btree ("is_active","name");--> statement-breakpoint
CREATE INDEX "fuel_vehicle_products_product_idx" ON "fuel_vehicle_products" USING btree ("product_id");--> statement-breakpoint
ALTER TABLE "fuel_loads" ADD CONSTRAINT "fuel_loads_product_id_fuel_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."fuel_products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_tae_submissions" ADD CONSTRAINT "fuel_tae_submissions_product_id_fuel_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."fuel_products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fuel_loads_product_idx" ON "fuel_loads" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "fuel_tae_submissions_product_loaded_idx" ON "fuel_tae_submissions" USING btree ("product_id","loaded_at");
--> statement-breakpoint
INSERT INTO "fuel_products" ("id", "code", "name", "category", "unit", "aliases", "description", "is_system", "is_active") VALUES
  ('fuel-diesel', 'DIESEL', 'Petróleo Diésel', 'diesel', 'liter', '["DIESEL", "PETROLEO DIESEL", "PETRÓLEO DIÉSEL"]'::jsonb, 'Combustible diésel para vehículos y maquinaria.', true, true),
  ('fuel-bluemax', 'BLUEMAX', 'BlueMax', 'additive', 'liter', '["BLUEMAX", "ADBLUE"]'::jsonb, 'Aditivo de reducción catalítica selectiva.', true, true),
  ('fuel-historical-unspecified', 'HISTORICAL_UNSPECIFIED', 'No especificado (histórico)', 'other', 'liter', '[]'::jsonb, 'Producto reservado para cargas históricas cuya fuente no indicó producto.', true, false)
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint
UPDATE "fuel_loads"
SET "product_id" = CASE
  WHEN upper(trim("product")) LIKE '%BLUE%' OR upper(trim("product")) LIKE '%ADBLUE%' THEN 'fuel-bluemax'
  WHEN upper(trim("product")) LIKE '%DIESEL%' OR upper(trim("product")) LIKE '%DIÉSEL%' THEN 'fuel-diesel'
  ELSE 'fuel-historical-unspecified'
END
WHERE "product_id" IS NULL;
--> statement-breakpoint
UPDATE "fuel_tae_submissions"
SET "product_id" = 'fuel-historical-unspecified'
WHERE "product_id" IS NULL;
--> statement-breakpoint
INSERT INTO "fuel_vehicle_products" ("vehicle_id", "product_id")
SELECT "id", 'fuel-diesel' FROM "fuel_vehicles"
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "fuel_vehicle_products" ("vehicle_id", "product_id")
SELECT DISTINCT "vehicle_id", 'fuel-bluemax'
FROM "fuel_loads"
WHERE "product_id" = 'fuel-bluemax'
ON CONFLICT DO NOTHING;
