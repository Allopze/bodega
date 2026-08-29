-- Productos de combustible que la cuenta Aramco tiene habilitados y que hasta
-- ahora no tenían ficha: sin ellos, `canonicalProduct` devolvía null, la fila
-- quedaba `pending` por "producto sin mapping canónico" y sus litros NUNCA
-- llegaban a un lote. La fuente `Aramco Fleet Otros`, que existe justamente
-- para recogerlos, era código inalcanzable.
--
-- `is_active` true: son compras reales, no un cajón histórico como
-- `fuel-historical-unspecified` (que queda donde estaba, inactivo).
INSERT INTO "fuel_products" ("id", "code", "name", "category", "unit", "aliases", "description", "is_system", "is_active") VALUES
  ('fuel-gasoline', 'GASOLINE', 'Gasolina', 'gasoline', 'liter', '["GASOLINA", "BENCINA", "GASOLINE", "93", "95", "97"]'::jsonb, 'Gasolina para vehículos livianos.', true, true),
  ('fuel-kerosene', 'KEROSENE', 'Kerosene', 'other', 'liter', '["KEROSENE", "KEROSENO", "PARAFINA"]'::jsonb, 'Kerosene / parafina.', true, true)
ON CONFLICT ("code") DO NOTHING;
