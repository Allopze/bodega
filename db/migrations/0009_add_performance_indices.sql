CREATE INDEX "purchase_orders_worksite_status_idx" ON "purchase_orders" ("worksite_id", "status", "created_at");--> statement-breakpoint
CREATE INDEX "purchase_orders_status_sent_idx" ON "purchase_orders" ("status", "sent_at");--> statement-breakpoint
CREATE INDEX "audit_log_created_at_idx" ON "audit_log" ("created_at");--> statement-breakpoint
CREATE INDEX "audit_log_entity_idx" ON "audit_log" ("entity_type", "entity_id");--> statement-breakpoint
CREATE INDEX "status_history_entity_idx" ON "status_history" ("entity_type", "entity_id", "changed_at");--> statement-breakpoint
CREATE INDEX "notifications_user_read_idx" ON "notifications" ("user_id", "is_read", "created_at");
