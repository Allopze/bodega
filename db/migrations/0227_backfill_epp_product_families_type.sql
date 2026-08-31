-- Saneo one-shot: `epp_product_families.epp_type_id` (FK canónica a
-- `epp_types`, migración 0091) nunca lo escribía nadie — el alta manual y el
-- asistente de variantes insertaban `epp_type_id = NULL`, y el import XLSX
-- sólo llenaba el texto deprecado `epp_type` (con su propio vocabulario de
-- ítem: "casco", "guante"...). `computeEppCoverageGaps` hace INNER JOIN sobre
-- `epp_type_id` para contar entregas como cobertura, así que toda familia sin
-- clasificar queda invisible para Prevención: ninguna entrega a esos EPP
-- acredita a nadie y el selector de familias del requisito sale vacío.
--
-- Mapea el vocabulario de ítem del import al vocabulario de zona corporal de
-- `epp_types` para las familias legacy que sí tienen `epp_type`. Las que no
-- tengan un mapeo claro (`otros`) o no tengan `epp_type` en absoluto quedan
-- sin clasificar: se resuelven a mano desde /admin/epps (ver también el
-- selector nuevo en el asistente de productos, que ya no permite crear una
-- familia EPP sin tipo).
UPDATE "epp_product_families" f
SET "epp_type_id" = m.epp_type_id
FROM (VALUES
  ('casco',              'eppt-cabeza'),
  ('guante',             'eppt-manos'),
  ('lente',              'eppt-ojos-cara'),
  ('antiparra',          'eppt-ojos-cara'),
  ('botin',              'eppt-pies'),
  ('zapato',             'eppt-pies'),
  ('chaleco',            'eppt-cuerpo'),
  ('mascarilla',         'eppt-respiratoria'),
  ('respirador',         'eppt-respiratoria'),
  ('arnes',              'eppt-caidas'),
  ('protector auditivo', 'eppt-auditiva'),
  ('buzo',               'eppt-cuerpo'),
  ('traje',              'eppt-cuerpo'),
  ('pantalon',           'eppt-cuerpo'),
  ('chaqueta',           'eppt-cuerpo')
) AS m(epp_type, epp_type_id)
WHERE f."epp_type_id" IS NULL
  AND f."epp_type" = m.epp_type;
