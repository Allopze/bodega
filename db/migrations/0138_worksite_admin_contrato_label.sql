-- El cargo `admin_contrato` cambia de nombre según el contrato de cada faena:
-- "Administrador de contrato" y "Supervisor de faena" son la misma persona. El
-- título pasa a ser dato de la faena; NULL = usar el nombre por defecto.
ALTER TABLE "worksites" ADD COLUMN IF NOT EXISTS "admin_contrato_label" text;--> statement-breakpoint

-- Desambiguación del rol introducido junto a 0137: se llamaba `supervisor`,
-- pero esa palabra ya significaba "Administrador de contrato" en las firmas SST
-- (SIGNATURE_ROLE_LABELS). El responsable SUP de la planilla es el supervisor
-- de terreno, que trabaja junto al Jefe de terreno y es otra persona.
--
-- Quien crea los roles es `sync-rbac` (corre después de migrate en el deploy),
-- así que aquí solo se limpia el rol viejo. Se conserva si alguien alcanzó a
-- asignarlo a un usuario: en ese caso el borrado le quitaría el rol en silencio
-- y es preferible dejar el duplicado visible para resolverlo a mano.
DELETE FROM "roles"
WHERE "name" = 'supervisor'
  AND NOT EXISTS (SELECT 1 FROM "user_roles" ur WHERE ur."role_id" = "roles"."id");--> statement-breakpoint

UPDATE "pdtp_responsible_catalog" SET "role_name" = 'supervisor_terreno', "display_name" = 'Supervisor de terreno' WHERE "slug" = 'sup';--> statement-breakpoint

-- El nombre visible por actividad se recalcula desde el catálogo (igual que 0137).
UPDATE "pdtp_activities" a SET "responsible_display" = j."display"
FROM (
  SELECT act."id", string_agg(COALESCE(cat."display_name", replace(slug.value, '_', ' ')), ', ' ORDER BY slug."ordinality") AS "display"
  FROM "pdtp_activities" act
  CROSS JOIN LATERAL jsonb_array_elements_text(act."responsible_slugs") WITH ORDINALITY AS slug(value, ordinality)
  LEFT JOIN "pdtp_responsible_catalog" cat ON cat."slug" = slug.value
  GROUP BY act."id"
) j
WHERE a."id" = j."id" AND j."display" IS NOT NULL AND j."display" <> a."responsible_display";--> statement-breakpoint
UPDATE "pdtp_sheets" SET "default_scope_roles" = '["supervisor_terreno", "jefe_terreno"]'::jsonb WHERE "code" = 'sup_jt';
