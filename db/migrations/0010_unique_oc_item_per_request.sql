-- Prevent the same request item from being in multiple active purchase orders.
-- A cancelled OC item (status = 'cancelled') is excluded, so an item can be
-- re-added to a new OC after cancellation.
CREATE UNIQUE INDEX "purchase_order_items_request_item_active"
ON "purchase_order_items" ("request_item_id")
WHERE "request_item_id" IS NOT NULL AND "status" != 'cancelled';
