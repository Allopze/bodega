-- Siembra el catálogo canónico de unidades de medida.
--
-- `product_units` existía desde la migración 0036 pero nunca se sembró: 0036
-- sólo registró lo que ya había en `products`, así que en producción quedó UNA
-- fila (`unidad`, sort_order 1001) y ni siquiera `servicio` o `dosis` —que sí
-- se usan— figuraban en el catálogo. Sin filas, alimentar el datalist de
-- solicitudes desde la BD dejaría la pantalla sin sugerencias.
--
-- Va en una migración y no en `db/seed.ts` porque las migraciones sí corren en
-- los cuatro entornos (dev, e2e, PGlite y producción); el seed no corre en
-- ninguno de los automáticos.
--
-- Los 16 códigos son la unión de los vocabularios que ya existían en el código
-- (`UNIT_OF_MEASURE_OPTIONS`, `VALID_UNITS`, `UNIT_PLURALS`) más lo observado
-- en datos reales. Se excluyen a propósito `pack` (alias de `paquete` en
-- `UNIT_ALIASES`) y `m2`/`m3` (en ninguna lista ni en ningún dato: el admin
-- puede agregarlos desde la UI si aparecen).
--
-- `ON CONFLICT DO NOTHING` para no pisar nunca una edición del administrador.
INSERT INTO product_units (id, code, label, description, sort_order, is_active) VALUES
  ('unit-unidad',   'unidad',   'Unidad',     NULL,  10, true),
  ('unit-par',      'par',      'Par',        NULL,  20, true),
  ('unit-caja',     'caja',     'Caja',       NULL,  30, true),
  ('unit-paquete',  'paquete',  'Paquete',    NULL,  40, true),
  ('unit-set',      'set',      'Set',        NULL,  50, true),
  ('unit-juego',    'juego',    'Juego',      NULL,  60, true),
  ('unit-bolsa',    'bolsa',    'Bolsa',      NULL,  70, true),
  ('unit-rollo',    'rollo',    'Rollo',      NULL,  80, true),
  ('unit-kit',      'kit',      'Kit',        NULL,  90, true),
  ('unit-tarro',    'tarro',    'Tarro',      NULL, 100, true),
  ('unit-bidon',    'bidon',    'Bidón',      NULL, 110, true),
  ('unit-kg',       'kg',       'Kilogramo',  NULL, 120, true),
  ('unit-litro',    'litro',    'Litro',      NULL, 130, true),
  ('unit-metro',    'metro',    'Metro',      NULL, 140, true),
  ('unit-servicio', 'servicio', 'Servicio',   NULL, 150, true),
  ('unit-dosis',    'dosis',    'Dosis',      NULL, 160, true)
ON CONFLICT (code) DO NOTHING;
--> statement-breakpoint
-- Repara la fila autogenerada por 0036: quedó con sort_order 1000+ y una
-- descripción de relleno, así que ordenaba después de todo lo sembrado acá.
UPDATE product_units
SET label = 'Unidad', description = NULL, sort_order = 10
WHERE code = 'unidad' AND sort_order >= 1000;
