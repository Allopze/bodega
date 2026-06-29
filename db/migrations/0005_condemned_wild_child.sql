CREATE TABLE "physical_inventory_count_items" (
	"id" text PRIMARY KEY NOT NULL,
	"count_id" text NOT NULL,
	"product_id" text NOT NULL,
	"expected_quantity" real DEFAULT 0 NOT NULL,
	"counted_quantity" real DEFAULT 0 NOT NULL,
	"difference" real DEFAULT 0 NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "physical_inventory_counts" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"worksite_id" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"counted_by" text NOT NULL,
	"closed_by" text,
	"closed_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "physical_inventory_counts_code_unique" UNIQUE("code"),
	CONSTRAINT "physical_inventory_counts_status_valid" CHECK ("physical_inventory_counts"."status" IN ('draft', 'closed', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "fleet_vehicle_documents" (
	"id" text PRIMARY KEY NOT NULL,
	"vehicle_id" text NOT NULL,
	"document_type" text NOT NULL,
	"file_name" text NOT NULL,
	"file_path" text NOT NULL,
	"file_size" integer,
	"mime_type" text,
	"expires_at" text,
	"uploaded_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "receiver_rut" text;--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "signed_proof_file_name" text;--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "signed_proof_path" text;--> statement-breakpoint
ALTER TABLE "feedback_reports" ADD COLUMN "priority" text DEFAULT 'normal' NOT NULL;--> statement-breakpoint
ALTER TABLE "feedback_reports" ADD COLUMN "due_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "fuel_vehicles" ADD COLUMN "responsible_user_id" text;--> statement-breakpoint
ALTER TABLE "fuel_vehicles" ADD COLUMN "operational_status" text DEFAULT 'operativo' NOT NULL;--> statement-breakpoint
ALTER TABLE "fuel_vehicles" ADD COLUMN "soap_expires_at" text;--> statement-breakpoint
ALTER TABLE "fuel_vehicles" ADD COLUMN "technical_review_expires_at" text;--> statement-breakpoint
ALTER TABLE "fuel_vehicles" ADD COLUMN "circulation_permit_expires_at" text;--> statement-breakpoint
ALTER TABLE "fuel_vehicles" ADD COLUMN "insurance_policy_number" text;--> statement-breakpoint
ALTER TABLE "fuel_vehicles" ADD COLUMN "insurance_expires_at" text;--> statement-breakpoint
ALTER TABLE "physical_inventory_count_items" ADD CONSTRAINT "physical_inventory_count_items_count_id_physical_inventory_counts_id_fk" FOREIGN KEY ("count_id") REFERENCES "public"."physical_inventory_counts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "physical_inventory_count_items" ADD CONSTRAINT "physical_inventory_count_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "physical_inventory_counts" ADD CONSTRAINT "physical_inventory_counts_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "physical_inventory_counts" ADD CONSTRAINT "physical_inventory_counts_counted_by_users_id_fk" FOREIGN KEY ("counted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "physical_inventory_counts" ADD CONSTRAINT "physical_inventory_counts_closed_by_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_vehicle_documents" ADD CONSTRAINT "fleet_vehicle_documents_vehicle_id_fuel_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."fuel_vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_vehicle_documents" ADD CONSTRAINT "fleet_vehicle_documents_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "physical_inventory_count_items_unique" ON "physical_inventory_count_items" USING btree ("count_id","product_id");--> statement-breakpoint
CREATE INDEX "physical_inventory_counts_worksite_status_idx" ON "physical_inventory_counts" USING btree ("worksite_id","status");--> statement-breakpoint
CREATE INDEX "fleet_vehicle_documents_vehicle_idx" ON "fleet_vehicle_documents" USING btree ("vehicle_id");--> statement-breakpoint
CREATE INDEX "fleet_vehicle_documents_expires_idx" ON "fleet_vehicle_documents" USING btree ("expires_at");--> statement-breakpoint
ALTER TABLE "fuel_vehicles" ADD CONSTRAINT "fuel_vehicles_responsible_user_id_users_id_fk" FOREIGN KEY ("responsible_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fuel_vehicles_responsible_idx" ON "fuel_vehicles" USING btree ("responsible_user_id");--> statement-breakpoint
CREATE INDEX "fuel_vehicles_status_idx" ON "fuel_vehicles" USING btree ("operational_status");--> statement-breakpoint
ALTER TABLE "feedback_reports" ADD CONSTRAINT "feedback_reports_priority_valid" CHECK ("feedback_reports"."priority" IN ('baja', 'normal', 'alta', 'critica'));