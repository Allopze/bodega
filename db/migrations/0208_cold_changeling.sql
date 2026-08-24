CREATE TABLE "fuel_reconciliation_links" (
	"id" text PRIMARY KEY NOT NULL,
	"provider_transaction_id" text NOT NULL,
	"link_type" text NOT NULL,
	"fuel_load_id" text,
	"cycle_movement_id" text,
	"dte_document_id" text,
	"status" text DEFAULT 'unmatched' NOT NULL,
	"match_method" text,
	"liters_delta" numeric(14, 4),
	"amount_delta" numeric(14, 2),
	"tolerance_liters" numeric(14, 4) DEFAULT 0 NOT NULL,
	"tolerance_amount" numeric(14, 2) DEFAULT 0 NOT NULL,
	"reason" text,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fuel_reconciliation_links_type_valid" CHECK ("fuel_reconciliation_links"."link_type" IN ('fuel_load', 'cycle_movement', 'dte')),
	CONSTRAINT "fuel_reconciliation_links_status_valid" CHECK ("fuel_reconciliation_links"."status" IN ('matched', 'ambiguous', 'unmatched', 'accepted_exception')),
	CONSTRAINT "fuel_reconciliation_links_target_shape_valid" CHECK (
    ("fuel_reconciliation_links"."link_type" = 'fuel_load' AND "fuel_reconciliation_links"."fuel_load_id" IS NOT NULL AND "fuel_reconciliation_links"."cycle_movement_id" IS NULL AND "fuel_reconciliation_links"."dte_document_id" IS NULL)
    OR ("fuel_reconciliation_links"."link_type" = 'cycle_movement' AND "fuel_reconciliation_links"."cycle_movement_id" IS NOT NULL AND "fuel_reconciliation_links"."fuel_load_id" IS NULL AND "fuel_reconciliation_links"."dte_document_id" IS NULL)
    OR ("fuel_reconciliation_links"."link_type" = 'dte' AND "fuel_reconciliation_links"."dte_document_id" IS NOT NULL AND "fuel_reconciliation_links"."fuel_load_id" IS NULL AND "fuel_reconciliation_links"."cycle_movement_id" IS NULL)
    OR ("fuel_reconciliation_links"."status" IN ('ambiguous', 'unmatched') AND "fuel_reconciliation_links"."fuel_load_id" IS NULL AND "fuel_reconciliation_links"."cycle_movement_id" IS NULL AND "fuel_reconciliation_links"."dte_document_id" IS NULL)
  )
);
--> statement-breakpoint
ALTER TABLE "fuel_reconciliation_links" ADD CONSTRAINT "fuel_reconciliation_links_provider_transaction_id_fuel_provider_transactions_id_fk" FOREIGN KEY ("provider_transaction_id") REFERENCES "public"."fuel_provider_transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_reconciliation_links" ADD CONSTRAINT "fuel_reconciliation_links_fuel_load_id_fuel_loads_id_fk" FOREIGN KEY ("fuel_load_id") REFERENCES "public"."fuel_loads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_reconciliation_links" ADD CONSTRAINT "fuel_reconciliation_links_cycle_movement_id_fuel_cycle_movements_id_fk" FOREIGN KEY ("cycle_movement_id") REFERENCES "public"."fuel_cycle_movements"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_reconciliation_links" ADD CONSTRAINT "fuel_reconciliation_links_dte_document_id_dte_documents_id_fk" FOREIGN KEY ("dte_document_id") REFERENCES "public"."dte_documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_reconciliation_links" ADD CONSTRAINT "fuel_reconciliation_links_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "fuel_reconciliation_links_target_unique" ON "fuel_reconciliation_links" USING btree ("provider_transaction_id","link_type","fuel_load_id","cycle_movement_id","dte_document_id");--> statement-breakpoint
CREATE INDEX "fuel_reconciliation_links_transaction_idx" ON "fuel_reconciliation_links" USING btree ("provider_transaction_id");--> statement-breakpoint
CREATE INDEX "fuel_reconciliation_links_status_idx" ON "fuel_reconciliation_links" USING btree ("status");--> statement-breakpoint
CREATE INDEX "fuel_reconciliation_links_dte_idx" ON "fuel_reconciliation_links" USING btree ("dte_document_id");