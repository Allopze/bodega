
DROP TABLE `cost_centers`;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_purchase_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`worksite_id` text NOT NULL,
	`requester_id` text NOT NULL,
	`urgency` text DEFAULT 'normal' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`submitted_at` text,
	`closed_at` text,
	`notes` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`worksite_id`) REFERENCES `worksites`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`requester_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_purchase_requests`("id", "code", "worksite_id", "requester_id", "urgency", "status", "submitted_at", "closed_at", "notes", "created_at", "updated_at") SELECT "id", "code", "worksite_id", "requester_id", "urgency", "status", "submitted_at", "closed_at", "notes", "created_at", "updated_at" FROM `purchase_requests`;--> statement-breakpoint
DROP TABLE `purchase_requests`;--> statement-breakpoint
ALTER TABLE `__new_purchase_requests` RENAME TO `purchase_requests`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `purchase_requests_code_unique` ON `purchase_requests` (`code`);