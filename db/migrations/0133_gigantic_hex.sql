CREATE TABLE "dte_documents" (
	"id" text PRIMARY KEY NOT NULL,
	"tipo_dte" text NOT NULL,
	"folio" integer NOT NULL,
	"rut_emisor" text NOT NULL,
	"razon_social_emisor" text NOT NULL,
	"fecha_emision" text NOT NULL,
	"monto_neto" numeric(14, 2),
	"iva" numeric(14, 2),
	"monto_total" numeric(14, 2) NOT NULL,
	"estado_sii" text,
	"estado_intercambio" text,
	"estado_plataforma" text,
	"cod_emp" text NOT NULL,
	"periodo" text NOT NULL,
	"xml_path" text,
	"pdf_path" text,
	"raw_hash" text NOT NULL,
	"purchase_order_invoice_id" text,
	"fuel_load_id" text,
	"sync_run_id" text,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dte_documents_estado_sii_valid" CHECK (
    "dte_documents"."estado_sii" IS NULL OR "dte_documents"."estado_sii" IN (
      'pendiente_envio', 'enviado', 'aceptado', 'rechazado', 'anulado', 'manual'
    )
  ),
	CONSTRAINT "dte_documents_estado_intercambio_valid" CHECK (
    "dte_documents"."estado_intercambio" IS NULL OR "dte_documents"."estado_intercambio" IN (
      'pendiente', 'aceptado', 'rechazado'
    )
  )
);
--> statement-breakpoint
CREATE TABLE "dte_sync_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"periodo" text NOT NULL,
	"cod_emp" text NOT NULL,
	"trigger" text DEFAULT 'manual' NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"rows_seen" integer DEFAULT 0 NOT NULL,
	"rows_inserted" integer DEFAULT 0 NOT NULL,
	"rows_updated" integer DEFAULT 0 NOT NULL,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "dte_sync_runs_trigger_valid" CHECK ("dte_sync_runs"."trigger" IN ('manual', 'cron')),
	CONSTRAINT "dte_sync_runs_status_valid" CHECK ("dte_sync_runs"."status" IN ('running', 'success', 'partial', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "delivery_item_lots" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "inventory_lots" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "delivery_item_lots" CASCADE;--> statement-breakpoint
DROP TABLE "inventory_lots" CASCADE;--> statement-breakpoint
ALTER TABLE "purchase_orders" DROP CONSTRAINT "purchase_orders_status_valid";--> statement-breakpoint
ALTER TABLE "dte_documents" ADD CONSTRAINT "dte_documents_purchase_order_invoice_id_purchase_order_invoices_id_fk" FOREIGN KEY ("purchase_order_invoice_id") REFERENCES "public"."purchase_order_invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dte_documents" ADD CONSTRAINT "dte_documents_fuel_load_id_fuel_loads_id_fk" FOREIGN KEY ("fuel_load_id") REFERENCES "public"."fuel_loads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dte_documents" ADD CONSTRAINT "dte_documents_sync_run_id_dte_sync_runs_id_fk" FOREIGN KEY ("sync_run_id") REFERENCES "public"."dte_sync_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "dte_documents_unique_key" ON "dte_documents" USING btree ("tipo_dte","folio","rut_emisor","cod_emp");--> statement-breakpoint
CREATE INDEX "dte_documents_periodo_idx" ON "dte_documents" USING btree ("periodo");--> statement-breakpoint
CREATE INDEX "dte_documents_estado_sii_idx" ON "dte_documents" USING btree ("estado_sii");--> statement-breakpoint
CREATE INDEX "dte_documents_rut_emisor_idx" ON "dte_documents" USING btree ("rut_emisor");--> statement-breakpoint
CREATE INDEX "dte_documents_purchase_invoice_idx" ON "dte_documents" USING btree ("purchase_order_invoice_id");--> statement-breakpoint
CREATE INDEX "dte_documents_fuel_load_idx" ON "dte_documents" USING btree ("fuel_load_id");--> statement-breakpoint
CREATE INDEX "dte_documents_raw_hash_idx" ON "dte_documents" USING btree ("raw_hash");--> statement-breakpoint
CREATE INDEX "dte_documents_sync_run_idx" ON "dte_documents" USING btree ("sync_run_id");--> statement-breakpoint
CREATE INDEX "dte_sync_runs_periodo_idx" ON "dte_sync_runs" USING btree ("periodo");--> statement-breakpoint
CREATE INDEX "dte_sync_runs_status_idx" ON "dte_sync_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "dte_sync_runs_started_idx" ON "dte_sync_runs" USING btree ("started_at");--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_status_valid" CHECK (
    "purchase_orders"."status" IN (
      'draft', 'issued', 'sent',
      'partially_office_received', 'office_received',
      'partially_received', 'received', 'closed', 'cancelled'
    )
  );