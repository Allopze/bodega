CREATE TABLE "client_contacts" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"name" text NOT NULL,
	"role" text,
	"email" text,
	"phone" text,
	"is_billing" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "client_contacts_name_nonempty" CHECK (length("client_contacts"."name") > 0)
);
--> statement-breakpoint
CREATE TABLE "clients" (
	"id" text PRIMARY KEY NOT NULL,
	"rut" text NOT NULL,
	"name" text NOT NULL,
	"trade_name" text,
	"business_activity" text,
	"email" text,
	"phone" text,
	"address" text,
	"commune" text,
	"city" text,
	"payment_terms_days" integer,
	"default_currency" text DEFAULT 'CLP' NOT NULL,
	"owner_user_id" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "clients_rut_nonempty" CHECK (length("clients"."rut") > 0),
	CONSTRAINT "clients_name_nonempty" CHECK (length("clients"."name") > 0),
	CONSTRAINT "clients_payment_terms_range" CHECK ("clients"."payment_terms_days" IS NULL OR ("clients"."payment_terms_days" >= 0 AND "clients"."payment_terms_days" <= 365)),
	CONSTRAINT "clients_currency_format" CHECK ("clients"."default_currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
CREATE TABLE "contracts" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"client_id" text NOT NULL,
	"name" text NOT NULL,
	"worksite_id" text,
	"cost_center_id" text,
	"client_po_number" text,
	"start_date" text,
	"end_date" text,
	"currency" text DEFAULT 'CLP' NOT NULL,
	"payment_terms_days" integer,
	"billing_cycle" text DEFAULT 'monthly' NOT NULL,
	"period_amount" numeric(14, 2),
	"owner_user_id" text,
	"status" text DEFAULT 'active' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contracts_status_valid" CHECK ("contracts"."status" IN ('active', 'suspended', 'closed')),
	CONSTRAINT "contracts_billing_cycle_valid" CHECK ("contracts"."billing_cycle" IN ('monthly', 'milestone', 'none')),
	CONSTRAINT "contracts_currency_format" CHECK ("contracts"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "contracts_payment_terms_range" CHECK ("contracts"."payment_terms_days" IS NULL OR ("contracts"."payment_terms_days" >= 0 AND "contracts"."payment_terms_days" <= 365)),
	CONSTRAINT "contracts_dates_ordered" CHECK ("contracts"."start_date" IS NULL OR "contracts"."end_date" IS NULL OR "contracts"."start_date" <= "contracts"."end_date"),
	CONSTRAINT "contracts_period_amount_non_negative" CHECK ("contracts"."period_amount" IS NULL OR "contracts"."period_amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "billing_bank_transactions" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"external_id" text NOT NULL,
	"transaction_date" text NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"currency" text DEFAULT 'CLP' NOT NULL,
	"description" text,
	"counterparty_name" text,
	"counterparty_tax_id" text,
	"account_ref" text,
	"allocated_amount" numeric(14, 2) DEFAULT 0 NOT NULL,
	"payload_hash" text NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_bank_tx_provider_valid" CHECK ("billing_bank_transactions"."provider" IN ('factura_en_linea', 'chipax', 'manual')),
	CONSTRAINT "billing_bank_tx_currency_format" CHECK ("billing_bank_transactions"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "billing_bank_tx_date_format" CHECK ("billing_bank_transactions"."transaction_date" ~ '^\d{4}-\d{2}-\d{2}$')
);
--> statement-breakpoint
CREATE TABLE "billing_collection_actions" (
	"id" text PRIMARY KEY NOT NULL,
	"invoice_id" text NOT NULL,
	"contact_name" text,
	"action_date" text NOT NULL,
	"action_type" text NOT NULL,
	"channel" text,
	"outcome" text NOT NULL,
	"commitment_date" text,
	"commitment_amount" numeric(14, 2),
	"next_action_date" text,
	"notes" text,
	"assignee_user_id" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_collection_actions_type_valid" CHECK ("billing_collection_actions"."action_type" IN ('call', 'email', 'meeting', 'note', 'claim', 'commitment', 'dispute')),
	CONSTRAINT "billing_collection_actions_channel_valid" CHECK ("billing_collection_actions"."channel" IS NULL OR "billing_collection_actions"."channel" IN ('phone', 'email', 'in_person', 'portal', 'letter', 'other')),
	CONSTRAINT "billing_collection_actions_outcome_valid" CHECK ("billing_collection_actions"."outcome" IN ('contacted', 'no_answer', 'promised_payment', 'disputed', 'escalated', 'resolved', 'other')),
	CONSTRAINT "billing_collection_actions_date_format" CHECK ("billing_collection_actions"."action_date" ~ '^\d{4}-\d{2}-\d{2}$'),
	CONSTRAINT "billing_collection_actions_commitment_has_date" CHECK (
    "billing_collection_actions"."action_type" <> 'commitment' OR "billing_collection_actions"."commitment_date" IS NOT NULL
  )
);
--> statement-breakpoint
CREATE TABLE "billing_duplicate_candidates" (
	"id" text PRIMARY KEY NOT NULL,
	"invoice_id" text NOT NULL,
	"other_invoice_id" text NOT NULL,
	"classification" text NOT NULL,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"merged_into_id" text,
	"resolved_by" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_duplicate_candidates_classification_valid" CHECK ("billing_duplicate_candidates"."classification" IN ('probable', 'possible', 'conflict')),
	CONSTRAINT "billing_duplicate_candidates_status_valid" CHECK ("billing_duplicate_candidates"."status" IN ('open', 'merged', 'dismissed')),
	CONSTRAINT "billing_duplicate_candidates_distinct" CHECK ("billing_duplicate_candidates"."invoice_id" <> "billing_duplicate_candidates"."other_invoice_id")
);
--> statement-breakpoint
CREATE TABLE "billing_external_refs" (
	"id" text PRIMARY KEY NOT NULL,
	"invoice_id" text NOT NULL,
	"provider" text NOT NULL,
	"external_id" text NOT NULL,
	"external_folio" text,
	"external_status" text,
	"account_ref" text,
	"document_url" text,
	"payload_hash" text NOT NULL,
	"snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_external_refs_provider_valid" CHECK ("billing_external_refs"."provider" IN ('factura_en_linea', 'chipax', 'manual')),
	CONSTRAINT "billing_external_refs_external_id_nonempty" CHECK (length("billing_external_refs"."external_id") > 0)
);
--> statement-breakpoint
CREATE TABLE "billing_invoice_events" (
	"id" text PRIMARY KEY NOT NULL,
	"invoice_id" text NOT NULL,
	"event_type" text NOT NULL,
	"actor_kind" text NOT NULL,
	"actor_user_id" text,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_invoice_events_actor_kind_valid" CHECK ("billing_invoice_events"."actor_kind" IN ('provider', 'system', 'user')),
	CONSTRAINT "billing_invoice_events_type_nonempty" CHECK (length("billing_invoice_events"."event_type") > 0)
);
--> statement-breakpoint
CREATE TABLE "billing_invoice_items" (
	"id" text PRIMARY KEY NOT NULL,
	"invoice_id" text NOT NULL,
	"external_item_id" text,
	"description" text NOT NULL,
	"quantity" numeric(14, 4),
	"unit" text,
	"unit_price" numeric(14, 2),
	"discount_amount" numeric(14, 2),
	"net_amount" numeric(14, 2),
	"tax_amount" numeric(14, 2),
	"total_amount" numeric(14, 2),
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_invoice_items_description_nonempty" CHECK (length("billing_invoice_items"."description") > 0)
);
--> statement-breakpoint
CREATE TABLE "billing_invoice_links" (
	"id" text PRIMARY KEY NOT NULL,
	"invoice_id" text NOT NULL,
	"client_id" text,
	"contract_id" text,
	"worksite_id" text,
	"cost_center_id" text,
	"proposal_id" text,
	"service_period" text,
	"client_po_number" text,
	"amount" numeric(14, 2),
	"status" text DEFAULT 'suggested' NOT NULL,
	"matched_by" text DEFAULT 'auto' NOT NULL,
	"confidence" text,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"confirmed_by" text,
	"confirmed_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_invoice_links_status_valid" CHECK ("billing_invoice_links"."status" IN ('suggested', 'confirmed', 'rejected')),
	CONSTRAINT "billing_invoice_links_matched_by_valid" CHECK ("billing_invoice_links"."matched_by" IN ('auto', 'user')),
	CONSTRAINT "billing_invoice_links_confidence_valid" CHECK ("billing_invoice_links"."confidence" IS NULL OR "billing_invoice_links"."confidence" IN ('high', 'medium', 'low')),
	CONSTRAINT "billing_invoice_links_period_format" CHECK ("billing_invoice_links"."service_period" IS NULL OR "billing_invoice_links"."service_period" ~ '^\d{4}-\d{2}$'),
	CONSTRAINT "billing_invoice_links_target_present" CHECK (
    "billing_invoice_links"."client_id" IS NOT NULL OR "billing_invoice_links"."contract_id" IS NOT NULL
    OR "billing_invoice_links"."worksite_id" IS NOT NULL OR "billing_invoice_links"."proposal_id" IS NOT NULL
  ),
	CONSTRAINT "billing_invoice_links_confirmation_traced" CHECK (
    "billing_invoice_links"."status" <> 'confirmed'
    OR ("billing_invoice_links"."confirmed_by" IS NOT NULL AND "billing_invoice_links"."confirmed_at" IS NOT NULL)
  )
);
--> statement-breakpoint
CREATE TABLE "billing_invoice_payments" (
	"id" text PRIMARY KEY NOT NULL,
	"invoice_id" text NOT NULL,
	"bank_transaction_id" text,
	"payment_date" text NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"currency" text DEFAULT 'CLP' NOT NULL,
	"method" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"external_transaction_id" text,
	"verification_status" text DEFAULT 'suggested' NOT NULL,
	"confidence" text,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"matched_by" text DEFAULT 'auto' NOT NULL,
	"confirmed_by" text,
	"confirmed_at" timestamp with time zone,
	"rejected_by" text,
	"rejected_at" timestamp with time zone,
	"rejection_reason" text,
	"notes" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_invoice_payments_status_valid" CHECK ("billing_invoice_payments"."verification_status" IN ('suggested', 'confirmed', 'rejected')),
	CONSTRAINT "billing_invoice_payments_matched_by_valid" CHECK ("billing_invoice_payments"."matched_by" IN ('auto', 'user')),
	CONSTRAINT "billing_invoice_payments_source_valid" CHECK ("billing_invoice_payments"."source" IN ('factura_en_linea', 'chipax', 'manual')),
	CONSTRAINT "billing_invoice_payments_confidence_valid" CHECK ("billing_invoice_payments"."confidence" IS NULL OR "billing_invoice_payments"."confidence" IN ('high', 'medium', 'low')),
	CONSTRAINT "billing_invoice_payments_currency_format" CHECK ("billing_invoice_payments"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "billing_invoice_payments_date_format" CHECK ("billing_invoice_payments"."payment_date" ~ '^\d{4}-\d{2}-\d{2}$'),
	CONSTRAINT "billing_invoice_payments_amount_nonzero" CHECK ("billing_invoice_payments"."amount" <> 0),
	CONSTRAINT "billing_invoice_payments_confirmation_traced" CHECK (
    "billing_invoice_payments"."verification_status" <> 'confirmed'
    OR ("billing_invoice_payments"."confirmed_by" IS NOT NULL AND "billing_invoice_payments"."confirmed_at" IS NOT NULL)
  )
);
--> statement-breakpoint
CREATE TABLE "billing_invoices" (
	"id" text PRIMARY KEY NOT NULL,
	"direction" text NOT NULL,
	"doc_type" text NOT NULL,
	"folio" integer NOT NULL,
	"issuer_tax_id" text NOT NULL,
	"issuer_name" text NOT NULL,
	"receiver_tax_id" text NOT NULL,
	"receiver_name" text NOT NULL,
	"issue_date" text NOT NULL,
	"due_date" text,
	"due_date_source" text,
	"currency" text DEFAULT 'CLP' NOT NULL,
	"net_amount" numeric(14, 2),
	"tax_amount" numeric(14, 2),
	"exempt_amount" numeric(14, 2),
	"total_amount" numeric(14, 2) NOT NULL,
	"document_status" text DEFAULT 'unknown' NOT NULL,
	"payment_status" text DEFAULT 'unpaid' NOT NULL,
	"collection_status" text DEFAULT 'none' NOT NULL,
	"paid_amount" numeric(14, 2) DEFAULT 0 NOT NULL,
	"source" text NOT NULL,
	"source_last_synced_at" timestamp with time zone,
	"owner_user_id" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_invoices_direction_valid" CHECK ("billing_invoices"."direction" IN ('sale', 'purchase')),
	CONSTRAINT "billing_invoices_document_status_valid" CHECK ("billing_invoices"."document_status" IN ('issued', 'accepted', 'rejected', 'void', 'draft', 'unknown')),
	CONSTRAINT "billing_invoices_payment_status_valid" CHECK ("billing_invoices"."payment_status" IN ('unpaid', 'partial', 'paid', 'overpaid')),
	CONSTRAINT "billing_invoices_collection_status_valid" CHECK ("billing_invoices"."collection_status" IN ('none', 'in_progress', 'committed', 'disputed', 'closed', 'written_off')),
	CONSTRAINT "billing_invoices_due_date_source_valid" CHECK ("billing_invoices"."due_date_source" IS NULL OR "billing_invoices"."due_date_source" IN ('contract', 'client', 'provider', 'manual')),
	CONSTRAINT "billing_invoices_source_valid" CHECK ("billing_invoices"."source" IN ('factura_en_linea', 'chipax', 'manual')),
	CONSTRAINT "billing_invoices_currency_format" CHECK ("billing_invoices"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "billing_invoices_folio_positive" CHECK ("billing_invoices"."folio" > 0),
	CONSTRAINT "billing_invoices_dates_format" CHECK ("billing_invoices"."issue_date" ~ '^\d{4}-\d{2}-\d{2}$' AND ("billing_invoices"."due_date" IS NULL OR "billing_invoices"."due_date" ~ '^\d{4}-\d{2}-\d{2}$'))
);
--> statement-breakpoint
CREATE TABLE "billing_proposal_items" (
	"id" text PRIMARY KEY NOT NULL,
	"proposal_id" text NOT NULL,
	"description" text NOT NULL,
	"quantity" numeric(14, 4) DEFAULT 1 NOT NULL,
	"unit" text,
	"unit_price" numeric(14, 2) DEFAULT 0 NOT NULL,
	"net_amount" numeric(14, 2) DEFAULT 0 NOT NULL,
	"is_exempt" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_proposal_items_description_nonempty" CHECK (length("billing_proposal_items"."description") > 0),
	CONSTRAINT "billing_proposal_items_amounts_non_negative" CHECK ("billing_proposal_items"."quantity" >= 0 AND "billing_proposal_items"."unit_price" >= 0 AND "billing_proposal_items"."net_amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "billing_proposals" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"client_id" text NOT NULL,
	"contract_id" text,
	"worksite_id" text,
	"cost_center_id" text,
	"service_period" text NOT NULL,
	"service_from" text,
	"service_to" text,
	"currency" text DEFAULT 'CLP' NOT NULL,
	"estimated_net" numeric(14, 2) DEFAULT 0 NOT NULL,
	"estimated_tax" numeric(14, 2) DEFAULT 0 NOT NULL,
	"estimated_total" numeric(14, 2) DEFAULT 0 NOT NULL,
	"client_po_number" text,
	"missing_documents" text,
	"notes" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"owner_user_id" text,
	"submitted_by" text,
	"submitted_at" timestamp with time zone,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"approved_by" text,
	"approved_at" timestamp with time zone,
	"decision_reason" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_proposals_status_valid" CHECK ("billing_proposals"."status" IN ('draft', 'in_review', 'observed', 'approved', 'ready', 'invoiced', 'closed', 'rejected', 'cancelled')),
	CONSTRAINT "billing_proposals_period_format" CHECK ("billing_proposals"."service_period" ~ '^\d{4}-\d{2}$'),
	CONSTRAINT "billing_proposals_currency_format" CHECK ("billing_proposals"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "billing_proposals_amounts_non_negative" CHECK ("billing_proposals"."estimated_net" >= 0 AND "billing_proposals"."estimated_tax" >= 0 AND "billing_proposals"."estimated_total" >= 0),
	CONSTRAINT "billing_proposals_service_range_ordered" CHECK ("billing_proposals"."service_from" IS NULL OR "billing_proposals"."service_to" IS NULL OR "billing_proposals"."service_from" <= "billing_proposals"."service_to"),
	CONSTRAINT "billing_proposals_approval_traced" CHECK (
    "billing_proposals"."status" NOT IN ('approved', 'ready', 'invoiced', 'closed')
    OR ("billing_proposals"."approved_by" IS NOT NULL AND "billing_proposals"."approved_at" IS NOT NULL)
  )
);
--> statement-breakpoint
CREATE TABLE "billing_sync_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"scope" text NOT NULL,
	"trigger" text DEFAULT 'manual' NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"dry_run" boolean DEFAULT false NOT NULL,
	"period_from" text,
	"period_to" text,
	"cursor" text,
	"records_fetched" integer DEFAULT 0 NOT NULL,
	"records_created" integer DEFAULT 0 NOT NULL,
	"records_updated" integer DEFAULT 0 NOT NULL,
	"records_unchanged" integer DEFAULT 0 NOT NULL,
	"duplicates_detected" integer DEFAULT 0 NOT NULL,
	"conflicts_detected" integer DEFAULT 0 NOT NULL,
	"errors_count" integer DEFAULT 0 NOT NULL,
	"error_summary" text,
	"correlation_id" text NOT NULL,
	"triggered_by" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "billing_sync_runs_provider_valid" CHECK ("billing_sync_runs"."provider" IN ('factura_en_linea', 'chipax', 'manual')),
	CONSTRAINT "billing_sync_runs_scope_valid" CHECK ("billing_sync_runs"."scope" IN ('sales_invoices', 'purchase_invoices', 'bank_transactions')),
	CONSTRAINT "billing_sync_runs_trigger_valid" CHECK ("billing_sync_runs"."trigger" IN ('manual', 'cron', 'backfill')),
	CONSTRAINT "billing_sync_runs_status_valid" CHECK ("billing_sync_runs"."status" IN ('running', 'success', 'partial', 'failed', 'skipped'))
);
--> statement-breakpoint
ALTER TABLE "client_contacts" ADD CONSTRAINT "client_contacts_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_cost_center_id_cost_centers_id_fk" FOREIGN KEY ("cost_center_id") REFERENCES "public"."cost_centers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_collection_actions" ADD CONSTRAINT "billing_collection_actions_invoice_id_billing_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."billing_invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_collection_actions" ADD CONSTRAINT "billing_collection_actions_assignee_user_id_users_id_fk" FOREIGN KEY ("assignee_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_collection_actions" ADD CONSTRAINT "billing_collection_actions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_duplicate_candidates" ADD CONSTRAINT "billing_duplicate_candidates_invoice_id_billing_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."billing_invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_duplicate_candidates" ADD CONSTRAINT "billing_duplicate_candidates_other_invoice_id_billing_invoices_id_fk" FOREIGN KEY ("other_invoice_id") REFERENCES "public"."billing_invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_duplicate_candidates" ADD CONSTRAINT "billing_duplicate_candidates_merged_into_id_billing_invoices_id_fk" FOREIGN KEY ("merged_into_id") REFERENCES "public"."billing_invoices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_duplicate_candidates" ADD CONSTRAINT "billing_duplicate_candidates_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_external_refs" ADD CONSTRAINT "billing_external_refs_invoice_id_billing_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."billing_invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_invoice_events" ADD CONSTRAINT "billing_invoice_events_invoice_id_billing_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."billing_invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_invoice_events" ADD CONSTRAINT "billing_invoice_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_invoice_items" ADD CONSTRAINT "billing_invoice_items_invoice_id_billing_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."billing_invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_invoice_links" ADD CONSTRAINT "billing_invoice_links_invoice_id_billing_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."billing_invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_invoice_links" ADD CONSTRAINT "billing_invoice_links_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_invoice_links" ADD CONSTRAINT "billing_invoice_links_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_invoice_links" ADD CONSTRAINT "billing_invoice_links_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_invoice_links" ADD CONSTRAINT "billing_invoice_links_cost_center_id_cost_centers_id_fk" FOREIGN KEY ("cost_center_id") REFERENCES "public"."cost_centers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_invoice_links" ADD CONSTRAINT "billing_invoice_links_proposal_id_billing_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."billing_proposals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_invoice_links" ADD CONSTRAINT "billing_invoice_links_confirmed_by_users_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_invoice_links" ADD CONSTRAINT "billing_invoice_links_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_invoice_payments" ADD CONSTRAINT "billing_invoice_payments_invoice_id_billing_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."billing_invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_invoice_payments" ADD CONSTRAINT "billing_invoice_payments_bank_transaction_id_billing_bank_transactions_id_fk" FOREIGN KEY ("bank_transaction_id") REFERENCES "public"."billing_bank_transactions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_invoice_payments" ADD CONSTRAINT "billing_invoice_payments_confirmed_by_users_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_invoice_payments" ADD CONSTRAINT "billing_invoice_payments_rejected_by_users_id_fk" FOREIGN KEY ("rejected_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_invoice_payments" ADD CONSTRAINT "billing_invoice_payments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_invoices" ADD CONSTRAINT "billing_invoices_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_proposal_items" ADD CONSTRAINT "billing_proposal_items_proposal_id_billing_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."billing_proposals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_proposals" ADD CONSTRAINT "billing_proposals_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_proposals" ADD CONSTRAINT "billing_proposals_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_proposals" ADD CONSTRAINT "billing_proposals_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_proposals" ADD CONSTRAINT "billing_proposals_cost_center_id_cost_centers_id_fk" FOREIGN KEY ("cost_center_id") REFERENCES "public"."cost_centers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_proposals" ADD CONSTRAINT "billing_proposals_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_proposals" ADD CONSTRAINT "billing_proposals_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_proposals" ADD CONSTRAINT "billing_proposals_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_proposals" ADD CONSTRAINT "billing_proposals_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_proposals" ADD CONSTRAINT "billing_proposals_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_sync_runs" ADD CONSTRAINT "billing_sync_runs_triggered_by_users_id_fk" FOREIGN KEY ("triggered_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "client_contacts_client_idx" ON "client_contacts" USING btree ("client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "clients_rut_unique" ON "clients" USING btree ("rut");--> statement-breakpoint
CREATE INDEX "clients_name_idx" ON "clients" USING btree ("name");--> statement-breakpoint
CREATE INDEX "clients_active_idx" ON "clients" USING btree ("is_active") WHERE "clients"."is_active" = true;--> statement-breakpoint
CREATE UNIQUE INDEX "contracts_code_unique" ON "contracts" USING btree ("code");--> statement-breakpoint
CREATE INDEX "contracts_client_idx" ON "contracts" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "contracts_worksite_idx" ON "contracts" USING btree ("worksite_id");--> statement-breakpoint
CREATE INDEX "contracts_status_idx" ON "contracts" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_bank_tx_provider_external_unique" ON "billing_bank_transactions" USING btree ("provider","external_id");--> statement-breakpoint
CREATE INDEX "billing_bank_tx_date_idx" ON "billing_bank_transactions" USING btree ("transaction_date");--> statement-breakpoint
CREATE INDEX "billing_bank_tx_counterparty_idx" ON "billing_bank_transactions" USING btree ("counterparty_tax_id");--> statement-breakpoint
CREATE INDEX "billing_collection_actions_invoice_idx" ON "billing_collection_actions" USING btree ("invoice_id","action_date");--> statement-breakpoint
CREATE INDEX "billing_collection_actions_next_idx" ON "billing_collection_actions" USING btree ("next_action_date");--> statement-breakpoint
CREATE INDEX "billing_collection_actions_assignee_idx" ON "billing_collection_actions" USING btree ("assignee_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_duplicate_candidates_pair_unique" ON "billing_duplicate_candidates" USING btree ("invoice_id","other_invoice_id");--> statement-breakpoint
CREATE INDEX "billing_duplicate_candidates_status_idx" ON "billing_duplicate_candidates" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_external_refs_provider_external_unique" ON "billing_external_refs" USING btree ("provider","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_external_refs_invoice_provider_unique" ON "billing_external_refs" USING btree ("invoice_id","provider");--> statement-breakpoint
CREATE INDEX "billing_external_refs_hash_idx" ON "billing_external_refs" USING btree ("payload_hash");--> statement-breakpoint
CREATE INDEX "billing_invoice_events_invoice_idx" ON "billing_invoice_events" USING btree ("invoice_id","occurred_at");--> statement-breakpoint
CREATE INDEX "billing_invoice_items_invoice_idx" ON "billing_invoice_items" USING btree ("invoice_id","sort_order");--> statement-breakpoint
CREATE INDEX "billing_invoice_links_invoice_idx" ON "billing_invoice_links" USING btree ("invoice_id","status");--> statement-breakpoint
CREATE INDEX "billing_invoice_links_client_idx" ON "billing_invoice_links" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "billing_invoice_links_contract_period_idx" ON "billing_invoice_links" USING btree ("contract_id","service_period");--> statement-breakpoint
CREATE INDEX "billing_invoice_links_worksite_idx" ON "billing_invoice_links" USING btree ("worksite_id");--> statement-breakpoint
CREATE INDEX "billing_invoice_links_proposal_idx" ON "billing_invoice_links" USING btree ("proposal_id");--> statement-breakpoint
CREATE INDEX "billing_invoice_payments_invoice_idx" ON "billing_invoice_payments" USING btree ("invoice_id","verification_status");--> statement-breakpoint
CREATE INDEX "billing_invoice_payments_bank_tx_idx" ON "billing_invoice_payments" USING btree ("bank_transaction_id");--> statement-breakpoint
CREATE INDEX "billing_invoice_payments_date_idx" ON "billing_invoice_payments" USING btree ("payment_date");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_invoice_payments_invoice_bank_tx_unique" ON "billing_invoice_payments" USING btree ("invoice_id","bank_transaction_id");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_invoices_identity_unique" ON "billing_invoices" USING btree ("direction","doc_type","folio","issuer_tax_id","receiver_tax_id");--> statement-breakpoint
CREATE INDEX "billing_invoices_direction_issue_idx" ON "billing_invoices" USING btree ("direction","issue_date");--> statement-breakpoint
CREATE INDEX "billing_invoices_due_idx" ON "billing_invoices" USING btree ("due_date");--> statement-breakpoint
CREATE INDEX "billing_invoices_payment_status_idx" ON "billing_invoices" USING btree ("payment_status");--> statement-breakpoint
CREATE INDEX "billing_invoices_collection_status_idx" ON "billing_invoices" USING btree ("collection_status");--> statement-breakpoint
CREATE INDEX "billing_invoices_receiver_idx" ON "billing_invoices" USING btree ("receiver_tax_id");--> statement-breakpoint
CREATE INDEX "billing_invoices_issuer_idx" ON "billing_invoices" USING btree ("issuer_tax_id");--> statement-breakpoint
CREATE INDEX "billing_invoices_owner_idx" ON "billing_invoices" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "billing_proposal_items_proposal_idx" ON "billing_proposal_items" USING btree ("proposal_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_proposals_code_unique" ON "billing_proposals" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_proposals_contract_period_unique" ON "billing_proposals" USING btree ("contract_id","service_period") WHERE "billing_proposals"."status" NOT IN ('rejected', 'cancelled');--> statement-breakpoint
CREATE INDEX "billing_proposals_client_period_idx" ON "billing_proposals" USING btree ("client_id","service_period");--> statement-breakpoint
CREATE INDEX "billing_proposals_status_idx" ON "billing_proposals" USING btree ("status");--> statement-breakpoint
CREATE INDEX "billing_proposals_worksite_idx" ON "billing_proposals" USING btree ("worksite_id");--> statement-breakpoint
CREATE INDEX "billing_proposals_owner_idx" ON "billing_proposals" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "billing_sync_runs_provider_scope_idx" ON "billing_sync_runs" USING btree ("provider","scope","started_at");--> statement-breakpoint
CREATE INDEX "billing_sync_runs_status_idx" ON "billing_sync_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "billing_sync_runs_correlation_idx" ON "billing_sync_runs" USING btree ("correlation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_sync_runs_single_active_unique" ON "billing_sync_runs" USING btree ("provider","scope","period_from") WHERE "billing_sync_runs"."status" = 'running';