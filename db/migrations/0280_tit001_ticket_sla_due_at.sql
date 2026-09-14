-- TIT-001 (auditoría 2026-09-14): la prioridad de un ticket TI no gobernaba
-- ningún plazo. La columna existía y sólo servía para ordenar la lista: no
-- había vencimiento ni recordatorio por prioridad, y la única señal temporal
-- era una alerta plana a los 5 días igual para 'critica' que para 'baja'.
--
-- Se agrega el vencimiento comprometido, con la misma forma que ya usa el
-- módulo de Soporte (`feedback_reports.due_at`), para poder reutilizar el
-- patrón de recordatorios que allí ya funciona.
ALTER TABLE "it_tickets" ADD COLUMN IF NOT EXISTS "due_at" timestamp with time zone;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "it_tickets_due_at_idx" ON "it_tickets" ("due_at");
--> statement-breakpoint
-- Relleno de los tickets ya abiertos: el plazo se calcula desde su creación con
-- la misma tabla de horas por prioridad que aplica el servicio
-- (`TICKET_SLA_HOURS` en lib/services/ti/ticket-sla.ts). Los tickets ya
-- resueltos o cerrados se dejan sin plazo: inventarles uno retroactivo sólo
-- produciría vencidos falsos.
UPDATE "it_tickets"
SET "due_at" = "created_at" + (
  CASE "priority"
    WHEN 'critica' THEN interval '24 hours'
    WHEN 'alta'    THEN interval '48 hours'
    WHEN 'normal'  THEN interval '120 hours'
    ELSE                interval '240 hours'
  END
)
WHERE "due_at" IS NULL
  AND "status" NOT IN ('resuelto', 'cerrado');
