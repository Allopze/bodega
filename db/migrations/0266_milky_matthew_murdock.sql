CREATE TABLE "prevention_deviation_catalog" (
	"id" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"dano_potencial" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prevention_deviation_dano_valid" CHECK ("prevention_deviation_catalog"."dano_potencial" IN ('leve', 'moderado', 'grave', 'fatal')),
	CONSTRAINT "prevention_deviation_label_length" CHECK (length("prevention_deviation_catalog"."label") >= 3)
);
--> statement-breakpoint
CREATE TABLE "prevention_template_deviations" (
	"id" text PRIMARY KEY NOT NULL,
	"template_code" text NOT NULL,
	"entry_id" text NOT NULL,
	"dano_potencial_override" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prevention_template_deviation_override_valid" CHECK ("prevention_template_deviations"."dano_potencial_override" IS NULL OR "prevention_template_deviations"."dano_potencial_override" IN ('leve', 'moderado', 'grave', 'fatal'))
);
--> statement-breakpoint
-- La FK que creó 0210 se declaró con un nombre de 94 bytes y Postgres lo
-- truncó a 63 al guardarlo, así que un DROP CONSTRAINT por nombre literal
-- —lo que genera drizzle— no la encuentra. Se busca por columna.
DO $$
DECLARE con_name text;
BEGIN
  SELECT c.conname INTO con_name
  FROM pg_constraint c
  JOIN pg_attribute a
    ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
  WHERE c.conrelid = 'prevention_inspection_findings'::regclass
    AND c.contype = 'f'
    AND a.attname = 'catalog_entry_id'
    AND c.conname <> 'insfnd_catalog_entry_fk';
  IF con_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE prevention_inspection_findings DROP CONSTRAINT %I', con_name);
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "prevention_deviation_catalog" ADD CONSTRAINT "pdc_author_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_template_deviations" ADD CONSTRAINT "ptd_entry_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."prevention_deviation_catalog"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_template_deviations" ADD CONSTRAINT "ptd_author_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "prevention_deviation_label_unique" ON "prevention_deviation_catalog" USING btree ("label");--> statement-breakpoint
CREATE INDEX "prevention_deviation_active_idx" ON "prevention_deviation_catalog" USING btree ("is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "prevention_template_deviation_unique" ON "prevention_template_deviations" USING btree ("template_code","entry_id");--> statement-breakpoint
CREATE INDEX "prevention_template_deviation_code_idx" ON "prevention_template_deviations" USING btree ("template_code","is_active");--> statement-breakpoint

-- ── Backfill del catálogo por plantilla al maestro ────────────────────────
-- Idempotente: los ids se derivan por md5 del texto, así que reejecutar no
-- duplica. El invariante que debe sostenerse es que la gravedad EFECTIVA de
-- cada instrumento no cambie.

-- 1) El maestro: una entrada por etiqueta distinta. Si dos instrumentos usan
--    la misma etiqueta con gravedades distintas, gana la más severa — el valor
--    por defecto que heredarán las selecciones futuras conviene conservador, y
--    la gravedad original de cada instrumento se preserva igual como override
--    en el paso 2.
INSERT INTO prevention_deviation_catalog
  (id, label, dano_potencial, is_active, created_by_user_id, created_at, updated_at)
SELECT
  'devcat-' || substr(md5(o.label), 1, 16),
  o.label,
  (ARRAY['leve', 'moderado', 'grave', 'fatal'])[
    MAX(CASE o.dano_potencial
          WHEN 'leve' THEN 1 WHEN 'moderado' THEN 2
          WHEN 'grave' THEN 3 WHEN 'fatal' THEN 4 END)],
  bool_or(o.is_active),
  MIN(o.created_by_user_id),
  MIN(o.created_at),
  now()
FROM prevention_inspection_deviation_catalog o
GROUP BY o.label
ON CONFLICT (label) DO NOTHING;
--> statement-breakpoint

-- 2) La selección, atada al CÓDIGO del instrumento. Dos versiones del mismo
--    código pueden tener catálogo cada una y el índice único las rechazaría:
--    DISTINCT ON se queda con la de la versión vigente.
INSERT INTO prevention_template_deviations
  (id, template_code, entry_id, dano_potencial_override, is_active, created_by_user_id, created_at, updated_at)
SELECT
  'devsel-' || substr(md5(x.code || '|' || x.label), 1, 16),
  x.code,
  m.id,
  CASE WHEN x.dano_potencial = m.dano_potencial THEN NULL ELSE x.dano_potencial END,
  x.is_active,
  x.created_by_user_id,
  x.created_at,
  now()
FROM (
  SELECT DISTINCT ON (t.code, o.label)
    t.code, o.label, o.dano_potencial, o.is_active, o.created_by_user_id, o.created_at
  FROM prevention_inspection_deviation_catalog o
  JOIN prevention_inspection_templates t ON t.id = o.template_id
  ORDER BY t.code, o.label,
    CASE t.status WHEN 'approved' THEN 0 WHEN 'draft' THEN 1 ELSE 2 END,
    t.version DESC
) x
JOIN prevention_deviation_catalog m ON m.label = x.label
ON CONFLICT (template_code, entry_id) DO NOTHING;
--> statement-breakpoint

-- 3) Los hallazgos ya levantados pasan a referenciar el maestro. Su
--    dano_potencial y su criticality no se tocan: son la evidencia de por qué
--    la CAPA tuvo el plazo que tuvo.
UPDATE prevention_inspection_findings f
SET catalog_entry_id = m.id
FROM prevention_inspection_deviation_catalog o
JOIN prevention_deviation_catalog m ON m.label = o.label
WHERE f.catalog_entry_id = o.id;
--> statement-breakpoint

-- 4) Red de seguridad antes de crear la FK: una referencia que no resuelva
--    queda en NULL, que es exactamente "se registró fuera de catálogo". El
--    texto y la gravedad del hallazgo se conservan y la desviación aparece en
--    la cola por clasificar.
UPDATE prevention_inspection_findings f
SET catalog_entry_id = NULL
WHERE f.catalog_entry_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM prevention_deviation_catalog m WHERE m.id = f.catalog_entry_id
  );
--> statement-breakpoint

ALTER TABLE "prevention_inspection_findings" ADD CONSTRAINT "insfnd_catalog_entry_fk" FOREIGN KEY ("catalog_entry_id") REFERENCES "public"."prevention_deviation_catalog"("id") ON DELETE set null ON UPDATE no action;
