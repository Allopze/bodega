CREATE TABLE "product_supplier_price_history" (
	"id" text PRIMARY KEY NOT NULL,
	"product_id" text NOT NULL,
	"supplier_id" text NOT NULL,
	"unit_price" integer NOT NULL,
	"effective_date" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "prevention_pdtp_source_links" DROP CONSTRAINT "prevention_pdtp_source_links_type_valid";--> statement-breakpoint
ALTER TABLE "product_supplier_price_history" ADD CONSTRAINT "product_supplier_price_history_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_supplier_price_history" ADD CONSTRAINT "product_supplier_price_history_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_supplier_price_history" ADD CONSTRAINT "product_supplier_price_history_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_pdtp_source_links" ADD CONSTRAINT "prevention_pdtp_source_links_type_valid" CHECK ("prevention_pdtp_source_links"."source_type" IN ('risk_control', 'legal_requirement', 'incident', 'incident_capa', 'audit', 'internal_objective', 'contractual_obligation', 'capacitacion', 'inspeccion', 'cphs', 'epp', 'emergencia', 'campana'));