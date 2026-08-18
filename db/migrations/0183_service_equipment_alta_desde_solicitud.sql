-- El registro de equipos deja de llenarse por adelantado: pedir la mantención
-- da de alta el instrumento por su código si no estaba. Eso exige dos cosas.
--
-- Escrita a mano y no con `drizzle-kit generate`: puede haber otra sesión
-- editando el árbol y `generate` migra el esquema entero, no sólo esto.

-- 1. La ficha que nace de una solicitud tiene código y faena, pero el nombre es
--    autogenerado y le faltan marca, modelo y serie. Administración la completa
--    desde /admin/equipos y con eso se apaga la marca.
ALTER TABLE "service_equipment" ADD COLUMN "needs_review" boolean DEFAULT false NOT NULL;--> statement-breakpoint

-- 2. Los códigos pasan a viajar normalizados (sin espacios sobrantes, en
--    mayúsculas): el índice único es lo único que impide que el mismo aparato
--    entre dos veces escrito distinto. Si dos filas colisionan al normalizar, la
--    migración aborta diciendo cuáles en vez de romperse con un error opaco.
DO $$
DECLARE colisiones text;
BEGIN
  SELECT string_agg(c, ', ') INTO colisiones FROM (
    SELECT upper(btrim(regexp_replace(code, '\s+', ' ', 'g'))) AS c
    FROM service_equipment
    GROUP BY 1
    HAVING count(*) > 1
  ) d;
  IF colisiones IS NOT NULL THEN
    RAISE EXCEPTION 'Códigos de equipo que colisionan al normalizar: %. Unifica esas fichas antes de migrar.', colisiones;
  END IF;
END $$;--> statement-breakpoint

UPDATE "service_equipment"
SET "code" = upper(btrim(regexp_replace("code", '\s+', ' ', 'g')))
WHERE "code" <> upper(btrim(regexp_replace("code", '\s+', ' ', 'g')));
