CREATE TABLE "purchase_order_invoice_item_allocations" (
	"id" text PRIMARY KEY NOT NULL,
	"invoice_item_id" text NOT NULL,
	"purchase_order_item_id" text NOT NULL,
	"quantity" real NOT NULL,
	"subtotal" numeric(12, 2) NOT NULL,
	"source" text NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "po_invoice_item_allocations_quantity_nonzero" CHECK ("purchase_order_invoice_item_allocations"."quantity" <> 0),
	CONSTRAINT "po_invoice_item_allocations_sign_consistent" CHECK (
      ("purchase_order_invoice_item_allocations"."quantity" > 0 AND "purchase_order_invoice_item_allocations"."subtotal" >= 0)
      OR ("purchase_order_invoice_item_allocations"."quantity" < 0 AND "purchase_order_invoice_item_allocations"."subtotal" <= 0)
    ),
	CONSTRAINT "po_invoice_item_allocations_source_valid" CHECK (
      "purchase_order_invoice_item_allocations"."source" IN ('legacy_backfill', 'operator', 'dte_suggestion')
    )
);
--> statement-breakpoint
CREATE TABLE "operational_integrity_case_events" (
	"id" text PRIMARY KEY NOT NULL,
	"case_id" text NOT NULL,
	"observation_id" text NOT NULL,
	"kind" text NOT NULL,
	"reason" text NOT NULL,
	"evidence" jsonb,
	"actor_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "operational_integrity_case_events_kind_valid" CHECK (
    "operational_integrity_case_events"."kind" IN ('acknowledged', 'verified_resolved')
  ),
	CONSTRAINT "operational_integrity_case_events_reason_length" CHECK (
    char_length(trim("operational_integrity_case_events"."reason")) BETWEEN 10 AND 2000
  )
);
--> statement-breakpoint
CREATE TABLE "operational_integrity_cases" (
	"id" text PRIMARY KEY NOT NULL,
	"case_key" text NOT NULL,
	"domain" text NOT NULL,
	"code" text NOT NULL,
	"severity" text NOT NULL,
	"worksite_id" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"first_detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "operational_integrity_cases_case_key_unique" UNIQUE("case_key"),
	CONSTRAINT "operational_integrity_cases_domain_valid" CHECK (
    "operational_integrity_cases"."domain" IN ('stock', 'receiving', 'purchasing')
  ),
	CONSTRAINT "operational_integrity_cases_severity_valid" CHECK (
    "operational_integrity_cases"."severity" IN ('warning', 'high', 'critical')
  )
);
--> statement-breakpoint
CREATE TABLE "operational_integrity_observations" (
	"id" text PRIMARY KEY NOT NULL,
	"case_id" text NOT NULL,
	"fingerprint" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "purchase_order_invoice_item_allocations" ADD CONSTRAINT "purchase_order_invoice_item_allocations_invoice_item_id_purchase_order_invoice_items_id_fk" FOREIGN KEY ("invoice_item_id") REFERENCES "public"."purchase_order_invoice_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_invoice_item_allocations" ADD CONSTRAINT "purchase_order_invoice_item_allocations_purchase_order_item_id_purchase_order_items_id_fk" FOREIGN KEY ("purchase_order_item_id") REFERENCES "public"."purchase_order_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_invoice_item_allocations" ADD CONSTRAINT "purchase_order_invoice_item_allocations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operational_integrity_case_events" ADD CONSTRAINT "operational_integrity_case_events_case_id_operational_integrity_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."operational_integrity_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operational_integrity_case_events" ADD CONSTRAINT "operational_integrity_case_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- El índice único va antes que la FK compuesta: PostgreSQL exige que las
-- columnas referenciadas ya tengan un único que las respalde.
CREATE UNIQUE INDEX "operational_integrity_observations_case_id_key" ON "operational_integrity_observations" USING btree ("case_id","id");--> statement-breakpoint
ALTER TABLE "operational_integrity_case_events" ADD CONSTRAINT "operational_integrity_case_events_case_observation_fk" FOREIGN KEY ("case_id","observation_id") REFERENCES "public"."operational_integrity_observations"("case_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operational_integrity_cases" ADD CONSTRAINT "operational_integrity_cases_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operational_integrity_observations" ADD CONSTRAINT "operational_integrity_observations_case_id_operational_integrity_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."operational_integrity_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "po_invoice_item_allocations_pair_unique" ON "purchase_order_invoice_item_allocations" USING btree ("invoice_item_id","purchase_order_item_id");--> statement-breakpoint
CREATE INDEX "po_invoice_item_allocations_oc_item_idx" ON "purchase_order_invoice_item_allocations" USING btree ("purchase_order_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "operational_integrity_case_events_case_observation_kind_unique" ON "operational_integrity_case_events" USING btree ("case_id","observation_id","kind");--> statement-breakpoint
CREATE INDEX "operational_integrity_case_events_case_created_idx" ON "operational_integrity_case_events" USING btree ("case_id","created_at");--> statement-breakpoint
CREATE INDEX "operational_integrity_cases_worksite_detected_idx" ON "operational_integrity_cases" USING btree ("worksite_id","first_detected_at");--> statement-breakpoint
CREATE INDEX "operational_integrity_cases_domain_code_idx" ON "operational_integrity_cases" USING btree ("domain","code");--> statement-breakpoint
CREATE UNIQUE INDEX "operational_integrity_observation_fingerprint_unique" ON "operational_integrity_observations" USING btree ("case_id","fingerprint");--> statement-breakpoint
-- Backfill 1:1 -> N:N. Cada línea de factura ya vinculada a una línea de OC
-- recibe su asignación equivalente, de modo que los lectores nuevos vean la
-- misma evidencia que el espejo de compatibilidad. Idempotente: repetirla no
-- duplica filas.
INSERT INTO purchase_order_invoice_item_allocations
  (id, invoice_item_id, purchase_order_item_id, quantity, subtotal, source)
SELECT
  'legacy-' || pii.id,
  pii.id,
  pii.purchase_order_item_id,
  pii.quantity,
  pii.subtotal,
  'legacy_backfill'
FROM purchase_order_invoice_items pii
WHERE pii.purchase_order_item_id IS NOT NULL
ON CONFLICT (invoice_item_id, purchase_order_item_id) DO NOTHING;
