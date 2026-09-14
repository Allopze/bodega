-- TIA-001 y TIA-002 (auditoría 2026-09-14).
--
-- TIA-001: el acta de entrega nacía "aceptada" y firmada por el mismo técnico
-- que la emitía (`accepted_by_user_id = delivered_by_user_id`). El documento
-- que respalda la responsabilidad del trabajador sobre un notebook registraba
-- como aceptante a quien lo entrega.
--
-- TIA-002 (patrón P7, «estados que no significan lo que dicen»): dos columnas
-- nulables no distinguían «el trabajador aceptó» de «nadie acusó recibo» ni de
-- «entrega antigua migrada». Se agrega el estado explícito del acuse.
ALTER TABLE "it_asset_assignments"
  ADD COLUMN IF NOT EXISTS "acceptance_status" text NOT NULL DEFAULT 'pendiente';
--> statement-breakpoint
ALTER TABLE "it_asset_assignments"
  ADD COLUMN IF NOT EXISTS "acceptance_note" text;
--> statement-breakpoint
-- Relleno honesto de lo que ya está en la tabla:
--  1. Acta "aceptada" por el mismo que la entregó = no hubo acuse. Se marca
--     como tal y se limpian las dos columnas que afirmaban lo contrario; el
--     motivo queda escrito para que nadie lo confunda con un dato perdido.
UPDATE "it_asset_assignments"
SET "acceptance_status" = 'sin_acuse',
    "acceptance_note" = 'Migrado (TIA-001): el acta figuraba aceptada por el mismo técnico que la entregó, de modo que no consta acuse del trabajador.',
    "accepted_at" = NULL,
    "accepted_by_user_id" = NULL
WHERE "accepted_by_user_id" IS NOT NULL
  AND "accepted_by_user_id" = "delivered_by_user_id";
--> statement-breakpoint
--  2. Acta aceptada por una persona distinta de quien entregó: acuse real.
UPDATE "it_asset_assignments"
SET "acceptance_status" = 'aceptada'
WHERE "accepted_by_user_id" IS NOT NULL;
--> statement-breakpoint
--  3. El resto queda 'pendiente' por el DEFAULT.
ALTER TABLE "it_asset_assignments"
  ADD CONSTRAINT "it_asset_assignments_acceptance_status_valid"
  CHECK ("acceptance_status" IN ('pendiente', 'aceptada', 'sin_acuse'));
--> statement-breakpoint
-- Coherencia entre el estado y sus dos columnas: sólo 'aceptada' puede tener
-- aceptante, y ninguna otra puede tenerlo. Es lo que impide que vuelva a
-- existir un acta "aceptada por nadie" o un acuse sin estado.
ALTER TABLE "it_asset_assignments"
  ADD CONSTRAINT "it_asset_assignments_acceptance_coherent"
  CHECK (
    ("acceptance_status" = 'aceptada' AND "accepted_at" IS NOT NULL AND "accepted_by_user_id" IS NOT NULL)
    OR ("acceptance_status" <> 'aceptada' AND "accepted_at" IS NULL AND "accepted_by_user_id" IS NULL)
  );
