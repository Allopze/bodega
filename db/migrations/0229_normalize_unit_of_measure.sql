-- Saneo one-shot de `unit_of_measure` en las tablas internas.
--
-- El campo es texto libre (decisión documentada: un `Select` rechazaría las
-- unidades heredadas), y sin normalización el resultado en producción fue:
--   purchase_request_items: unidad 68 | servicio 3 | "4" 2 | "cajas" 1 |
--                           "15" 1 | "40" 1 | "20" 1 | "8" 1 | "CAJAS " 1
-- Los numéricos son una cantidad tipeada en el campo equivocado, y se
-- propagaron solicitud → OC → guía de despacho.
--
-- ⚠️  NO se tocan `dte_document_items` ni `purchase_order_invoice_items`: su
--     contenido viene del DTE del proveedor (UN, C/U, UND, EA, Lt…) y es
--     evidencia legal. El vocabulario es del emisor, no nuestro. Si alguien
--     "completa" este saneo agregándolas, estaría reescribiendo documentos
--     tributarios recibidos.

-- Paso 1 — espacios y caja. Misma expresión que 0036, idempotente.
UPDATE purchase_request_items SET unit_of_measure = regexp_replace(lower(btrim(unit_of_measure)), E'\\s+', ' ', 'g')
WHERE unit_of_measure <> regexp_replace(lower(btrim(unit_of_measure)), E'\\s+', ' ', 'g');
--> statement-breakpoint
UPDATE purchase_order_items SET unit_of_measure = regexp_replace(lower(btrim(unit_of_measure)), E'\\s+', ' ', 'g')
WHERE unit_of_measure <> regexp_replace(lower(btrim(unit_of_measure)), E'\\s+', ' ', 'g');
--> statement-breakpoint
UPDATE dispatch_guide_items SET unit_of_measure = regexp_replace(lower(btrim(unit_of_measure)), E'\\s+', ' ', 'g')
WHERE unit_of_measure <> regexp_replace(lower(btrim(unit_of_measure)), E'\\s+', ' ', 'g');
--> statement-breakpoint
UPDATE delivery_items SET unit_of_measure = regexp_replace(lower(btrim(unit_of_measure)), E'\\s+', ' ', 'g')
WHERE unit_of_measure <> regexp_replace(lower(btrim(unit_of_measure)), E'\\s+', ' ', 'g');
--> statement-breakpoint
UPDATE products SET unit_of_measure = regexp_replace(lower(btrim(unit_of_measure)), E'\\s+', ' ', 'g')
WHERE unit_of_measure <> regexp_replace(lower(btrim(unit_of_measure)), E'\\s+', ' ', 'g');
--> statement-breakpoint

-- Paso 2 — el único plural presente en los datos, como mapeo explícito y no
-- como stemmer (un stemmer convertiría "dosis" en "dosi").
UPDATE purchase_request_items SET unit_of_measure = 'caja' WHERE unit_of_measure = 'cajas';
--> statement-breakpoint
UPDATE purchase_order_items   SET unit_of_measure = 'caja' WHERE unit_of_measure = 'cajas';
--> statement-breakpoint
UPDATE dispatch_guide_items   SET unit_of_measure = 'caja' WHERE unit_of_measure = 'cajas';
--> statement-breakpoint
UPDATE delivery_items         SET unit_of_measure = 'caja' WHERE unit_of_measure = 'cajas';
--> statement-breakpoint
UPDATE products               SET unit_of_measure = 'caja' WHERE unit_of_measure = 'cajas';
--> statement-breakpoint

-- Paso 3 — los numéricos pasan a la unidad por defecto, dejando rastro en
-- `notes`. NO se toca `quantity`: no hay forma de saber si además quedó con el
-- número correcto, y reescribirla sería irreversible. La nota es el único
-- registro de que el valor existió.
UPDATE purchase_request_items
SET unit_of_measure = 'unidad',
    notes = COALESCE(NULLIF(notes, '') || ' · ', '') || 'Unidad original: "' || unit_of_measure || '" (corregida por migración 0229).'
WHERE unit_of_measure ~ '^[0-9]+([.,][0-9]+)?$';
--> statement-breakpoint
UPDATE purchase_order_items
SET unit_of_measure = 'unidad',
    notes = COALESCE(NULLIF(notes, '') || ' · ', '') || 'Unidad original: "' || unit_of_measure || '" (corregida por migración 0229).'
WHERE unit_of_measure ~ '^[0-9]+([.,][0-9]+)?$';
--> statement-breakpoint
UPDATE dispatch_guide_items
SET unit_of_measure = 'unidad',
    notes = COALESCE(NULLIF(notes, '') || ' · ', '') || 'Unidad original: "' || unit_of_measure || '" (corregida por migración 0229).'
WHERE unit_of_measure ~ '^[0-9]+([.,][0-9]+)?$';
--> statement-breakpoint
UPDATE delivery_items
SET unit_of_measure = 'unidad',
    notes = COALESCE(NULLIF(notes, '') || ' · ', '') || 'Unidad original: "' || unit_of_measure || '" (corregida por migración 0229).'
WHERE unit_of_measure ~ '^[0-9]+([.,][0-9]+)?$';
--> statement-breakpoint
UPDATE products
SET unit_of_measure = 'unidad',
    notes = COALESCE(NULLIF(notes, '') || ' · ', '') || 'Unidad original: "' || unit_of_measure || '" (corregida por migración 0229).'
WHERE unit_of_measure ~ '^[0-9]+([.,][0-9]+)?$';
--> statement-breakpoint

-- Paso 4 — registrar en el catálogo cualquier unidad que haya sobrevivido, para
-- que refleje la realidad. Corre DESPUÉS de la siembra de 0228: al revés
-- habría registrado "cajas" como código legacy antes de que existiera "caja".
WITH surviving_units AS (
  SELECT DISTINCT unit_of_measure AS code FROM purchase_request_items
  UNION SELECT DISTINCT unit_of_measure FROM purchase_order_items
  UNION SELECT DISTINCT unit_of_measure FROM dispatch_guide_items
  UNION SELECT DISTINCT unit_of_measure FROM delivery_items
  UNION SELECT DISTINCT unit_of_measure FROM products
)
INSERT INTO product_units (id, code, label, description, sort_order, is_active)
SELECT
  'legacy-unit-' || md5(code),
  code,
  initcap(code),
  'Unidad registrada automáticamente desde datos existentes.',
  1000 + (row_number() OVER (ORDER BY code))::integer,
  true
FROM surviving_units
WHERE btrim(code) <> ''
ON CONFLICT (code) DO NOTHING;
