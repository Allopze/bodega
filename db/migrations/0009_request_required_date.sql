ALTER TABLE `purchase_requests` ADD `required_date` text;--> statement-breakpoint
UPDATE `purchase_requests`
SET `required_date` = (
	SELECT min(`required_date`)
	FROM `purchase_request_items`
	WHERE `purchase_request_items`.`request_id` = `purchase_requests`.`id`
		AND `purchase_request_items`.`required_date` IS NOT NULL
		AND `purchase_request_items`.`required_date` <> ''
)
WHERE `required_date` IS NULL;--> statement-breakpoint
UPDATE `purchase_request_items`
SET `required_date` = (
	SELECT `required_date`
	FROM `purchase_requests`
	WHERE `purchase_requests`.`id` = `purchase_request_items`.`request_id`
)
WHERE (`required_date` IS NULL OR `required_date` = '')
	AND EXISTS (
		SELECT 1
		FROM `purchase_requests`
		WHERE `purchase_requests`.`id` = `purchase_request_items`.`request_id`
			AND `purchase_requests`.`required_date` IS NOT NULL
			AND `purchase_requests`.`required_date` <> ''
	);
