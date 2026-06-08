ALTER TABLE `purchase_request_items` ADD `suggested_supplier_id` text REFERENCES suppliers(id);--> statement-breakpoint
ALTER TABLE `purchase_request_items` ADD `supplier_hint` text;--> statement-breakpoint
ALTER TABLE `purchase_requests` ADD `request_type` text DEFAULT 'epp' NOT NULL;