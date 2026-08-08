-- Saneo one-shot (LOG-1/DAT-7): antes de este release nada escribía
-- `resolved_at`, así que una brecha de reposición EPP quedaba suprimida para
-- siempre en cuanto su ítem se rechazaba, se cancelaba o se borraba. Libera
-- las reservas abiertas cuyo ítem ya está muerto; el código nuevo evita que
-- vuelva a pasar (`resolveReplenishmentLinksTx`).
UPDATE "epp_replenishment_links" l
SET "resolved_at" = now()
WHERE l."resolved_at" IS NULL
  AND (
    l."request_item_id" IS NULL
    OR EXISTS (
      SELECT 1 FROM "purchase_request_items" i
      WHERE i."id" = l."request_item_id" AND i."status" = 'rejected'
    )
  );
