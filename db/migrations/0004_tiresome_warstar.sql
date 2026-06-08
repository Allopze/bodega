CREATE INDEX `purchase_request_items_request_id_status_idx` ON `purchase_request_items` (`request_id`,`status`);--> statement-breakpoint
CREATE INDEX `purchase_requests_worksite_id_status_idx` ON `purchase_requests` (`worksite_id`,`status`);--> statement-breakpoint
CREATE INDEX `purchase_requests_requester_id_created_at_idx` ON `purchase_requests` (`requester_id`,`created_at`);