CREATE TABLE "mant_historical_schedule_items" (
	"source_key" text PRIMARY KEY NOT NULL,
	"check_source_key" text NOT NULL,
	"item_name" text NOT NULL,
	"result" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mant_historical_schedule_items_result_valid" CHECK ("mant_historical_schedule_items"."result" IN ('realizado', 'no_realizado', 'no_aplica')),
	CONSTRAINT "mant_historical_schedule_items_sort_valid" CHECK ("mant_historical_schedule_items"."sort_order" >= 0)
);
--> statement-breakpoint
ALTER TABLE "mant_historical_schedule_checks" ADD COLUMN "mechanic" text;--> statement-breakpoint
ALTER TABLE "mant_historical_schedule_checks" ADD COLUMN "observations" text;--> statement-breakpoint
ALTER TABLE "mant_historical_schedule_checks" ADD COLUMN "items_not_done" text[];--> statement-breakpoint
ALTER TABLE "mant_historical_schedule_checks" ADD COLUMN "filters_photo_url" text;--> statement-breakpoint
ALTER TABLE "mant_historical_schedule_checks" ADD COLUMN "sticker_photo_url" text;--> statement-breakpoint
ALTER TABLE "mant_historical_schedule_items" ADD CONSTRAINT "mant_historical_schedule_items_check_fk" FOREIGN KEY ("check_source_key") REFERENCES "public"."mant_historical_schedule_checks"("source_key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mant_historical_schedule_items_name_unique" ON "mant_historical_schedule_items" USING btree ("check_source_key","item_name");--> statement-breakpoint
CREATE INDEX "mant_historical_schedule_items_check_idx" ON "mant_historical_schedule_items" USING btree ("check_source_key","sort_order");