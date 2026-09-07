ALTER TABLE "it_checklist_tasks" ADD COLUMN "position" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "it_checklist_tasks_order_idx" ON "it_checklist_tasks" USING btree ("checklist_id","position");--> statement-breakpoint
-- Backfill del orden de tareas de checklist TI. Las tareas se instancian desde
-- las plantillas de `lib/services/ti/constants.ts`, así que el nombre determina
-- su posición en la secuencia. Idempotente: reasigna siempre el mismo valor y
-- los nombres de ambas plantillas no se solapan.
UPDATE "it_checklist_tasks" SET "position" = v."position"
FROM (VALUES
  ('Crear correo corporativo', 0),
  ('Crear accesos correspondientes', 1),
  ('Entregar notebook', 2),
  ('Entregar teléfono', 3),
  ('Asignar licencias', 4),
  ('Configurar aplicaciones', 5),
  ('Entregar accesorios', 6),
  ('Bloquear correo corporativo', 0),
  ('Revocar accesos', 1),
  ('Quitar VPN', 2),
  ('Recuperar notebook', 3),
  ('Recuperar celular', 4),
  ('Recuperar accesorios', 5),
  ('Respaldar o transferir información', 6),
  ('Cerrar licencias asignadas', 7)
) AS v("name", "position")
WHERE "it_checklist_tasks"."name" = v."name";
