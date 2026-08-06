-- Responsables PDTP: cargos en vez de siglas/áreas, y rol propio para SUP,
-- Gerencia Legal y RRHH y Subgerencia de operaciones.
--
-- Dos arreglos en uno:
--   1. El catálogo nombraba áreas ("Jefatura de terreno") en vez del cargo de la
--      persona ("Jefe de terreno"), y tres responsables apuntaban a un rol ajeno
--      (sup -> jefe_terreno; gerente_legal_rrhh y subgerente_operaciones ->
--      jefa_chome), así que no se podía asignar un usuario al responsable real.
--   2. `pdtp_activities.responsible_display` está denormalizado y el importador
--      lo guardaba con la sigla cruda de la planilla ("PRF", "Sup, JT"), sin
--      pasar por `displayNameForActivity`. Se corrigió en imports.ts; aquí se
--      reconstruye la columna desde `responsible_slugs` contra el catálogo, que
--      es justo lo que produce ese helper.

-- 1. Catálogo: nombre visible y rol del sistema.
UPDATE "pdtp_responsible_catalog" SET "display_name" = 'Jefe del Departamento de Prevención de Riesgos' WHERE "slug" = 'jdpr';--> statement-breakpoint
UPDATE "pdtp_responsible_catalog" SET "display_name" = 'Jefe de terreno'            WHERE "slug" = 'jt';--> statement-breakpoint
UPDATE "pdtp_responsible_catalog" SET "display_name" = 'Jefe de mantención'         WHERE "slug" = 'jm';--> statement-breakpoint
UPDATE "pdtp_responsible_catalog" SET "display_name" = 'Administrador de contrato'  WHERE "slug" = 'admin_contrato';--> statement-breakpoint
UPDATE "pdtp_responsible_catalog" SET "display_name" = 'Supervisor',                "role_name" = 'supervisor'              WHERE "slug" = 'sup';--> statement-breakpoint
UPDATE "pdtp_responsible_catalog" SET "display_name" = 'Subgerente de operaciones', "role_name" = 'subgerente_operaciones' WHERE "slug" = 'subgerente_operaciones';--> statement-breakpoint
UPDATE "pdtp_responsible_catalog" SET "role_name" = 'gerente_legal_rrhh'            WHERE "slug" = 'gerente_legal_rrhh';--> statement-breakpoint

-- 2. Alcance por defecto de las hojas que ganaron un rol propio.
UPDATE "pdtp_sheets" SET "default_scope_roles" = '["supervisor", "jefe_terreno"]'::jsonb              WHERE "code" = 'sup_jt';--> statement-breakpoint
UPDATE "pdtp_sheets" SET "default_scope_roles" = '["subgerente_operaciones", "jefa_chome"]'::jsonb    WHERE "code" = 'subgerente';--> statement-breakpoint

-- 3. Nombre visible por actividad, reconstruido desde los slugs. Conserva el
--    orden del array y cae al valor anterior si algún slug no está en el
--    catálogo, para no dejar la columna (NOT NULL) peor de lo que estaba.
UPDATE "pdtp_activities" a
SET "responsible_display" = j."display"
FROM (
  SELECT act."id",
         string_agg(COALESCE(cat."display_name", replace(slug.value, '_', ' ')), ', ' ORDER BY slug."ordinality") AS "display"
  FROM "pdtp_activities" act
  CROSS JOIN LATERAL jsonb_array_elements_text(act."responsible_slugs") WITH ORDINALITY AS slug(value, ordinality)
  LEFT JOIN "pdtp_responsible_catalog" cat ON cat."slug" = slug.value
  GROUP BY act."id"
) j
WHERE a."id" = j."id" AND j."display" IS NOT NULL AND j."display" <> a."responsible_display";--> statement-breakpoint

-- 4. Overrides por faena (hoy vacío en producción, pero el override guarda su
--    propio display y quedaría inconsistente con el del catálogo).
UPDATE "pdtp_activity_worksite_params" p
SET "responsible_display" = j."display"
FROM (
  SELECT prm."id",
         string_agg(COALESCE(cat."display_name", replace(slug.value, '_', ' ')), ', ' ORDER BY slug."ordinality") AS "display"
  FROM "pdtp_activity_worksite_params" prm
  CROSS JOIN LATERAL jsonb_array_elements_text(prm."responsible_slugs") WITH ORDINALITY AS slug(value, ordinality)
  LEFT JOIN "pdtp_responsible_catalog" cat ON cat."slug" = slug.value
  WHERE prm."responsible_slugs" IS NOT NULL
  GROUP BY prm."id"
) j
WHERE p."id" = j."id" AND j."display" IS NOT NULL AND j."display" <> p."responsible_display";
