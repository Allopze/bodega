-- ─────────────────────────────────────────────────────────────────────────────
-- LEGAL-02: una sola versión publicada por código de requisito.
--
-- Hasta ahora la supersesión sólo ocurría si el borrador se había creado desde
-- `sourceRequirementId`, campo que el formulario nunca envía: publicar la v2 de
-- un artículo dejaba la v1 vigente y el registro afirmaba dos textos
-- contradictorios para la misma obligación.
--
-- El índice parcial no puede crearse sobre datos que ya lo violan, así que
-- primero se sanea: por cada código con más de una versión publicada se
-- conserva la más reciente (`requirement_version` mayor) y el resto pasa a
-- `superseded`, cerrando su vigencia en la fecha de entrada en vigor de la que
-- queda. El saneo queda auditado en `prevention_risk_legal_history` — en un
-- registro legal un cambio de estado sin traza no sirve de nada.
--
-- Idempotente: si no hay duplicados el UPDATE no toca ninguna fila, el id de
-- historial es determinista y el índice se crea con IF NOT EXISTS.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO "prevention_risk_legal_history" (
  "id", "domain", "entity_type", "entity_id", "change_type", "reason", "before_state", "after_state"
)
SELECT 'prlh-legal02-' || p."id",
       'legal',
       'requirement',
       p."id",
       'superseded',
       'Saneo LEGAL-02: sólo puede haber una versión publicada por código; reemplazado por ' || w."id" || '.',
       jsonb_build_object('status', 'published', 'version', p."version", 'valid_to', p."valid_to"),
       jsonb_build_object('status', 'superseded', 'version', p."version" + 1, 'valid_to', COALESCE(p."valid_to", w."valid_from"), 'supersededByRequirementId', w."id")
  FROM (
    SELECT "id", "code", "version", "valid_to",
           row_number() OVER (PARTITION BY "code" ORDER BY "requirement_version" DESC, "published_at" DESC NULLS LAST, "id" DESC) AS rn
      FROM "prevention_legal_requirements"
     WHERE "status" = 'published'
  ) p
  JOIN (
    SELECT "id", "code", "valid_from",
           row_number() OVER (PARTITION BY "code" ORDER BY "requirement_version" DESC, "published_at" DESC NULLS LAST, "id" DESC) AS rn
      FROM "prevention_legal_requirements"
     WHERE "status" = 'published'
  ) w ON w."code" = p."code" AND w.rn = 1
 WHERE p.rn > 1
ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint
UPDATE "prevention_legal_requirements" r
   SET "status" = 'superseded',
       "valid_to" = COALESCE(r."valid_to", w."valid_from"),
       "version" = r."version" + 1,
       "updated_at" = now()
  FROM (
    SELECT "id", "code",
           row_number() OVER (PARTITION BY "code" ORDER BY "requirement_version" DESC, "published_at" DESC NULLS LAST, "id" DESC) AS rn
      FROM "prevention_legal_requirements"
     WHERE "status" = 'published'
  ) p
  JOIN (
    SELECT "code", "valid_from",
           row_number() OVER (PARTITION BY "code" ORDER BY "requirement_version" DESC, "published_at" DESC NULLS LAST, "id" DESC) AS rn
      FROM "prevention_legal_requirements"
     WHERE "status" = 'published'
  ) w ON w."code" = p."code" AND w.rn = 1
 WHERE r."id" = p."id" AND p.rn > 1;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "prevention_legal_requirements_one_published_code_unique" ON "prevention_legal_requirements" USING btree ("code") WHERE "prevention_legal_requirements"."status" = 'published';
