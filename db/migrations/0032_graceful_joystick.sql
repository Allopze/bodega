CREATE TABLE "epp_product_families" (
	"id" text PRIMARY KEY NOT NULL,
	"category_id" text NOT NULL,
	"canonical_name" text NOT NULL,
	"identity_key" text NOT NULL,
	"epp_type" text,
	"brand" text,
	"model" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "epp_product_families_identity_key_unique" UNIQUE("identity_key")
);
--> statement-breakpoint
CREATE TABLE "epp_import_batches" (
	"id" text PRIMARY KEY NOT NULL,
	"source" text DEFAULT 'xlsx' NOT NULL,
	"file_name" text NOT NULL,
	"file_hash" text NOT NULL,
	"status" text DEFAULT 'uploaded' NOT NULL,
	"headers_json" text DEFAULT '{}' NOT NULL,
	"source_file_json" text DEFAULT '{}' NOT NULL,
	"rules_version" text DEFAULT 'epp-normalization-v1' NOT NULL,
	"created_by" text NOT NULL,
	"approved_by" text,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "epp_import_corrections" (
	"id" text PRIMARY KEY NOT NULL,
	"row_id" text NOT NULL,
	"field" text NOT NULL,
	"original_value" text,
	"proposed_value" text,
	"rule_id" text NOT NULL,
	"confidence" integer NOT NULL,
	"disposition" text DEFAULT 'proposed' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "epp_import_matches" (
	"id" text PRIMARY KEY NOT NULL,
	"row_id" text NOT NULL,
	"product_id" text NOT NULL,
	"score" integer NOT NULL,
	"reasons_json" text DEFAULT '[]' NOT NULL,
	"disposition" text DEFAULT 'proposed' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "epp_import_rows" (
	"id" text PRIMARY KEY NOT NULL,
	"batch_id" text NOT NULL,
	"row_number" integer NOT NULL,
	"source_code" text,
	"original_json" text NOT NULL,
	"normalized_json" text NOT NULL,
	"identity_key" text,
	"severity" text DEFAULT 'info' NOT NULL,
	"decision" text DEFAULT 'pending' NOT NULL,
	"target_product_id" text,
	"review_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_external_references" (
	"id" text PRIMARY KEY NOT NULL,
	"product_id" text NOT NULL,
	"supplier_id" text,
	"source" text NOT NULL,
	"external_code" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "family_id" text;--> statement-breakpoint
ALTER TABLE "epp_product_families" ADD CONSTRAINT "epp_product_families_category_id_product_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."product_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "epp_import_batches" ADD CONSTRAINT "epp_import_batches_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "epp_import_batches" ADD CONSTRAINT "epp_import_batches_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "epp_import_corrections" ADD CONSTRAINT "epp_import_corrections_row_id_epp_import_rows_id_fk" FOREIGN KEY ("row_id") REFERENCES "public"."epp_import_rows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "epp_import_matches" ADD CONSTRAINT "epp_import_matches_row_id_epp_import_rows_id_fk" FOREIGN KEY ("row_id") REFERENCES "public"."epp_import_rows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "epp_import_matches" ADD CONSTRAINT "epp_import_matches_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "epp_import_rows" ADD CONSTRAINT "epp_import_rows_batch_id_epp_import_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."epp_import_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "epp_import_rows" ADD CONSTRAINT "epp_import_rows_target_product_id_products_id_fk" FOREIGN KEY ("target_product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_external_references" ADD CONSTRAINT "product_external_references_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_external_references" ADD CONSTRAINT "product_external_references_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "epp_import_batches_status_idx" ON "epp_import_batches" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "epp_import_batches_file_hash_unique" ON "epp_import_batches" USING btree ("file_hash");--> statement-breakpoint
CREATE INDEX "epp_import_matches_row_score_idx" ON "epp_import_matches" USING btree ("row_id","score");--> statement-breakpoint
CREATE UNIQUE INDEX "epp_import_rows_batch_row_unique" ON "epp_import_rows" USING btree ("batch_id","row_number");--> statement-breakpoint
CREATE INDEX "epp_import_rows_batch_severity_idx" ON "epp_import_rows" USING btree ("batch_id","severity");--> statement-breakpoint
CREATE UNIQUE INDEX "product_external_references_source_code_unique" ON "product_external_references" USING btree ("source","external_code");--> statement-breakpoint
CREATE INDEX "product_external_references_product_idx" ON "product_external_references" USING btree ("product_id");--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_family_id_epp_product_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."epp_product_families"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_worksites_active" ON "worksites" USING btree ("is_active") WHERE "worksites"."is_active" = true;--> statement-breakpoint
CREATE INDEX "idx_approval_decisions_item" ON "approval_decisions" USING btree ("request_item_id");--> statement-breakpoint
CREATE INDEX "idx_deliveries_worksite_date" ON "deliveries" USING btree ("worksite_id","delivered_at");--> statement-breakpoint
CREATE INDEX "idx_delivery_items_request" ON "delivery_items" USING btree ("request_item_id");--> statement-breakpoint
CREATE INDEX "idx_receipt_items_po_item" ON "receipt_items" USING btree ("purchase_order_item_id");--> statement-breakpoint
CREATE INDEX "idx_receipts_po" ON "receipts" USING btree ("purchase_order_id");--> statement-breakpoint
CREATE INDEX "idx_inventory_mov_worksite_prod_type" ON "inventory_movements" USING btree ("worksite_id","product_id","type");--> statement-breakpoint
CREATE INDEX "idx_sst_worksite_estado" ON "sst_evaluations" USING btree ("worksite_id","estado","created_at");--> statement-breakpoint
CREATE INDEX "idx_sst_worker" ON "sst_evaluations" USING btree ("worker_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_sst_followup_eval" ON "sst_scheduled_followups" USING btree ("evaluation_id");--> statement-breakpoint
CREATE INDEX "idx_ppa_worksite_estado" ON "ppa_submissions" USING btree ("worksite_id","estado");--> statement-breakpoint
CREATE INDEX "idx_ppa_created" ON "ppa_submissions" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_ppa_worker" ON "ppa_submissions" USING btree ("worker_id","worksite_id");