ALTER TABLE "products" ADD COLUMN "is_spare_part" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "part_number" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "part_brand" text;--> statement-breakpoint
CREATE UNIQUE INDEX "products_spare_part_number_brand_unique" ON "products" USING btree (lower("part_number"),lower(coalesce("part_brand", ''))) WHERE "products"."is_spare_part" AND "products"."part_number" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_spare_part_exclusive" CHECK (NOT ("products"."is_spare_part" AND ("products"."is_epp" OR "products"."is_service")));--> statement-breakpoint
-- Categoría sembrada del catálogo de repuestos (regla 5 del README: datos semilla
-- que el esquema TS no captura, idempotentes). `createSparePartTx` la busca por
-- slug; si un administrador ya creó una categoría con ese slug se respeta.
INSERT INTO "product_categories" ("id", "name", "slug", "is_epp", "requires_prevencion", "sort_order")
VALUES ('cat-repuestos', 'Repuestos', 'repuestos', false, false, 95)
ON CONFLICT ("slug") DO NOTHING;
