ALTER TABLE "fuel_provider_mappings" DROP CONSTRAINT "fuel_provider_mappings_active_valid";--> statement-breakpoint
DROP INDEX "fuel_provider_mappings_active_unique";--> statement-breakpoint
ALTER TABLE "fuel_provider_mappings" ALTER COLUMN "is_active" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "fuel_provider_mappings" ALTER COLUMN "is_active" SET DATA TYPE boolean USING lower(trim("is_active")) IN ('true', 't', '1', 'yes');--> statement-breakpoint
ALTER TABLE "fuel_provider_mappings" ALTER COLUMN "is_active" SET DEFAULT true;--> statement-breakpoint
ALTER TABLE "fuel_provider_transactions" ADD COLUMN "supplier_id" text;--> statement-breakpoint
ALTER TABLE "fuel_provider_transactions" ADD CONSTRAINT "fuel_provider_transactions_supplier_id_fuel_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."fuel_suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "fuel_provider_mappings_active_unique" ON "fuel_provider_mappings" USING btree ("provider","source_account","external_key") WHERE "fuel_provider_mappings"."is_active";
