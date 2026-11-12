DROP TABLE IF EXISTS "product_attribute_templates" CASCADE;--> statement-breakpoint
-- Las unidades de medida quedan fijas en `lib/products/units.ts` (2026-11-12).
-- `product_units` sigue como destino de la FK de `products.unit_of_measure`:
-- se asegura que cada unidad de la lista exista, con su rótulo y su orden.
-- Los códigos históricos que no están en la lista no se tocan (algún producto
-- puede seguir usándolos y la FK los necesita).
INSERT INTO "product_units" ("id", "code", "label", "sort_order", "is_active") VALUES
  ('unit-unidad',   'unidad',   'Unidad',    10,  true),
  ('unit-par',      'par',      'Par',       20,  true),
  ('unit-caja',     'caja',     'Caja',      30,  true),
  ('unit-paquete',  'paquete',  'Paquete',   40,  true),
  ('unit-set',      'set',      'Set',       50,  true),
  ('unit-juego',    'juego',    'Juego',     60,  true),
  ('unit-bolsa',    'bolsa',    'Bolsa',     70,  true),
  ('unit-rollo',    'rollo',    'Rollo',     80,  true),
  ('unit-kit',      'kit',      'Kit',       90,  true),
  ('unit-tarro',    'tarro',    'Tarro',     100, true),
  ('unit-bidon',    'bidon',    'Bidón',     110, true),
  ('unit-kg',       'kg',       'Kilogramo', 120, true),
  ('unit-litro',    'litro',    'Litro',     130, true),
  ('unit-metro',    'metro',    'Metro',     140, true),
  ('unit-servicio', 'servicio', 'Servicio',  150, true),
  ('unit-dosis',    'dosis',    'Dosis',     160, true)
ON CONFLICT ("code") DO UPDATE SET
  "label" = EXCLUDED."label",
  "sort_order" = EXCLUDED."sort_order",
  "is_active" = true,
  "updated_at" = now();
