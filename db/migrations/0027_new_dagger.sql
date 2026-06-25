CREATE TABLE "fuel_vehicles" (
	"id" text PRIMARY KEY NOT NULL,
	"plate" text NOT NULL,
	"type" text NOT NULL,
	"brand" text,
	"model" text,
	"year" integer,
	"worksite_id" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fuel_vehicles_plate_unique" UNIQUE("plate")
);
--> statement-breakpoint
CREATE TABLE "fuel_suppliers" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"rut" text,
	"contact_name" text,
	"phone" text,
	"email" text,
	"notes" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fuel_suppliers_rut_unique" UNIQUE("rut")
);
--> statement-breakpoint
CREATE TABLE "fuel_loads" (
	"id" text PRIMARY KEY NOT NULL,
	"statement_id" text,
	"load_date" text NOT NULL,
	"month" text NOT NULL,
	"service_type" text NOT NULL,
	"vehicle_id" text NOT NULL,
	"fuel_supplier_id" text NOT NULL,
	"worksite_id" text NOT NULL,
	"product" text NOT NULL,
	"receipt_number" text,
	"liters" numeric(12, 4) NOT NULL,
	"iec_fixed" numeric(14, 2) DEFAULT 0 NOT NULL,
	"iec_variable" numeric(14, 2) DEFAULT 0 NOT NULL,
	"base_amount" numeric(14, 2) NOT NULL,
	"iec_total" numeric(14, 2) DEFAULT 0 NOT NULL,
	"iva_amount" numeric(14, 2) DEFAULT 0 NOT NULL,
	"total_amount" numeric(14, 2) NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"notes" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fuel_loads_status_valid" CHECK (
    "fuel_loads"."status" IN ('draft', 'registered', 'reconciled', 'cancelled')
  ),
	CONSTRAINT "fuel_loads_service_type_valid" CHECK (
    "fuel_loads"."service_type" IN ('TCT', 'TAE')
  ),
	CONSTRAINT "fuel_loads_liters_positive" CHECK ("fuel_loads"."liters" >= 0)
);
--> statement-breakpoint
CREATE TABLE "fuel_monthly_statements" (
	"id" text PRIMARY KEY NOT NULL,
	"month" text NOT NULL,
	"fuel_supplier_id" text NOT NULL,
	"total_liters" numeric(14, 4) DEFAULT 0 NOT NULL,
	"total_base_amount" numeric(14, 2) DEFAULT 0 NOT NULL,
	"total_iec" numeric(14, 2) DEFAULT 0 NOT NULL,
	"total_iva" numeric(14, 2) DEFAULT 0 NOT NULL,
	"total_amount" numeric(14, 2) DEFAULT 0 NOT NULL,
	"paid_amount" numeric(14, 2) DEFAULT 0 NOT NULL,
	"due_date" text,
	"status" text DEFAULT 'open' NOT NULL,
	"notes" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fuel_statements_status_valid" CHECK (
    "fuel_monthly_statements"."status" IN ('open', 'partial', 'paid', 'overdue', 'cancelled')
  )
);
--> statement-breakpoint
CREATE TABLE "fuel_payments" (
	"id" text PRIMARY KEY NOT NULL,
	"statement_id" text NOT NULL,
	"payment_date" text NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"payment_method" text,
	"reference" text,
	"notes" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fuel_payments_amount_positive" CHECK ("fuel_payments"."amount" > 0)
);
--> statement-breakpoint
ALTER TABLE "fuel_vehicles" ADD CONSTRAINT "fuel_vehicles_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_loads" ADD CONSTRAINT "fuel_loads_vehicle_id_fuel_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."fuel_vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_loads" ADD CONSTRAINT "fuel_loads_fuel_supplier_id_fuel_suppliers_id_fk" FOREIGN KEY ("fuel_supplier_id") REFERENCES "public"."fuel_suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_loads" ADD CONSTRAINT "fuel_loads_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_loads" ADD CONSTRAINT "fuel_loads_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_monthly_statements" ADD CONSTRAINT "fuel_monthly_statements_fuel_supplier_id_fuel_suppliers_id_fk" FOREIGN KEY ("fuel_supplier_id") REFERENCES "public"."fuel_suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_monthly_statements" ADD CONSTRAINT "fuel_monthly_statements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_payments" ADD CONSTRAINT "fuel_payments_statement_id_fuel_monthly_statements_id_fk" FOREIGN KEY ("statement_id") REFERENCES "public"."fuel_monthly_statements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_payments" ADD CONSTRAINT "fuel_payments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fuel_vehicles_worksite_idx" ON "fuel_vehicles" USING btree ("worksite_id");--> statement-breakpoint
CREATE INDEX "fuel_vehicles_type_idx" ON "fuel_vehicles" USING btree ("type");--> statement-breakpoint
CREATE INDEX "fuel_loads_month_idx" ON "fuel_loads" USING btree ("month");--> statement-breakpoint
CREATE INDEX "fuel_loads_vehicle_idx" ON "fuel_loads" USING btree ("vehicle_id");--> statement-breakpoint
CREATE INDEX "fuel_loads_worksite_idx" ON "fuel_loads" USING btree ("worksite_id");--> statement-breakpoint
CREATE INDEX "fuel_loads_supplier_idx" ON "fuel_loads" USING btree ("fuel_supplier_id");--> statement-breakpoint
CREATE INDEX "fuel_loads_statement_idx" ON "fuel_loads" USING btree ("statement_id");--> statement-breakpoint
CREATE INDEX "fuel_loads_status_idx" ON "fuel_loads" USING btree ("status");--> statement-breakpoint
CREATE INDEX "fuel_statements_month_supplier_idx" ON "fuel_monthly_statements" USING btree ("month","fuel_supplier_id");--> statement-breakpoint
CREATE INDEX "fuel_statements_status_idx" ON "fuel_monthly_statements" USING btree ("status");--> statement-breakpoint
CREATE INDEX "fuel_payments_statement_idx" ON "fuel_payments" USING btree ("statement_id");