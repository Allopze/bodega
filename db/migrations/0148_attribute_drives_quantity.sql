ALTER TABLE "product_attributes" ADD COLUMN "drives_quantity" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "product_attributes_one_quantity_driver" ON "product_attributes" USING btree ("product_id") WHERE "product_attributes"."drives_quantity" = true;--> statement-breakpoint
-- El "Número de dosis" de una vacuna ES la cantidad a comprar: se declara así
-- para que el formulario y el servidor mantengan un solo número, y la unidad
-- del producto pasa a "dosis" para que la OC diga "2 dosis" y no "1 servicio".
UPDATE "product_attributes" SET "drives_quantity" = true
WHERE "id" = 'pa-srv-vacuna-dosis';--> statement-breakpoint

UPDATE "products" SET "unit_of_measure" = 'dosis'
WHERE "id" = 'prod-srv-vacuna' AND "unit_of_measure" = 'servicio';
