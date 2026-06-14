ALTER TABLE "worksite_stock"
ADD CONSTRAINT "worksite_stock_quantity_non_negative"
CHECK ("quantity" >= 0);
--> statement-breakpoint
