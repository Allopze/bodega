ALTER TABLE "receipt_items" DROP CONSTRAINT "receipt_items_quantities_valid";--> statement-breakpoint
ALTER TABLE "receipt_items" ADD CONSTRAINT "receipt_items_quantities_valid" CHECK (
    "receipt_items"."quantity_received" >= 0
    AND "receipt_items"."quantity_rejected" >= 0
    AND "receipt_items"."quantity_damaged" >= 0
    AND ("receipt_items"."quantity_received" + "receipt_items"."quantity_rejected" + "receipt_items"."quantity_damaged") > 0
  );