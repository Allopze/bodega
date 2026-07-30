-- Retira el estado 'supplier_confirmed' del ciclo de vida de las OC.
--
-- Ese estado dejaba la orden fuera del conjunto recibible (`registerReceipt`
-- sólo acepta sent / partially_office_received / office_received /
-- partially_received), así que una OC "confirmada por proveedor" no podía
-- registrar recepción nunca: sólo cerrarse a mano. Las filas que estén en ese
-- estado vuelven a 'sent' —el estado desde el que sí se puede recibir— y queda
-- la traza del arreglo en status_history. Después se estrecha el CHECK para que
-- ninguna escritura futura pueda volver a producirlo.
INSERT INTO "status_history" ("id", "entity_type", "entity_id", "from_status", "to_status", "changed_by", "reason")
SELECT
  'sh-retire-sconf-' || "id",
  'purchase_order',
  "id",
  'supplier_confirmed',
  'sent',
  NULL,
  'Corrección de flujo: el estado "confirmada por proveedor" se retiró porque impedía registrar la recepción.'
FROM "purchase_orders"
WHERE "status" = 'supplier_confirmed';--> statement-breakpoint

UPDATE "purchase_orders" SET "status" = 'sent', "updated_at" = now() WHERE "status" = 'supplier_confirmed';--> statement-breakpoint

ALTER TABLE "purchase_orders" DROP CONSTRAINT "purchase_orders_status_valid";--> statement-breakpoint

ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_status_valid" CHECK ("purchase_orders"."status" IN (
      'draft', 'issued', 'sent',
      'partially_office_received', 'office_received',
      'partially_received', 'received', 'closed', 'cancelled'
    ));
