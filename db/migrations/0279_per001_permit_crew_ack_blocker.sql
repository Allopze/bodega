-- PER-001 — El acuse del AST por la cuadrilla pasa a ser bloqueador de activación,
-- configurable por tipo de permiso. Antes el acuse era opcional: un permiso se
-- activaba con cero acuses registrados.
ALTER TABLE "prevention_permit_types"
  ADD COLUMN IF NOT EXISTS "requires_crew_acknowledgement" boolean NOT NULL DEFAULT true;
--> statement-breakpoint
-- Respaldo conservador de las filas ya existentes: exigir el acuse del AST sólo
-- donde el tipo ya exigía un AST. Los tipos nuevos nacen con el valor por
-- defecto (true) y el formulario del catálogo permite bajarlo.
UPDATE "prevention_permit_types"
   SET "requires_crew_acknowledgement" = "requires_jsa";
