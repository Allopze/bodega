-- Simplificación del flujo de adquisiciones (2026-08-07).
--
-- El ciclo pasa a ser lineal: crear → aprobar/rechazar → emitir y enviar la OC →
-- recibir (oficina → faena). Con eso desaparecen tres cosas del flujo vivo:
--   * el borrador de las solicitudes de EPP/otro (ahora nacen enviadas),
--   * "devolver al solicitante" y "postergar" un ítem,
--   * el estado intermedio 'issued' de la OC (emitir y enviar es un solo acto).
--
-- Esta migración deja la base sin filas en los estados retirados y estrecha los
-- CHECK para que ninguna escritura futura pueda volver a producirlos. Va en el
-- mismo release que el código que elimina a sus productores; todos los UPDATE
-- son idempotentes y dejan traza en status_history.

-- 1) Ítems devueltos → vuelven a la cola de aprobación.
INSERT INTO "status_history" ("id", "entity_type", "entity_id", "from_status", "to_status", "changed_by", "reason")
SELECT 'sh-simpl-ret-' || "id", 'request_item', "id", 'returned', 'requested', NULL,
  'Simplificación del flujo: "devolver al solicitante" se retiró; el ítem vuelve a la cola de aprobación.'
FROM "purchase_request_items" WHERE "status" = 'returned';--> statement-breakpoint

UPDATE "purchase_request_items" SET "status" = 'requested', "updated_at" = now() WHERE "status" = 'returned';--> statement-breakpoint

-- 2) Ítems postergados → pendientes de compra (la transición que ya hacía "reanudar").
INSERT INTO "status_history" ("id", "entity_type", "entity_id", "from_status", "to_status", "changed_by", "reason")
SELECT 'sh-simpl-post-' || "id", 'request_item', "id", 'postponed', 'pending_purchase', NULL,
  'Simplificación del flujo: "postergar" se retiró; el ítem vuelve al consolidado de compra.'
FROM "purchase_request_items" WHERE "status" = 'postponed';--> statement-breakpoint

UPDATE "purchase_request_items" SET "status" = 'pending_purchase', "updated_at" = now() WHERE "status" = 'postponed';--> statement-breakpoint

-- 3) Borradores de EPP/otro sin ítems → cancelados. No se pueden enviar (falta el
--    mínimo de un ítem) y el flujo nuevo ya no sabe editarlos.
INSERT INTO "status_history" ("id", "entity_type", "entity_id", "from_status", "to_status", "changed_by", "reason")
SELECT 'sh-simpl-empty-' || r."id", 'purchase_request', r."id", 'draft', 'cancelled', NULL,
  'Simplificación del flujo: el borrador quedó sin ítems y las solicitudes ya no se guardan en borrador.'
FROM "purchase_requests" r
WHERE r."status" = 'draft' AND r."request_type" IN ('epp', 'otro')
  AND NOT EXISTS (SELECT 1 FROM "purchase_request_items" i WHERE i."request_id" = r."id");--> statement-breakpoint

UPDATE "purchase_requests" r SET "status" = 'cancelled', "closed_at" = now()::text, "updated_at" = now()
WHERE r."status" = 'draft' AND r."request_type" IN ('epp', 'otro')
  AND NOT EXISTS (SELECT 1 FROM "purchase_request_items" i WHERE i."request_id" = r."id");--> statement-breakpoint

-- 4) Los borradores con ítems se envían tal cual, así que necesitan fecha
--    requerida: la mínima ("lo antes posible") es hoy. Aguas abajo hay revisión
--    humana en aprobaciones, que puede ajustar o rechazar.
UPDATE "purchase_requests" r SET "required_date" = to_char(now(), 'YYYY-MM-DD'), "updated_at" = now()
WHERE r."status" = 'draft' AND r."request_type" IN ('epp', 'otro') AND r."required_date" IS NULL
  AND EXISTS (SELECT 1 FROM "purchase_request_items" i WHERE i."request_id" = r."id");--> statement-breakpoint

UPDATE "purchase_request_items" i SET "required_date" = r."required_date", "updated_at" = now()
FROM "purchase_requests" r
WHERE i."request_id" = r."id" AND i."required_date" IS NULL
  AND r."status" = 'draft' AND r."request_type" IN ('epp', 'otro');--> statement-breakpoint

-- 5) Auto-envío de los borradores EPP/otro con ítems (incluye los que generaba la
--    reposición automática de EPP, que ahora sólo sugiere).
INSERT INTO "status_history" ("id", "entity_type", "entity_id", "from_status", "to_status", "changed_by", "reason")
SELECT 'sh-simpl-sub-' || r."id", 'purchase_request', r."id", 'draft', 'submitted', NULL,
  'Simplificación del flujo: las solicitudes de EPP y otros se crean ya enviadas a aprobación.'
FROM "purchase_requests" r
WHERE r."status" = 'draft' AND r."request_type" IN ('epp', 'otro')
  AND EXISTS (SELECT 1 FROM "purchase_request_items" i WHERE i."request_id" = r."id");--> statement-breakpoint

INSERT INTO "status_history" ("id", "entity_type", "entity_id", "from_status", "to_status", "changed_by", "reason")
SELECT 'sh-simpl-subi-' || i."id", 'request_item', i."id", 'draft', 'requested', NULL,
  'Simplificación del flujo: la solicitud pasó automáticamente a aprobación.'
FROM "purchase_request_items" i
JOIN "purchase_requests" r ON r."id" = i."request_id"
WHERE i."status" = 'draft' AND r."status" = 'draft' AND r."request_type" IN ('epp', 'otro');--> statement-breakpoint

UPDATE "purchase_request_items" i SET "status" = 'requested', "updated_at" = now()
FROM "purchase_requests" r
WHERE i."request_id" = r."id" AND i."status" = 'draft'
  AND r."status" = 'draft' AND r."request_type" IN ('epp', 'otro');--> statement-breakpoint

UPDATE "purchase_requests" r SET "status" = 'submitted', "submitted_at" = now()::text, "updated_at" = now()
WHERE r."status" = 'draft' AND r."request_type" IN ('epp', 'otro')
  AND EXISTS (SELECT 1 FROM "purchase_request_items" i WHERE i."request_id" = r."id");--> statement-breakpoint

-- 6) Recalcula el estado padre de las solicitudes que tocaron (1) y (2),
--    replicando el orden de precedencia de rollupRequestStatus.
UPDATE "purchase_requests" r SET "status" = 'in_review', "updated_at" = now()
WHERE r."status" = 'returned'
  AND EXISTS (SELECT 1 FROM "purchase_request_items" i WHERE i."request_id" = r."id" AND i."status" = 'requested');--> statement-breakpoint

UPDATE "purchase_requests" r SET "status" = 'in_purchasing', "closed_at" = NULL, "updated_at" = now()
WHERE r."status" = 'closed'
  AND EXISTS (SELECT 1 FROM "purchase_request_items" i WHERE i."request_id" = r."id"
    AND i."status" IN ('in_purchase_order', 'purchased', 'partially_received', 'received', 'partially_delivered'));--> statement-breakpoint

UPDATE "purchase_requests" r SET "status" = 'approved', "closed_at" = NULL, "updated_at" = now()
WHERE r."status" = 'closed'
  AND EXISTS (SELECT 1 FROM "purchase_request_items" i WHERE i."request_id" = r."id" AND i."status" = 'pending_purchase');--> statement-breakpoint

-- 7) OC emitidas pero no enviadas → vuelven a borrador. Marcarlas como enviadas
--    fabricaría un envío al proveedor que nunca ocurrió; sus ítems no cambian
--    (siguen 'in_purchase_order' igual que en borrador) y basta con que alguien
--    pulse el nuevo "Emitir y enviar".
INSERT INTO "status_history" ("id", "entity_type", "entity_id", "from_status", "to_status", "changed_by", "reason")
SELECT 'sh-simpl-oc-' || "id", 'purchase_order', "id", 'issued', 'draft', NULL,
  'Simplificación del flujo: emitir y enviar pasó a ser un solo acto; la orden vuelve a borrador hasta enviarse.'
FROM "purchase_orders" WHERE "status" = 'issued';--> statement-breakpoint

UPDATE "purchase_orders" SET "status" = 'draft', "issued_at" = NULL, "issued_by" = NULL, "sent_at" = NULL, "confirmed_at" = NULL, "updated_at" = now()
WHERE "status" = 'issued';--> statement-breakpoint

-- 8) Los CHECK se estrechan una vez que no queda ninguna fila en los estados retirados.
ALTER TABLE "purchase_request_items" DROP CONSTRAINT "purchase_request_items_state_valid";--> statement-breakpoint

ALTER TABLE "purchase_request_items" ADD CONSTRAINT "purchase_request_items_state_valid" CHECK ("purchase_request_items"."status" IN (
      'draft', 'requested', 'approved', 'rejected',
      'pending_purchase', 'in_purchase_order', 'purchased',
      'partially_received', 'received', 'partially_delivered', 'delivered'
    )
    AND ("purchase_request_items"."urgency" IS NULL OR "purchase_request_items"."urgency" IN ('normal', 'high', 'critical')));--> statement-breakpoint

ALTER TABLE "purchase_orders" DROP CONSTRAINT "purchase_orders_status_valid";--> statement-breakpoint

ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_status_valid" CHECK ("purchase_orders"."status" IN (
      'draft', 'sent',
      'partially_office_received', 'office_received',
      'partially_received', 'received', 'closed', 'cancelled'
    ));
