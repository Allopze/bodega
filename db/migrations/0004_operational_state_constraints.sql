ALTER TABLE "purchase_requests"
ADD CONSTRAINT "purchase_requests_type_urgency_status_valid"
CHECK (
  "request_type" IN ('epp', 'stock', 'mantencion', 'otro')
  AND "urgency" IN ('normal', 'high', 'critical')
  AND "status" IN (
    'draft', 'submitted', 'in_review', 'partially_approved', 'approved',
    'rejected', 'returned', 'in_purchasing', 'closed', 'cancelled'
  )
);
--> statement-breakpoint
ALTER TABLE "purchase_request_items"
ADD CONSTRAINT "purchase_request_items_state_valid"
CHECK (
  "status" IN (
    'draft', 'requested', 'approved', 'rejected', 'returned', 'postponed',
    'pending_purchase', 'in_purchase_order', 'purchased',
    'partially_received', 'received', 'partially_delivered', 'delivered'
  )
  AND ("urgency" IS NULL OR "urgency" IN ('normal', 'high', 'critical'))
);
--> statement-breakpoint
ALTER TABLE "approval_decisions"
ADD CONSTRAINT "approval_decisions_type_valid"
CHECK ("type" IN ('approve', 'reject', 'return', 'modify'));
--> statement-breakpoint
ALTER TABLE "purchase_orders"
ADD CONSTRAINT "purchase_orders_status_valid"
CHECK (
  "status" IN (
    'draft', 'issued', 'sent', 'supplier_confirmed',
    'partially_office_received', 'office_received',
    'partially_received', 'received', 'closed', 'cancelled'
  )
);
--> statement-breakpoint
ALTER TABLE "purchase_order_items"
ADD CONSTRAINT "purchase_order_items_status_valid"
CHECK ("status" IN ('issued', 'partially_received', 'received', 'cancelled'));
--> statement-breakpoint
ALTER TABLE "receipts"
ADD CONSTRAINT "receipts_location_status_valid"
CHECK (
  "location_type" IN ('office', 'faena')
  AND "status" IN ('open', 'closed')
);
--> statement-breakpoint
ALTER TABLE "receipt_items"
ADD CONSTRAINT "receipt_items_status_valid"
CHECK ("status" IN ('received', 'partially_received', 'rejected', 'damaged', 'pending'));
--> statement-breakpoint
ALTER TABLE "deliveries"
ADD CONSTRAINT "deliveries_destination_type_valid"
CHECK ("destination_type" IN ('faena', 'worker'));
--> statement-breakpoint
ALTER TABLE "inventory_movements"
ADD CONSTRAINT "inventory_movements_type_valid"
CHECK ("type" IN ('ingreso_oc', 'egreso_entrega', 'ingreso_devolucion'));
--> statement-breakpoint
