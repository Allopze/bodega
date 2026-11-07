CREATE TABLE "fuel_consumption_import_rejections" (
	"id" text PRIMARY KEY NOT NULL,
	"hash_archivo" text NOT NULL,
	"batch_id" text,
	"row_index" integer NOT NULL,
	"patente" text,
	"field" text NOT NULL,
	"message" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fuel_consumption_import_rejections" ADD CONSTRAINT "fuel_consumption_import_rejections_batch_id_fuel_import_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."fuel_import_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fuel_consumption_import_rejections_hash_idx" ON "fuel_consumption_import_rejections" USING btree ("hash_archivo");--> statement-breakpoint
CREATE INDEX "fuel_consumption_import_rejections_batch_idx" ON "fuel_consumption_import_rejections" USING btree ("batch_id");