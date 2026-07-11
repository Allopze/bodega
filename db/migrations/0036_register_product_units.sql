-- Custom SQL migration file, put your code below! --
-- Register every unit already present in products so the new catalog can govern
-- existing data without dropping or silently invalidating legacy records.
WITH legacy_units AS (
  SELECT DISTINCT regexp_replace(lower(btrim(unit_of_measure)), E'\\s+', ' ', 'g') AS code
  FROM products
  WHERE btrim(unit_of_measure) <> ''
)
INSERT INTO product_units (id, code, label, description, sort_order, is_active)
SELECT
  'legacy-unit-' || md5(code),
  code,
  initcap(code),
  'Unidad registrada automáticamente desde productos existentes.',
  1000 + (row_number() OVER (ORDER BY code))::integer,
  true
FROM legacy_units
ON CONFLICT (code) DO NOTHING;
--> statement-breakpoint
UPDATE products
SET unit_of_measure = regexp_replace(lower(btrim(unit_of_measure)), E'\\s+', ' ', 'g')
WHERE btrim(unit_of_measure) <> '';
