ALTER TABLE "purchase_request_items" DROP CONSTRAINT "purchase_request_items_state_valid";--> statement-breakpoint
ALTER TABLE "receipt_items" DROP CONSTRAINT "receipt_items_quantities_valid";--> statement-breakpoint
ALTER TABLE "dispatch_guides" DROP CONSTRAINT "dispatch_guides_status_valid";--> statement-breakpoint
ALTER TABLE "dispatch_guides" DROP CONSTRAINT "dispatch_guides_dispatch_stamp_valid";--> statement-breakpoint
ALTER TABLE "dispatch_guides" DROP CONSTRAINT "dispatch_guides_receipt_stamp_valid";--> statement-breakpoint
ALTER TABLE "receipt_items" ADD COLUMN "quantity_difference" real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "dispatch_guide_items" ADD COLUMN "purchase_order_item_id" text;--> statement-breakpoint
ALTER TABLE "dispatch_guide_items" ADD COLUMN "receipt_item_id" text;--> statement-breakpoint
ALTER TABLE "dispatch_guide_items" ADD COLUMN "quantity_received" real;--> statement-breakpoint
ALTER TABLE "dispatch_guide_items" ADD COLUMN "difference_reason" text;--> statement-breakpoint
ALTER TABLE "dispatch_guides" ADD COLUMN "purchase_order_id" text;--> statement-breakpoint
ALTER TABLE "dispatch_guides" ADD COLUMN "receipt_id" text;--> statement-breakpoint
ALTER TABLE "dispatch_guide_items" ADD CONSTRAINT "dispatch_guide_items_purchase_order_item_id_purchase_order_items_id_fk" FOREIGN KEY ("purchase_order_item_id") REFERENCES "public"."purchase_order_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatch_guide_items" ADD CONSTRAINT "dispatch_guide_items_receipt_item_id_receipt_items_id_fk" FOREIGN KEY ("receipt_item_id") REFERENCES "public"."receipt_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatch_guides" ADD CONSTRAINT "dispatch_guides_purchase_order_id_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatch_guides" ADD CONSTRAINT "dispatch_guides_receipt_id_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."receipts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dispatch_guide_items_po_item_idx" ON "dispatch_guide_items" USING btree ("purchase_order_item_id");--> statement-breakpoint
CREATE INDEX "dispatch_guide_items_receipt_item_idx" ON "dispatch_guide_items" USING btree ("receipt_item_id");--> statement-breakpoint
CREATE INDEX "dispatch_guides_purchase_order_idx" ON "dispatch_guides" USING btree ("purchase_order_id");--> statement-breakpoint
CREATE INDEX "dispatch_guides_receipt_idx" ON "dispatch_guides" USING btree ("receipt_id");--> statement-breakpoint
ALTER TABLE "purchase_request_items" ADD CONSTRAINT "purchase_request_items_state_valid" CHECK (
    "purchase_request_items"."status" IN (
      'draft', 'requested', 'approved', 'rejected',
      'pending_purchase', 'in_purchase_order', 'purchased',
      'partially_office_received', 'office_received', 'partially_received',
      'received', 'partially_delivered', 'delivered'
    )
    AND ("purchase_request_items"."urgency" IS NULL OR "purchase_request_items"."urgency" IN ('normal', 'high', 'critical'))
  );--> statement-breakpoint
ALTER TABLE "receipt_items" ADD CONSTRAINT "receipt_items_quantities_valid" CHECK (
    "receipt_items"."quantity_received" >= 0
    AND "receipt_items"."quantity_rejected" >= 0
    AND "receipt_items"."quantity_damaged" >= 0
    AND "receipt_items"."quantity_difference" >= 0
    AND ("receipt_items"."quantity_received" + "receipt_items"."quantity_rejected" + "receipt_items"."quantity_damaged" + "receipt_items"."quantity_difference") > 0
  );--> statement-breakpoint
ALTER TABLE "dispatch_guides" ADD CONSTRAINT "dispatch_guides_status_valid" CHECK (
    "dispatch_guides"."status" IN ('draft', 'dispatched', 'partially_received', 'received', 'cancelled')
  );--> statement-breakpoint
ALTER TABLE "dispatch_guides" ADD CONSTRAINT "dispatch_guides_dispatch_stamp_valid" CHECK (
    ("dispatch_guides"."status" = 'draft' AND "dispatch_guides"."dispatched_at" IS NULL AND "dispatch_guides"."dispatched_by" IS NULL)
    OR ("dispatch_guides"."status" IN ('dispatched', 'partially_received', 'received') AND "dispatch_guides"."dispatched_at" IS NOT NULL AND "dispatch_guides"."dispatched_by" IS NOT NULL)
    OR "dispatch_guides"."status" = 'cancelled'
  );--> statement-breakpoint
ALTER TABLE "dispatch_guides" ADD CONSTRAINT "dispatch_guides_receipt_stamp_valid" CHECK (
    ("dispatch_guides"."status" IN ('partially_received', 'received') AND "dispatch_guides"."received_at" IS NOT NULL AND "dispatch_guides"."received_by" IS NOT NULL)
    OR ("dispatch_guides"."status" IN ('draft', 'dispatched') AND "dispatch_guides"."received_at" IS NULL AND "dispatch_guides"."received_by" IS NULL)
    OR "dispatch_guides"."status" = 'cancelled'
  );