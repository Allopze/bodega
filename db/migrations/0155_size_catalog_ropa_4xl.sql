-- Talla 4XL para ropa (misma escala que 0088, siguiente en display_order).
INSERT INTO "size_catalog" ("id", "family", "code", "display_order") VALUES
  ('size-ropa-4xl', 'ropa', '4XL', 7)
ON CONFLICT ("family", "code") DO NOTHING;
