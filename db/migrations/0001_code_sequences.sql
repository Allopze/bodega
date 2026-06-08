CREATE TABLE `code_sequences` (
	`prefix` text NOT NULL,
	`year` integer NOT NULL,
	`next_value` integer DEFAULT 1 NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	PRIMARY KEY(`prefix`, `year`)
);
--> statement-breakpoint
INSERT INTO `code_sequences` (`prefix`, `year`, `next_value`, `updated_at`)
SELECT 'SOL', CAST(substr(`code`, 5, 4) AS integer), MAX(CAST(substr(`code`, 10) AS integer)) + 1, datetime('now')
FROM `purchase_requests`
WHERE `code` LIKE 'SOL-____-%'
GROUP BY CAST(substr(`code`, 5, 4) AS integer);
--> statement-breakpoint
INSERT INTO `code_sequences` (`prefix`, `year`, `next_value`, `updated_at`)
SELECT 'OC', CAST(substr(`code`, 4, 4) AS integer), MAX(CAST(substr(`code`, 9) AS integer)) + 1, datetime('now')
FROM `purchase_orders`
WHERE `code` LIKE 'OC-____-%'
GROUP BY CAST(substr(`code`, 4, 4) AS integer);
--> statement-breakpoint
INSERT INTO `code_sequences` (`prefix`, `year`, `next_value`, `updated_at`)
SELECT 'REC', CAST(substr(`code`, 5, 4) AS integer), MAX(CAST(substr(`code`, 10) AS integer)) + 1, datetime('now')
FROM `receipts`
WHERE `code` LIKE 'REC-____-%'
GROUP BY CAST(substr(`code`, 5, 4) AS integer);
--> statement-breakpoint
INSERT INTO `code_sequences` (`prefix`, `year`, `next_value`, `updated_at`)
SELECT 'ENT', CAST(substr(`code`, 5, 4) AS integer), MAX(CAST(substr(`code`, 10) AS integer)) + 1, datetime('now')
FROM `deliveries`
WHERE `code` LIKE 'ENT-____-%'
GROUP BY CAST(substr(`code`, 5, 4) AS integer);
