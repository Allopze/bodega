CREATE TABLE "mant_historical_records" (
	"source_key" text PRIMARY KEY NOT NULL,
	"fingerprint" text NOT NULL,
	"source_file" text NOT NULL,
	"source_sheet" text NOT NULL,
	"source_row" integer NOT NULL,
	"submitted_at" text NOT NULL,
	"worksite_text" text NOT NULL,
	"worksite_id" text,
	"equipment_text" text NOT NULL,
	"vehicle_id" text,
	"equipment_match" text NOT NULL,
	"order_text" text NOT NULL,
	"kind_text" text NOT NULL,
	"reading_text" text NOT NULL,
	"description" text NOT NULL,
	"entry_date" text,
	"exit_date" text,
	"hours_text" text NOT NULL,
	"fields" jsonb NOT NULL,
	"imported_by" text NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mant_historical_records_source_row_valid" CHECK ("mant_historical_records"."source_row" >= 2),
	CONSTRAINT "mant_historical_records_match_valid" CHECK (("mant_historical_records"."equipment_match" = 'linked' AND "mant_historical_records"."vehicle_id" IS NOT NULL) OR ("mant_historical_records"."equipment_match" IN ('unmatched', 'conflict') AND "mant_historical_records"."vehicle_id" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "mant_historical_records" ADD CONSTRAINT "mant_historical_records_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mant_historical_records" ADD CONSTRAINT "mant_historical_records_vehicle_id_fuel_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."fuel_vehicles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mant_historical_records" ADD CONSTRAINT "mant_historical_records_imported_by_users_id_fk" FOREIGN KEY ("imported_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mant_historical_records_vehicle_date_idx" ON "mant_historical_records" USING btree ("vehicle_id","entry_date");--> statement-breakpoint
CREATE INDEX "mant_historical_records_worksite_date_idx" ON "mant_historical_records" USING btree ("worksite_id","entry_date");