ALTER TABLE "purchase_order_items" DROP CONSTRAINT "purchase_order_items_numeric_integrity";--> statement-breakpoint
ALTER TABLE "purchase_requests" ADD COLUMN "delivery_mode" text DEFAULT 'via_oficina' NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "delivery_mode" text DEFAULT 'via_oficina' NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_delivery_mode_valid" CHECK (
    "purchase_requests"."delivery_mode" IN ('via_oficina', 'directo_faena')
  );--> statement-breakpoint
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_numeric_integrity" CHECK (
    "purchase_order_items"."quantity" > 0
    AND "purchase_order_items"."unit_price" >= 0
    AND "purchase_order_items"."discount" >= 0
    AND "purchase_order_items"."discount" <= 100
    AND "purchase_order_items"."subtotal" >= 0
    AND "purchase_order_items"."quantity_office_received" >= 0
    AND "purchase_order_items"."quantity_received" >= 0
    AND "purchase_order_items"."quantity_office_received" <= "purchase_order_items"."quantity"
    AND "purchase_order_items"."quantity_received" <= "purchase_order_items"."quantity"
  );--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_delivery_mode_valid" CHECK (
    "purchase_orders"."delivery_mode" IN ('via_oficina', 'directo_faena')
  );