CREATE TABLE "worker_capability_overrides" (
	"id" text PRIMARY KEY NOT NULL,
	"worker_id" text NOT NULL,
	"capability_id" text NOT NULL,
	"mode" text NOT NULL,
	"reason" text NOT NULL,
	"created_by_user_id" text,
	"updated_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "worker_capability_overrides_mode_valid" CHECK ("worker_capability_overrides"."mode" IN ('include', 'exclude')),
	CONSTRAINT "worker_capability_overrides_reason_valid" CHECK (length(trim("worker_capability_overrides"."reason")) BETWEEN 5 AND 1000)
);
--> statement-breakpoint
CREATE TABLE "worker_position_history" (
	"id" text PRIMARY KEY NOT NULL,
	"worker_id" text NOT NULL,
	"previous_position_id" text,
	"next_position_id" text NOT NULL,
	"previous_position_label" text,
	"next_position_label" text NOT NULL,
	"source" text NOT NULL,
	"reason" text,
	"changed_by_user_id" text,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "worker_position_history_source_valid" CHECK ("worker_position_history"."source" IN ('migration', 'admin', 'import', 'system')),
	CONSTRAINT "worker_position_history_next_label_valid" CHECK (length(trim("worker_position_history"."next_position_label")) BETWEEN 2 AND 120)
);
--> statement-breakpoint
CREATE TABLE "worker_capabilities" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "worker_capabilities_code_unique" UNIQUE("code"),
	CONSTRAINT "worker_capabilities_code_valid" CHECK ("worker_capabilities"."code" ~ '^[a-z][a-z0-9_]{1,79}$'),
	CONSTRAINT "worker_capabilities_name_valid" CHECK (length(trim("worker_capabilities"."name")) BETWEEN 2 AND 120)
);
--> statement-breakpoint
CREATE TABLE "worker_position_aliases" (
	"id" text PRIMARY KEY NOT NULL,
	"position_id" text NOT NULL,
	"alias" text NOT NULL,
	"normalized_key" text NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "worker_position_aliases_alias_valid" CHECK (length(trim("worker_position_aliases"."alias")) BETWEEN 2 AND 120),
	CONSTRAINT "worker_position_aliases_key_valid" CHECK (length(trim("worker_position_aliases"."normalized_key")) BETWEEN 2 AND 120),
	CONSTRAINT "worker_position_aliases_source_valid" CHECK ("worker_position_aliases"."source" IN ('manual', 'import', 'migration', 'merge'))
);
--> statement-breakpoint
CREATE TABLE "worker_position_capabilities" (
	"position_id" text NOT NULL,
	"capability_id" text NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "worker_position_capabilities_position_id_capability_id_pk" PRIMARY KEY("position_id","capability_id")
);
--> statement-breakpoint
CREATE TABLE "worker_positions" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"normalized_key" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"needs_review" boolean DEFAULT false NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "worker_positions_code_unique" UNIQUE("code"),
	CONSTRAINT "worker_positions_normalized_key_unique" UNIQUE("normalized_key"),
	CONSTRAINT "worker_positions_code_valid" CHECK (length(trim("worker_positions"."code")) BETWEEN 2 AND 80),
	CONSTRAINT "worker_positions_name_valid" CHECK (length(trim("worker_positions"."name")) BETWEEN 2 AND 120),
	CONSTRAINT "worker_positions_normalized_key_valid" CHECK (length(trim("worker_positions"."normalized_key")) BETWEEN 2 AND 120)
);
--> statement-breakpoint
ALTER TABLE "workers" ADD COLUMN "position_id" text;--> statement-breakpoint
ALTER TABLE "worker_capability_overrides" ADD CONSTRAINT "worker_capability_overrides_worker_id_workers_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker_capability_overrides" ADD CONSTRAINT "worker_capability_overrides_capability_id_fk" FOREIGN KEY ("capability_id") REFERENCES "public"."worker_capabilities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker_position_history" ADD CONSTRAINT "worker_position_history_worker_id_workers_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker_position_history" ADD CONSTRAINT "worker_position_history_previous_position_id_fk" FOREIGN KEY ("previous_position_id") REFERENCES "public"."worker_positions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker_position_history" ADD CONSTRAINT "worker_position_history_next_position_id_worker_positions_id_fk" FOREIGN KEY ("next_position_id") REFERENCES "public"."worker_positions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker_position_aliases" ADD CONSTRAINT "worker_position_aliases_position_id_worker_positions_id_fk" FOREIGN KEY ("position_id") REFERENCES "public"."worker_positions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker_position_capabilities" ADD CONSTRAINT "worker_position_capabilities_position_id_worker_positions_id_fk" FOREIGN KEY ("position_id") REFERENCES "public"."worker_positions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker_position_capabilities" ADD CONSTRAINT "worker_position_capabilities_capability_id_fk" FOREIGN KEY ("capability_id") REFERENCES "public"."worker_capabilities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "worker_capability_overrides_worker_capability_unique" ON "worker_capability_overrides" USING btree ("worker_id","capability_id");--> statement-breakpoint
CREATE INDEX "worker_capability_overrides_capability_idx" ON "worker_capability_overrides" USING btree ("capability_id","mode");--> statement-breakpoint
CREATE INDEX "worker_position_history_worker_changed_idx" ON "worker_position_history" USING btree ("worker_id","changed_at");--> statement-breakpoint
CREATE INDEX "worker_position_history_next_position_idx" ON "worker_position_history" USING btree ("next_position_id","changed_at");--> statement-breakpoint
CREATE INDEX "worker_capabilities_active_idx" ON "worker_capabilities" USING btree ("is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "worker_position_aliases_normalized_key_unique" ON "worker_position_aliases" USING btree ("normalized_key");--> statement-breakpoint
CREATE INDEX "worker_position_aliases_position_idx" ON "worker_position_aliases" USING btree ("position_id");--> statement-breakpoint
CREATE INDEX "worker_position_capabilities_capability_idx" ON "worker_position_capabilities" USING btree ("capability_id","position_id");--> statement-breakpoint
CREATE INDEX "worker_positions_active_review_idx" ON "worker_positions" USING btree ("is_active","needs_review");--> statement-breakpoint
ALTER TABLE "workers" ADD CONSTRAINT "workers_position_id_worker_positions_id_fk" FOREIGN KEY ("position_id") REFERENCES "public"."worker_positions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workers_position_idx" ON "workers" USING btree ("position_id");--> statement-breakpoint
CREATE INDEX "workers_worksite_position_active_idx" ON "workers" USING btree ("worksite_id","position_id","is_active");
--> statement-breakpoint
-- worker-position-backfill:start
-- Espejo SQL de `lib/services/worker-positions/normalization.ts`.
--
-- Usa el `normalize(..., NFKD)` nativo de Postgres (13+), que es la misma
-- operación que aplica el normalizador TypeScript, en vez de emularla con
-- `translate`. Así cubre también lo que un `translate` no puede expandir 1→N
-- —ligaduras (ﬁ), latín de ancho completo, fracciones, numerales romanos— y
-- elimina la clase de divergencia entera en vez de parchear caso por caso.
--
-- NFKD deja los diacríticos como marcas combinantes sueltas: hay que quitarlas
-- antes de convertir el resto en espacios, o «eléctrico» quedaría «el ctrico».
-- `worker-position-backfill-pglite.test.ts` contrasta ambas implementaciones
-- sobre un corpus y falla si se separan.
CREATE OR REPLACE FUNCTION normalize_worker_position_key(input_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT NULLIF(
    btrim(
      regexp_replace(
        regexp_replace(
          lower(normalize(coalesce(input_value, ''), NFKD)),
          '[̀-ͯ]',
          '',
          'g'
        ),
        '[^a-z0-9]+',
        ' ',
        'g'
      )
    ),
    ''
  )
$$;
--> statement-breakpoint
INSERT INTO "worker_positions"
  ("id", "code", "name", "normalized_key", "is_active", "needs_review", "is_system")
VALUES
  -- `needs_review = false`: es un cargo de sistema y `updateWorkerPosition` lo
  -- rechaza, así que marcarlo dejaba un badge «por revisar» que ninguna acción
  -- podía limpiar. Que haya gente sin clasificar se ve en su nº de trabajadores.
  ('worker-position-unclassified', 'SIN-CLASIFICAR', 'Sin clasificar', 'sin clasificar', true, false, true)
ON CONFLICT ("normalized_key") DO NOTHING;
--> statement-breakpoint
INSERT INTO "worker_capabilities"
  ("id", "code", "name", "description", "is_active")
VALUES
  (
    'worker-capability-drives-vehicle',
    'drives_vehicle',
    'Conduce vehículos',
    'Conduce vehículos livianos o pesados como parte de sus funciones.',
    true
  ),
  (
    'worker-capability-operates-equipment',
    'operates_equipment',
    'Opera equipos o maquinaria móvil',
    'Opera equipos, maquinaria o vehículos industriales móviles.',
    true
  )
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint
WITH normalized_workers AS (
  SELECT
    w."id",
    normalize_worker_position_key(w."position") AS normalized_key,
    btrim(regexp_replace(w."position", '[[:space:]]+', ' ', 'g')) AS display_name,
    w."created_at"
  FROM "workers" w
  WHERE normalize_worker_position_key(w."position") IS NOT NULL
), canonical_names AS (
  SELECT DISTINCT ON (normalized_key)
    normalized_key,
    -- `worker_positions_name_valid` exige 2..120. El texto legado no tenía
    -- tope, así que se recorta en vez de reventar la migración entera.
    left(display_name, 120) AS display_name
  FROM normalized_workers
  -- Una clave fuera del rango que admite el catálogo no genera cargo: esos
  -- trabajadores caen en Sin clasificar más abajo.
  WHERE length(normalized_key) BETWEEN 2 AND 120
  ORDER BY normalized_key, created_at, id
)
INSERT INTO "worker_positions"
  ("id", "code", "name", "normalized_key", "is_active", "needs_review", "is_system")
SELECT
  'worker-position-' || substr(md5(c.normalized_key), 1, 24),
  'AUTO-' || upper(substr(md5(c.normalized_key), 1, 12)),
  c.display_name,
  c.normalized_key,
  true,
  true,
  false
FROM canonical_names c
ON CONFLICT ("normalized_key") DO NOTHING;
--> statement-breakpoint
UPDATE "workers" w
SET "position_id" = p."id"
FROM "worker_positions" p
WHERE w."position_id" IS NULL
  AND p."normalized_key" = coalesce(
    normalize_worker_position_key(w."position"),
    'sin clasificar'
  );
--> statement-breakpoint
-- Red de seguridad: todo trabajador queda con cargo. Acá caen los que tenían
-- un texto que no produjo un cargo válido (fuera de rango). Va antes del
-- historial para que también quede registrada su asignación inicial.
UPDATE "workers" w
SET "position_id" = p."id"
FROM "worker_positions" p
WHERE w."position_id" IS NULL
  AND p."normalized_key" = 'sin clasificar';
--> statement-breakpoint
INSERT INTO "worker_position_history"
  (
    "id",
    "worker_id",
    "previous_position_id",
    "next_position_id",
    "previous_position_label",
    "next_position_label",
    "source",
    "reason"
  )
SELECT
  'worker-position-history-migration-' || md5(w."id"),
  w."id",
  NULL,
  p."id",
  w."position",
  p."name",
  'migration',
  'Backfill inicial desde el texto legado de cargo'
FROM "workers" w
JOIN "worker_positions" p ON p."id" = w."position_id"
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
DROP FUNCTION IF EXISTS normalize_worker_position_key(text);
--> statement-breakpoint
-- Una clave no puede ser simultáneamente cargo canónico y alias de otro cargo.
-- El bloqueo transaccional evita que dos importaciones creen esa ambigüedad.
CREATE OR REPLACE FUNCTION enforce_worker_position_key_uniqueness()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.normalized_key, 0));
  IF TG_TABLE_NAME = 'worker_positions' THEN
    IF EXISTS (SELECT 1 FROM worker_position_aliases WHERE normalized_key = NEW.normalized_key AND position_id <> NEW.id) THEN
      RAISE EXCEPTION 'La clave normalizada ya es un alias de otro cargo: %', NEW.normalized_key;
    END IF;
  ELSE
    IF EXISTS (SELECT 1 FROM worker_positions WHERE normalized_key = NEW.normalized_key AND id <> NEW.position_id) THEN
      RAISE EXCEPTION 'La clave normalizada ya es un cargo canónico: %', NEW.normalized_key;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS worker_positions_normalized_key_guard ON worker_positions;
CREATE TRIGGER worker_positions_normalized_key_guard
BEFORE INSERT OR UPDATE OF normalized_key ON worker_positions
FOR EACH ROW EXECUTE FUNCTION enforce_worker_position_key_uniqueness();
--> statement-breakpoint
DROP TRIGGER IF EXISTS worker_position_aliases_normalized_key_guard ON worker_position_aliases;
CREATE TRIGGER worker_position_aliases_normalized_key_guard
BEFORE INSERT OR UPDATE OF normalized_key ON worker_position_aliases
FOR EACH ROW EXECUTE FUNCTION enforce_worker_position_key_uniqueness();
--> statement-breakpoint
-- La historia de cargos es evidencia; no debe poder editarse ni borrarse.
CREATE OR REPLACE FUNCTION prevent_worker_position_history_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'El historial de cargos es inmutable';
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS worker_position_history_immutable ON worker_position_history;
CREATE TRIGGER worker_position_history_immutable
BEFORE UPDATE OR DELETE ON worker_position_history
FOR EACH ROW EXECUTE FUNCTION prevent_worker_position_history_mutation();
