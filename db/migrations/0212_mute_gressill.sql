CREATE TABLE "dte_document_items" (
	"id" text PRIMARY KEY NOT NULL,
	"dte_document_id" text NOT NULL,
	"line_number" integer NOT NULL,
	"product_code" text,
	"product_name" text NOT NULL,
	"description" text,
	"unit_of_measure" text,
	"quantity" real NOT NULL,
	"unit_price" numeric(14, 4) NOT NULL,
	"discount" numeric(14, 2) DEFAULT 0 NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dte_document_items_line_positive" CHECK ("dte_document_items"."line_number" > 0),
	CONSTRAINT "dte_document_items_quantity_positive" CHECK ("dte_document_items"."quantity" > 0),
	CONSTRAINT "dte_document_items_amounts_non_negative" CHECK (
    "dte_document_items"."unit_price" >= 0 AND "dte_document_items"."discount" >= 0 AND "dte_document_items"."amount" >= 0
  )
);
--> statement-breakpoint
CREATE TABLE "supplier_product_aliases" (
	"id" text PRIMARY KEY NOT NULL,
	"supplier_id" text NOT NULL,
	"product_id" text NOT NULL,
	"supplier_product_code" text,
	"supplier_product_name" text,
	"normalized_code" text,
	"normalized_name" text,
	"unit_of_measure" text,
	"confirmed_by" text NOT NULL,
	"source_dte_document_item_id" text,
	"confirmed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supplier_product_aliases_identity_present" CHECK (
    "supplier_product_aliases"."normalized_code" IS NOT NULL OR "supplier_product_aliases"."normalized_name" IS NOT NULL
  )
);
--> statement-breakpoint
ALTER TABLE "purchase_order_invoices" ADD COLUMN "document_supplier_rut" text;--> statement-breakpoint
ALTER TABLE "purchase_order_invoices" ADD COLUMN "supplier_identity_status" text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase_order_invoices" ADD COLUMN "supplier_identity_source" text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
ALTER TABLE "dte_documents" ADD COLUMN "line_enrichment_status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "dte_documents" ADD COLUMN "line_enrichment_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "dte_documents" ADD COLUMN "line_enriched_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "dte_documents" ADD COLUMN "line_enrichment_error_code" text;--> statement-breakpoint
ALTER TABLE "dte_document_items" ADD CONSTRAINT "dte_document_items_dte_document_id_dte_documents_id_fk" FOREIGN KEY ("dte_document_id") REFERENCES "public"."dte_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_product_aliases" ADD CONSTRAINT "supplier_product_aliases_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_product_aliases" ADD CONSTRAINT "supplier_product_aliases_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_product_aliases" ADD CONSTRAINT "supplier_product_aliases_confirmed_by_users_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_product_aliases" ADD CONSTRAINT "supplier_product_aliases_source_dte_document_item_id_dte_document_items_id_fk" FOREIGN KEY ("source_dte_document_item_id") REFERENCES "public"."dte_document_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "dte_document_items_document_line_unique" ON "dte_document_items" USING btree ("dte_document_id","line_number");--> statement-breakpoint
CREATE INDEX "dte_document_items_document_idx" ON "dte_document_items" USING btree ("dte_document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_product_aliases_supplier_code_unique" ON "supplier_product_aliases" USING btree ("supplier_id","normalized_code") WHERE "supplier_product_aliases"."normalized_code" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_product_aliases_evidence_unique" ON "supplier_product_aliases" USING btree ("supplier_id","product_id","source_dte_document_item_id") WHERE "supplier_product_aliases"."source_dte_document_item_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "supplier_product_aliases_supplier_name_idx" ON "supplier_product_aliases" USING btree ("supplier_id","normalized_name");--> statement-breakpoint
CREATE INDEX "supplier_product_aliases_product_idx" ON "supplier_product_aliases" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "dte_documents_line_enrichment_idx" ON "dte_documents" USING btree ("line_enrichment_status","tipo_dte","periodo");--> statement-breakpoint
ALTER TABLE "purchase_order_invoices" ADD CONSTRAINT "purchase_order_invoices_supplier_identity_status_valid" CHECK (
    "purchase_order_invoices"."supplier_identity_status" IN ('unknown', 'verified', 'unverified')
  );--> statement-breakpoint
ALTER TABLE "purchase_order_invoices" ADD CONSTRAINT "purchase_order_invoices_supplier_identity_source_valid" CHECK (
    "purchase_order_invoices"."supplier_identity_source" IN ('legacy', 'dte_xml', 'pdf_text', 'pdf_text_ocr', 'ocr', 'manual')
  );--> statement-breakpoint
ALTER TABLE "dte_documents" ADD CONSTRAINT "dte_documents_line_enrichment_status_valid" CHECK (
    "dte_documents"."line_enrichment_status" IN ('pending', 'ready', 'failed')
  );--> statement-breakpoint
ALTER TABLE "dte_documents" ADD CONSTRAINT "dte_documents_line_enrichment_attempts_non_negative" CHECK ("dte_documents"."line_enrichment_attempts" >= 0);