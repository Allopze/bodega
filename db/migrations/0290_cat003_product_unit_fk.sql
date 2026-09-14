-- CAT-003: la unidad del producto tiene que existir en el catálogo de unidades.
--
-- `product_units` es un catálogo administrable (código, etiqueta, orden,
-- activo) y `products.unit_of_measure` era texto libre validado sólo por largo:
-- nada comprobaba que la unidad guardada existiera en él. El catálogo era una
-- sugerencia y convivían unidades fuera de él.
--
-- Por qué en base y no sólo en zod: los importadores masivos (XLSX de
-- productos, EPP) y cualquier script escriben `products` sin pasar por el
-- formulario. Una validación que sólo vive en el schema del formulario no los
-- alcanza; una FK sí alcanza a todo camino de escritura, presente y futuro.
--
-- Se puede añadir sin romper datos porque la migración 0229 ya registró en
-- `product_units` toda unidad sobreviviente. El paso 1 repite ese registro por
-- si hubo escrituras entre 0229 y hoy: sin él la FK fallaría al crearse en un
-- entorno con deriva, que es exactamente el problema que viene a cerrar.
WITH surviving_units AS (
  SELECT DISTINCT unit_of_measure AS code FROM products WHERE btrim(unit_of_measure) <> ''
)
INSERT INTO product_units (id, code, label, description, sort_order, is_active)
SELECT
  'legacy-unit-' || md5(code),
  code,
  initcap(code),
  'Unidad registrada automáticamente desde productos existentes (migración 0307).',
  2000 + (row_number() OVER (ORDER BY code))::integer,
  true
FROM surviving_units
ON CONFLICT (code) DO NOTHING;
--> statement-breakpoint
-- ON UPDATE CASCADE: renombrar el código de una unidad en el catálogo arrastra
-- a los productos que la usan. Sin RESTRICT/CASCADE en DELETE explícito, el
-- comportamiento por defecto (NO ACTION) impide borrar una unidad en uso, que
-- es lo correcto: dar de baja se hace con `is_active`, no borrando la fila.
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_unit_of_measure_fk;
--> statement-breakpoint
ALTER TABLE products ADD CONSTRAINT products_unit_of_measure_fk
  FOREIGN KEY (unit_of_measure) REFERENCES product_units(code) ON UPDATE CASCADE;
