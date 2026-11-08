ALTER TABLE "prevention_capa_actions" ADD COLUMN "legacy_code" text;--> statement-breakpoint
ALTER TABLE "prevention_incident_public_reports" ADD COLUMN "legacy_code" text;--> statement-breakpoint
ALTER TABLE "prevention_work_permits" ADD COLUMN "legacy_code" text;--> statement-breakpoint
ALTER TABLE "prevention_committee_meetings" ADD COLUMN "legacy_code" text;--> statement-breakpoint
ALTER TABLE "prevention_management_reviews" ADD COLUMN "legacy_code" text;--> statement-breakpoint
ALTER TABLE "prevention_emergency_plans" ADD COLUMN "legacy_code" text;--> statement-breakpoint
ALTER TABLE "prevention_external_engagements" ADD COLUMN "legacy_code" text;--> statement-breakpoint
ALTER TABLE "prevention_campaigns" ADD COLUMN "legacy_code" text;--> statement-breakpoint
ALTER TABLE "prevention_grd_meetings" ADD COLUMN "legacy_code" text;--> statement-breakpoint
-- Series correlativas PREFIJO-AAAA-NNNN para el resto de las familias de
-- prevencion: CAPA, CPHS (actas), RD (revision por la direccion), PE (plan de
-- emergencia), PT (permiso de trabajo), CGRD (actas), RPT (buzon de reportes),
-- CMP (campanas) y COORD / FISC / OAL (interacciones con externos).
--
-- Igual que 0380 (EV e INSP): hasta hoy el codigo de todas llevaba un sufijo
-- aleatorio (CAPA-2026-K3J9X0AB12, PE-2026--BD6H2Q). Pasan a numerarse con la
-- misma SEQUENCE nativa que el resto de los folios (next_document_code). Las
-- columnas legacy_code de arriba las genera drizzle-kit; todo lo que sigue es
-- datos y es idempotente: una fila ya renumerada no vuelve a coincidir con la
-- forma aleatoria, asi que reaplicarlo no cambia nada, y en una base vacia (CI,
-- desarrollo nuevo) no hace nada.
--
-- SOLO se renumeran las filas cuyo codigo tiene EXACTAMENTE la forma aleatoria
-- de su familia (prefijo + anio opcional + sufijo del largo fijo que generaba el
-- servicio, sobre el alfabeto URL-safe de nanoid en mayusculas: A-Z, 0-9, _ y -).
-- Los codigos de catalogo o de siembra (CAMP-BIODIVERSA-ALCOHOL, PE-DEMO,
-- CAPA-E2E-0001...) no tienen esa forma y no se tocan. Un correlativo es
-- ^PREFIJO-AAAA-NNNN$ con 4 o 5 digitos: un sufijo aleatorio de 6, 8 o 10
-- caracteres nunca puede confundirse con uno.
--
-- Campanas y las tres series de externos nacian sin anio (CMP-K3J9X0, COORD-
-- K3J9X0AB): la forma aleatoria excluye con un lookahead los codigos que ya
-- traen AAAA- (una siembra a mano tipo COORD-2026-001 tiene el mismo largo que
-- un sufijo aleatorio). Su anio sale del civil chileno de created_at.
--
-- El codigo anterior se conserva en legacy_code porque ya fue citado en avisos,
-- actas, evidencias y documentos generados. Esos textos son historicos y NO se
-- reescriben: legacy_code es el vinculo. Orden de numeracion: created_at, id, a
-- continuacion de cualquier correlativo que ya exista ese anio.
--
-- Sin barras invertidas a proposito: el divisor de sentencias del arnes PGlite
-- las trata como escape dentro de un literal.
DO $$
DECLARE
  familia     record;
  grupo       record;
  correlativo text;
  nombre      text;
  actual      bigint;
  objetivo    bigint;
BEGIN
  FOR familia IN
    SELECT * FROM (VALUES
      ('prevention_capa_actions',            'CAPA',  '^CAPA-[0-9]{4}-[A-Z0-9_-]{10}$'),
      ('prevention_committee_meetings',      'CPHS',  '^CPHS-[0-9]{4}-[A-Z0-9_-]{8}$'),
      ('prevention_management_reviews',      'RD',    '^RD-[0-9]{4}-[A-Z0-9_-]{6}$'),
      ('prevention_emergency_plans',         'PE',    '^PE-[0-9]{4}-[A-Z0-9_-]{6}$'),
      ('prevention_work_permits',            'PT',    '^PT-[0-9]{4}-[A-Z0-9_-]{8}$'),
      ('prevention_grd_meetings',            'CGRD',  '^CGRD-[0-9]{4}-[A-Z0-9_-]{8}$'),
      ('prevention_incident_public_reports', 'RPT',   '^RPT-[0-9]{4}-[A-Z0-9_-]{8}$'),
      ('prevention_campaigns',               'CMP',   '^CMP-(?![0-9]{4}-)[A-Z0-9_-]{6}$'),
      ('prevention_external_engagements',    'COORD', '^COORD-(?![0-9]{4}-)[A-Z0-9_-]{8}$'),
      ('prevention_external_engagements',    'FISC',  '^FISC-(?![0-9]{4}-)[A-Z0-9_-]{8}$'),
      ('prevention_external_engagements',    'OAL',   '^OAL-(?![0-9]{4}-)[A-Z0-9_-]{8}$')
    ) AS f(tabla, prefijo, aleatorio)
  LOOP
    correlativo := '^' || familia.prefijo || '-[0-9]{4}-[0-9]{4,5}$';

    -- 1/2: conserva el codigo aleatorio en legacy_code y lo reemplaza por el
    -- correlativo, en una sola sentencia (la UNIQUE de code se evalua al final).
    -- El anio es el del codigo anterior si lo trae (y es plausible) o, si no, el
    -- civil chileno de created_at.
    EXECUTE format($q$
      WITH pendientes AS (
        SELECT id,
               created_at,
               COALESCE(
                 CASE
                   WHEN substring(code from %1$L)::int BETWEEN 2000 AND 2100
                   THEN substring(code from %1$L)::int
                 END,
                 extract(year FROM created_at AT TIME ZONE 'America/Santiago')::int
               ) AS anio
          FROM %2$I
         WHERE code ~ %3$L
      ), emitidos AS (
        SELECT substring(code from %1$L)::int AS anio,
               max(substring(code from '-([0-9]+)$')::int) AS maximo
          FROM %2$I
         WHERE code ~ %4$L
         GROUP BY 1
      ), numerados AS (
        SELECT p.id,
               p.anio,
               COALESCE(e.maximo, 0)
                 + row_number() OVER (PARTITION BY p.anio ORDER BY p.created_at, p.id) AS n
          FROM pendientes p
          LEFT JOIN emitidos e ON e.anio = p.anio
      )
      UPDATE %2$I t
         SET legacy_code = COALESCE(t.legacy_code, t.code),
             code = %5$L || '-' || n.anio || '-'
                    || CASE WHEN n.n < 10000 THEN lpad(n.n::text, 4, '0') ELSE n.n::text END
        FROM numerados n
       WHERE t.id = n.id
    $q$,
      '^' || familia.prefijo || '-([0-9]{4})-',
      familia.tabla,
      familia.aleatorio,
      correlativo,
      familia.prefijo
    );

    -- 2/2: cada serie (prefijo + anio) arranca despues de su mayor correlativo,
    -- para que el proximo next_document_code entregue max + 1. El GREATEST con el
    -- last_value actual evita que reaplicar haga retroceder una secuencia que ya
    -- emitio folios nuevos.
    FOR grupo IN EXECUTE format(
      'SELECT substring(code from %L)::int AS anio, max(substring(code from %L)::bigint) AS maximo FROM %I WHERE code ~ %L GROUP BY 1',
      '^' || familia.prefijo || '-([0-9]{4})-',
      '-([0-9]+)$',
      familia.tabla,
      correlativo
    )
    LOOP
      nombre := 'code_seq_' || lower(familia.prefijo) || '_' || grupo.anio;
      EXECUTE format('CREATE SEQUENCE IF NOT EXISTS %I AS int MINVALUE 1 NO CYCLE', nombre);
      SELECT last_value INTO actual
        FROM pg_sequences
       WHERE schemaname = current_schema() AND sequencename = nombre;
      objetivo := greatest(grupo.maximo, COALESCE(actual, 0));
      IF objetivo >= 1 THEN
        EXECUTE format('SELECT setval(%L, %s, true)', nombre, objetivo);
      END IF;
    END LOOP;
  END LOOP;
END $$;
