-- I-03 (auditoría UI/UX Inspecciones 2026-08-25): EPP (JT) y EPP (PRF) son dos
-- instrumentos de roles distintos, no dos versiones del mismo. Compartían
-- `code`, así que `supersedePreviousApproved` retiraba uno al aprobar el
-- otro. El `code` pasa a llevar el sufijo de variante; `source_definition_code`
-- sigue siendo 'inspeccion_epp' (drift-detection y linaje de la definición no
-- se tocan). Sólo datos, sin cambio de esquema; idempotente.
UPDATE "prevention_inspection_templates"
SET "code" = 'inspeccion_epp_jt', "updated_at" = now()
WHERE "source_definition_code" = 'inspeccion_epp' AND "version_label" LIKE '%-jt' AND "code" = 'inspeccion_epp';
--> statement-breakpoint
UPDATE "prevention_inspection_templates"
SET "code" = 'inspeccion_epp_prf', "updated_at" = now()
WHERE "source_definition_code" = 'inspeccion_epp' AND "version_label" LIKE '%-prf' AND "code" = 'inspeccion_epp';
--> statement-breakpoint
-- Deshacer el reemplazo espurio: una fila EPP quedó 'superseded' apuntando a
-- otra fila EPP con `code` ya distinto (tras los dos UPDATE de arriba), es
-- decir, fue retirada por OTRO instrumento, no por una versión propia. Sólo se
-- reactiva si conserva su aprobación original (el CHECK
-- prevention_inspection_template_approved_consistent lo exige).
UPDATE "prevention_inspection_templates" t
SET "status" = 'approved',
    "superseded_at" = NULL,
    "superseded_by_template_id" = NULL,
    "version" = t."version" + 1,
    "updated_at" = now()
WHERE t."source_definition_code" = 'inspeccion_epp'
  AND t."status" = 'superseded'
  AND t."approved_at" IS NOT NULL
  AND t."approved_by_user_id" IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM "prevention_inspection_templates" s
    WHERE s."id" = t."superseded_by_template_id"
      AND s."source_definition_code" = 'inspeccion_epp'
      AND s."code" <> t."code"
  );
