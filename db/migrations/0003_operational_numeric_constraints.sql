ALTER TABLE "purchase_request_items"
ADD CONSTRAINT "purchase_request_items_quantity_positive"
CHECK ("quantity" > 0);
--> statement-breakpoint
ALTER TABLE "approval_decisions"
ADD CONSTRAINT "approval_decisions_modified_qty_positive"
CHECK ("modified_qty" IS NULL OR "modified_qty" > 0);
--> statement-breakpoint
ALTER TABLE "purchase_orders"
ADD CONSTRAINT "purchase_orders_amounts_non_negative"
CHECK (
  "net_amount" >= 0
  AND "tax_amount" >= 0
  AND "total_amount" >= 0
);
--> statement-breakpoint
ALTER TABLE "purchase_order_items"
ADD CONSTRAINT "purchase_order_items_numeric_integrity"
CHECK (
  "quantity" > 0
  AND "unit_price" >= 0
  AND "discount" >= 0
  AND "discount" <= 100
  AND "subtotal" >= 0
  AND "quantity_office_received" >= 0
  AND "quantity_received" >= 0
  AND "quantity_office_received" <= "quantity"
  AND "quantity_received" <= "quantity_office_received"
);
--> statement-breakpoint
ALTER TABLE "receipt_items"
ADD CONSTRAINT "receipt_items_quantities_valid"
CHECK (
  "quantity_received" > 0
  AND "quantity_rejected" >= 0
  AND "quantity_damaged" >= 0
);
--> statement-breakpoint
ALTER TABLE "delivery_items"
ADD CONSTRAINT "delivery_items_quantity_positive"
CHECK ("quantity" > 0);
--> statement-breakpoint
ALTER TABLE "worksite_stock"
ADD CONSTRAINT "worksite_stock_min_stock_non_negative"
CHECK ("min_stock" >= 0);
--> statement-breakpoint
ALTER TABLE "inventory_movements"
ADD CONSTRAINT "inventory_movements_stock_non_negative"
CHECK (
  "stock_before" >= 0
  AND "stock_after" >= 0
);
--> statement-breakpoint
