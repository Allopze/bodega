ALTER TABLE "delivery_items" ADD COLUMN "quantity_original" real;--> statement-breakpoint
ALTER TABLE "delivery_items" ADD COLUMN "quantity_corrected_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "delivery_items" ADD COLUMN "quantity_correction_reason" text;--> statement-breakpoint
ALTER TABLE "delivery_items" ADD CONSTRAINT "delivery_items_quantity_correction_valid" CHECK (
    ("delivery_items"."quantity_original" IS NULL
      AND "delivery_items"."quantity_corrected_at" IS NULL
      AND "delivery_items"."quantity_correction_reason" IS NULL)
    OR
    ("delivery_items"."quantity_original" > 0
      AND "delivery_items"."quantity_corrected_at" IS NOT NULL
      AND char_length(trim("delivery_items"."quantity_correction_reason")) > 0)
  );