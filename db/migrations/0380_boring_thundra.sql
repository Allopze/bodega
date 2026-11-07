-- Series correlativas EV-AAAA-NNNN (incidentes de prevencion) e INSP-AAAA-NNNN
-- (ejecuciones de inspeccion).
--
-- Hasta hoy el codigo de ambos se armaba con un sufijo aleatorio
-- (INC-2026-K3J9X0AB12, INSP-2026-7QX0M2PL). Pasan a numerarse con la misma
-- SEQUENCE nativa que el resto de los folios (next_document_code). El prefijo de
-- los incidentes cambia de INC a EV porque INC ya es la serie de tickets de TI.
--
-- Las dos columnas legacy_code de arriba las genera drizzle-kit. Todo lo que
-- sigue es datos y es idempotente: las filas que ya llevan un codigo correlativo
-- no se tocan, asi que reaplicarlo no cambia nada, y en una base vacia (CI,
-- desarrollo nuevo) no hace nada.
--
-- El codigo anterior se conserva en legacy_code porque ya fue citado en
-- notificaciones, tareas CAPA, motivos de hallazgo y documentos generados. Esos
-- textos son historicos y NO se reescriben: legacy_code es el vinculo.
--
-- Un codigo es correlativo si cumple ^PREFIJO-AAAA-NNNN$ con 4 a 6 digitos. El
-- tope de 6 evita que un sufijo aleatorio de ocho digitos (posible en INSP)
-- pase por correlativo y dispare la secuencia.
ALTER TABLE "prevention_incidents" ADD COLUMN "legacy_code" text;--> statement-breakpoint
ALTER TABLE "prevention_inspection_runs" ADD COLUMN "legacy_code" text;--> statement-breakpoint
-- Incidentes 1/3: conserva el codigo aleatorio previo.
UPDATE "prevention_incidents"
   SET "legacy_code" = "code"
 WHERE "legacy_code" IS NULL
   AND "code" !~ '^EV-[0-9]{4}-[0-9]{4,6}$';--> statement-breakpoint
-- Incidentes 2/3: renumera por anio (el del codigo anterior, o el civil chileno de
-- created_at si el codigo no lo trae) en orden de creacion, a continuacion de
-- cualquier correlativo ya emitido ese anio.
WITH pendientes AS (
  SELECT "id",
         "created_at",
         COALESCE(
           CASE
             WHEN substring("code" from '^[A-Z]+-([0-9]{4})-')::int BETWEEN 2000 AND 2100
             THEN substring("code" from '^[A-Z]+-([0-9]{4})-')::int
           END,
           extract(year FROM "created_at" AT TIME ZONE 'America/Santiago')::int
         ) AS anio
    FROM "prevention_incidents"
   WHERE "code" !~ '^EV-[0-9]{4}-[0-9]{4,6}$'
), emitidos AS (
  SELECT substring("code" from '^EV-([0-9]{4})-')::int AS anio,
         max(substring("code" from '-([0-9]+)$')::int) AS maximo
    FROM "prevention_incidents"
   WHERE "code" ~ '^EV-[0-9]{4}-[0-9]{4,6}$'
   GROUP BY 1
), numerados AS (
  SELECT p."id",
         p.anio,
         COALESCE(e.maximo, 0)
           + row_number() OVER (PARTITION BY p.anio ORDER BY p."created_at", p."id") AS n
    FROM pendientes p
    LEFT JOIN emitidos e ON e.anio = p.anio
)
UPDATE "prevention_incidents" t
   SET "code" = 'EV-' || n.anio || '-' || CASE WHEN n.n < 10000 THEN lpad(n.n::text, 4, '0') ELSE n.n::text END
  FROM numerados n
 WHERE t."id" = n."id";--> statement-breakpoint
-- Inspecciones 1/3: conserva el codigo aleatorio previo.
UPDATE "prevention_inspection_runs"
   SET "legacy_code" = "code"
 WHERE "legacy_code" IS NULL
   AND "code" !~ '^INSP-[0-9]{4}-[0-9]{4,6}$';--> statement-breakpoint
-- Inspecciones 2/3: renumera por anio (el del codigo anterior, o el civil chileno de
-- created_at si el codigo no lo trae) en orden de creacion, a continuacion de
-- cualquier correlativo ya emitido ese anio.
WITH pendientes AS (
  SELECT "id",
         "created_at",
         COALESCE(
           CASE
             WHEN substring("code" from '^[A-Z]+-([0-9]{4})-')::int BETWEEN 2000 AND 2100
             THEN substring("code" from '^[A-Z]+-([0-9]{4})-')::int
           END,
           extract(year FROM "created_at" AT TIME ZONE 'America/Santiago')::int
         ) AS anio
    FROM "prevention_inspection_runs"
   WHERE "code" !~ '^INSP-[0-9]{4}-[0-9]{4,6}$'
), emitidos AS (
  SELECT substring("code" from '^INSP-([0-9]{4})-')::int AS anio,
         max(substring("code" from '-([0-9]+)$')::int) AS maximo
    FROM "prevention_inspection_runs"
   WHERE "code" ~ '^INSP-[0-9]{4}-[0-9]{4,6}$'
   GROUP BY 1
), numerados AS (
  SELECT p."id",
         p.anio,
         COALESCE(e.maximo, 0)
           + row_number() OVER (PARTITION BY p.anio ORDER BY p."created_at", p."id") AS n
    FROM pendientes p
    LEFT JOIN emitidos e ON e.anio = p.anio
)
UPDATE "prevention_inspection_runs" t
   SET "code" = 'INSP-' || n.anio || '-' || CASE WHEN n.n < 10000 THEN lpad(n.n::text, 4, '0') ELSE n.n::text END
  FROM numerados n
 WHERE t."id" = n."id";--> statement-breakpoint
-- Incidentes e inspecciones 3/3: cada serie (prefijo + anio) arranca despues de su
-- mayor correlativo, para que el proximo next_document_code entregue max + 1.
-- GREATEST con el last_value actual: reaplicar nunca hace retroceder una secuencia
-- que ya emitio folios nuevos.
DO $$
DECLARE
  serie  record;
  grupo  record;
  nombre text;
  actual bigint;
BEGIN
  FOR serie IN
    SELECT * FROM (VALUES
      ('prevention_incidents', 'EV'),
      ('prevention_inspection_runs', 'INSP')
    ) AS s(tabla, prefijo)
  LOOP
    FOR grupo IN EXECUTE format(
      'SELECT substring(code from %L)::int AS anio, max(substring(code from %L)::bigint) AS maximo FROM %I WHERE code ~ %L GROUP BY 1',
      '^' || serie.prefijo || '-([0-9]{4})-',
      '-([0-9]+)$',
      serie.tabla,
      '^' || serie.prefijo || '-[0-9]{4}-[0-9]{4,6}$'
    )
    LOOP
      nombre := 'code_seq_' || lower(serie.prefijo) || '_' || grupo.anio;
      EXECUTE format('CREATE SEQUENCE IF NOT EXISTS %I AS int MINVALUE 1 NO CYCLE', nombre);
      SELECT last_value INTO actual
        FROM pg_sequences
       WHERE schemaname = current_schema() AND sequencename = nombre;
      EXECUTE format('SELECT setval(%L, %s, true)', nombre, greatest(grupo.maximo, COALESCE(actual, 0)));
    END LOOP;
  END LOOP;
END $$;
