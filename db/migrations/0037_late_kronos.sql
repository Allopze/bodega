-- Custom SQL migration: some environments may have more than one preferred
-- supplier per product (never enforced before). Keep the earliest-marked one
-- and unset the rest so the new partial unique index below can be created.
WITH ranked AS (
  SELECT id, row_number() OVER (PARTITION BY product_id ORDER BY last_updated ASC, id ASC) AS rn
  FROM product_suppliers
  WHERE is_preferred = true
)
UPDATE product_suppliers
SET is_preferred = false
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);
--> statement-breakpoint
CREATE UNIQUE INDEX "product_suppliers_one_preferred_per_product" ON "product_suppliers" USING btree ("product_id") WHERE "product_suppliers"."is_preferred" = true;