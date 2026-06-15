CREATE TABLE "repuesto_quotations" (
	"id" text PRIMARY KEY NOT NULL,
	"request_id" text NOT NULL,
	"supplier_id" text,
	"supplier_name_free" text,
	"file_name" text NOT NULL,
	"file_path" text NOT NULL,
	"file_size" text,
	"total_amount" numeric(12, 2) NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"notes" text,
	"decided_by" text,
	"selected_at" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "repuesto_quotations_status_valid" CHECK (
    "repuesto_quotations"."status" IN ('pending', 'selected', 'rejected')
  )
);
--> statement-breakpoint
ALTER TABLE "purchase_requests" DROP CONSTRAINT "purchase_requests_type_urgency_status_valid";--> statement-breakpoint
ALTER TABLE "repuesto_quotations" ADD CONSTRAINT "repuesto_quotations_request_id_purchase_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."purchase_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repuesto_quotations" ADD CONSTRAINT "repuesto_quotations_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repuesto_quotations" ADD CONSTRAINT "repuesto_quotations_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_type_urgency_status_valid" CHECK (
    "purchase_requests"."request_type" IN ('epp', 'stock', 'mantencion', 'otro', 'repuestos')
    AND "purchase_requests"."urgency" IN ('normal', 'high', 'critical')
    AND "purchase_requests"."status" IN (
      'draft', 'submitted', 'in_review', 'partially_approved', 'approved',
      'rejected', 'returned', 'in_purchasing', 'closed', 'cancelled'
    )
  );