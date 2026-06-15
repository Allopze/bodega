CREATE TABLE "purchase_order_invoices" (
	"id" text PRIMARY KEY NOT NULL,
	"purchase_order_id" text NOT NULL,
	"invoice_number" text NOT NULL,
	"amount" numeric(12, 2) DEFAULT 0 NOT NULL,
	"issue_date" text,
	"file_name" text NOT NULL,
	"file_path" text NOT NULL,
	"file_size" integer,
	"mime_type" text,
	"uploaded_by" text NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_order_invoices_amount_non_negative" CHECK ("purchase_order_invoices"."amount" >= 0)
);
--> statement-breakpoint
ALTER TABLE "purchase_order_invoices" ADD CONSTRAINT "purchase_order_invoices_purchase_order_id_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_invoices" ADD CONSTRAINT "purchase_order_invoices_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;