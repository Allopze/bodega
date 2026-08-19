ALTER TABLE "stock_adjustments" ADD COLUMN "kind" text DEFAULT 'ajuste' NOT NULL;--> statement-breakpoint
CREATE INDEX "stock_adjustments_worksite_kind_idx" ON "stock_adjustments" USING btree ("worksite_id","kind","created_at");--> statement-breakpoint
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_kind_valid" CHECK ("stock_adjustments"."kind" IN ('ajuste', 'desecho'));