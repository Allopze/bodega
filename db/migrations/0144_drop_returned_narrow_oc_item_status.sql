ALTER TABLE "purchase_requests" DROP CONSTRAINT "purchase_requests_type_urgency_status_valid";--> statement-breakpoint
ALTER TABLE "purchase_order_items" DROP CONSTRAINT "purchase_order_items_status_valid";--> statement-breakpoint
-- ARQ-12: backfill de datos legacy antes del CHECK más angosto. Ningún código
-- vivo escribe 'partially_received'/'received' en purchase_order_items.status
-- (la recepción se trackea con quantity_office_received/quantity_received) ni
-- los lee esperando ese valor específico (los 3 sitios que leen este status
-- sólo comprueban `<> 'cancelled'`) — son residuo de una versión anterior del
-- flujo de recepción. 'issued' preserva el único significado que el código
-- actual sí lee (línea activa, no anulada).
UPDATE "purchase_order_items" SET "status" = 'issued' WHERE "status" NOT IN ('issued', 'cancelled');--> statement-breakpoint
ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_type_urgency_status_valid" CHECK (
    "purchase_requests"."request_type" IN ('epp', 'otro', 'repuestos', 'servicios')
    AND "purchase_requests"."urgency" IN ('normal', 'high', 'critical')
    AND "purchase_requests"."status" IN (
      'draft', 'submitted', 'in_review', 'partially_approved', 'approved',
      'rejected', 'in_purchasing', 'closed', 'cancelled'
    )
  );--> statement-breakpoint
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_status_valid" CHECK (
    "purchase_order_items"."status" IN ('issued', 'cancelled')
  );