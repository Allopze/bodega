DROP TABLE `warehouse_stock`;--> statement-breakpoint
DROP TABLE `inventory_movements`;--> statement-breakpoint
DROP TABLE `warehouses`;--> statement-breakpoint
CREATE TABLE `worksite_stock` (
	`id` text PRIMARY KEY NOT NULL,
	`worksite_id` text NOT NULL,
	`product_id` text NOT NULL,
	`quantity` real DEFAULT 0 NOT NULL,
	`min_stock` real DEFAULT 0 NOT NULL,
	`last_movement_at` text,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`worksite_id`) REFERENCES `worksites`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
CREATE UNIQUE INDEX `worksite_stock_unique` ON `worksite_stock` (`worksite_id`,`product_id`);--> statement-breakpoint
CREATE TABLE `inventory_movements` (
	`id` text PRIMARY KEY NOT NULL,
	`worksite_id` text NOT NULL,
	`product_id` text NOT NULL,
	`type` text NOT NULL,
	`quantity` real NOT NULL,
	`reference_type` text,
	`reference_id` text,
	`stock_before` real DEFAULT 0 NOT NULL,
	`stock_after` real DEFAULT 0 NOT NULL,
	`performed_by` text NOT NULL,
	`performed_at` text DEFAULT (datetime('now')) NOT NULL,
	`reason` text,
	`notes` text,
	FOREIGN KEY (`worksite_id`) REFERENCES `worksites`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`performed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
CREATE INDEX `inventory_movements_worksite_performed_at_idx` ON `inventory_movements` (`worksite_id`,`performed_at`);--> statement-breakpoint
CREATE INDEX `inventory_movements_product_performed_at_idx` ON `inventory_movements` (`product_id`,`performed_at`);
