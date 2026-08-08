CREATE INDEX "idx_approval_decisions_request" ON "approval_decisions" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "repuesto_quotations_request_id_idx" ON "repuesto_quotations" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "service_quotations_request_id_idx" ON "service_quotations" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "purchase_order_items_purchase_order_id_idx" ON "purchase_order_items" USING btree ("purchase_order_id");--> statement-breakpoint
CREATE INDEX "purchase_order_items_request_item_id_idx" ON "purchase_order_items" USING btree ("request_item_id");--> statement-breakpoint
CREATE INDEX "quotations_purchase_order_id_idx" ON "quotations" USING btree ("purchase_order_id");--> statement-breakpoint
CREATE INDEX "idx_delivery_items_delivery" ON "delivery_items" USING btree ("delivery_id");--> statement-breakpoint
CREATE INDEX "idx_receipt_items_receipt" ON "receipt_items" USING btree ("receipt_id");