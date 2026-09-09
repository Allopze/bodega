-- La familia de tallas `pantalon` pasa de cintura a letras.
--
-- Nació con cinturas 28..48 porque `workers.size_bottom` guardaba una, pero la
-- compilación de facturas 2022-2026 no deja lugar a duda: 11 productos de
-- pantalón, 4.491 unidades, ni una sola cintura — todo S, M, L, XL, 2XL, 3XL.
-- Las cinturas sólo alimentaban el selector «Pantalón» del padrón con valores
-- que no podían cruzar con ningún producto del catálogo.
--
-- Se dan de baja, no se borran: es la regla de `size_catalog` desde su
-- migración, y si alguna variante llegara a declarar una cintura el histórico
-- sigue existiendo. Los códigos de letra los agrega `db:seed-size-catalog`,
-- que `db:migrate` corre a continuación.
UPDATE "size_catalog"
SET "is_active" = false
WHERE "family" = 'pantalon' AND "code" ~ '^[0-9]+$';
