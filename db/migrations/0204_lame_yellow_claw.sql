CREATE TABLE "maintenance_document_policies" (
	"id" text PRIMARY KEY NOT NULL,
	"equipment_type_id" text NOT NULL,
	"document_type" text NOT NULL,
	"required_at" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "maintenance_document_policies_required_at_valid" CHECK ("maintenance_document_policies"."required_at" IN ('before_start', 'before_complete'))
);
--> statement-breakpoint
CREATE TABLE "maintenance_documents" (
	"id" text PRIMARY KEY NOT NULL,
	"maintenance_id" text NOT NULL,
	"document_type" text NOT NULL,
	"file_name" text NOT NULL,
	"file_path" text NOT NULL,
	"file_size" integer,
	"mime_type" text,
	"status" text DEFAULT 'current' NOT NULL,
	"superseded_at" timestamp with time zone,
	"superseded_by" text,
	"uploaded_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "maintenance_documents_status_valid" CHECK ("maintenance_documents"."status" IN ('current', 'replaced'))
);
--> statement-breakpoint
CREATE TABLE "maintenance_labor" (
	"id" text PRIMARY KEY NOT NULL,
	"maintenance_id" text NOT NULL,
	"description" text NOT NULL,
	"hours" numeric(10, 2) NOT NULL,
	"hourly_rate" numeric(14, 2) DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "maintenance_labor_values_positive" CHECK ("maintenance_labor"."hours" > 0 AND "maintenance_labor"."hourly_rate" >= 0)
);
--> statement-breakpoint
CREATE TABLE "maintenance_parts" (
	"id" text PRIMARY KEY NOT NULL,
	"maintenance_id" text NOT NULL,
	"description" text NOT NULL,
	"part_number" text,
	"quantity" numeric(12, 3) NOT NULL,
	"unit" text DEFAULT 'un' NOT NULL,
	"unit_cost" numeric(14, 2) DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "maintenance_parts_values_positive" CHECK ("maintenance_parts"."quantity" > 0 AND "maintenance_parts"."unit_cost" >= 0)
);
--> statement-breakpoint
CREATE TABLE "maintenance_plans" (
	"id" text PRIMARY KEY NOT NULL,
	"vehicle_id" text NOT NULL,
	"worksite_id" text NOT NULL,
	"name" text NOT NULL,
	"maintenance_type" text NOT NULL,
	"strategy" text NOT NULL,
	"interval_days" integer,
	"interval_units" numeric(12, 2),
	"advance_days" integer DEFAULT 7 NOT NULL,
	"advance_units" numeric(12, 2) DEFAULT 100 NOT NULL,
	"next_due_date" text,
	"next_due_reading" numeric(12, 2),
	"assigned_to_user_id" text,
	"supplier_id" text,
	"cost_center_id" text,
	"instructions" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "maintenance_plans_strategy_valid" CHECK ("maintenance_plans"."strategy" IN ('calendar', 'odometer', 'hour_meter', 'combined')),
	CONSTRAINT "maintenance_plans_interval_valid" CHECK (
    ("maintenance_plans"."strategy" IN ('calendar', 'combined') AND "maintenance_plans"."interval_days" > 0 OR "maintenance_plans"."strategy" NOT IN ('calendar', 'combined') AND "maintenance_plans"."interval_days" IS NULL)
    AND ("maintenance_plans"."strategy" IN ('odometer', 'hour_meter', 'combined') AND "maintenance_plans"."interval_units" > 0 OR "maintenance_plans"."strategy" NOT IN ('odometer', 'hour_meter', 'combined') AND "maintenance_plans"."interval_units" IS NULL)
  ),
	CONSTRAINT "maintenance_plans_advance_nonnegative" CHECK ("maintenance_plans"."advance_days" >= 0 AND "maintenance_plans"."advance_units" >= 0),
	CONSTRAINT "maintenance_plans_version_positive" CHECK ("maintenance_plans"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "maintenance_tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"maintenance_id" text NOT NULL,
	"description" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"completed_by" text,
	"completed_at" timestamp with time zone,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "maintenance_tasks_status_valid" CHECK ("maintenance_tasks"."status" IN ('pending', 'completed', 'cancelled')),
	CONSTRAINT "maintenance_tasks_completion_consistent" CHECK ("maintenance_tasks"."status" <> 'completed' OR ("maintenance_tasks"."completed_by" IS NOT NULL AND "maintenance_tasks"."completed_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "maintenance_records" ADD COLUMN "code" text;--> statement-breakpoint
ALTER TABLE "maintenance_records" ADD COLUMN "plan_id" text;--> statement-breakpoint
ALTER TABLE "maintenance_records" ADD COLUMN "priority" text DEFAULT 'normal' NOT NULL;--> statement-breakpoint
ALTER TABLE "maintenance_records" ADD COLUMN "assigned_to_user_id" text;--> statement-breakpoint
ALTER TABLE "maintenance_records" ADD COLUMN "sla_due_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "maintenance_records" ADD COLUMN "started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "maintenance_records" ADD COLUMN "completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "maintenance_records" ADD COLUMN "cancelled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "maintenance_records" ADD COLUMN "cancellation_reason" text;--> statement-breakpoint
ALTER TABLE "maintenance_records" ADD COLUMN "downtime_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "maintenance_records" ADD COLUMN "downtime_ended_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "maintenance_records" ADD COLUMN "root_cause" text;--> statement-breakpoint
ALTER TABLE "maintenance_records" ADD COLUMN "under_warranty" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "maintenance_records" ADD COLUMN "cost_approval_status" text DEFAULT 'not_required' NOT NULL;--> statement-breakpoint
ALTER TABLE "maintenance_records" ADD COLUMN "cost_approved_by_user_id" text;--> statement-breakpoint
ALTER TABLE "maintenance_records" ADD COLUMN "cost_approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "maintenance_records" ADD COLUMN "operational_impact" text DEFAULT 'maintenance' NOT NULL;--> statement-breakpoint
ALTER TABLE "maintenance_records" ADD COLUMN "manages_operational_status" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "maintenance_records" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
UPDATE "maintenance_records"
SET
	"cancelled_at" = COALESCE("cancelled_at", "updated_at", "created_at", now()),
	"cancellation_reason" = CASE
		WHEN length(trim(COALESCE("cancellation_reason", ''))) >= 5 THEN "cancellation_reason"
		ELSE 'Cancelación histórica migrada'
	END
WHERE "status" = 'cancelled'
	AND ("cancelled_at" IS NULL OR length(trim(COALESCE("cancellation_reason", ''))) < 5);--> statement-breakpoint
ALTER TABLE "maintenance_document_policies" ADD CONSTRAINT "maintenance_document_policies_equipment_type_id_fuel_equipment_types_id_fk" FOREIGN KEY ("equipment_type_id") REFERENCES "public"."fuel_equipment_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_document_policies" ADD CONSTRAINT "maintenance_document_policies_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_documents" ADD CONSTRAINT "maintenance_documents_maintenance_id_maintenance_records_id_fk" FOREIGN KEY ("maintenance_id") REFERENCES "public"."maintenance_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_documents" ADD CONSTRAINT "maintenance_documents_superseded_by_maintenance_documents_id_fk" FOREIGN KEY ("superseded_by") REFERENCES "public"."maintenance_documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_documents" ADD CONSTRAINT "maintenance_documents_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_labor" ADD CONSTRAINT "maintenance_labor_maintenance_id_maintenance_records_id_fk" FOREIGN KEY ("maintenance_id") REFERENCES "public"."maintenance_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_parts" ADD CONSTRAINT "maintenance_parts_maintenance_id_maintenance_records_id_fk" FOREIGN KEY ("maintenance_id") REFERENCES "public"."maintenance_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_plans" ADD CONSTRAINT "maintenance_plans_vehicle_id_fuel_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."fuel_vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_plans" ADD CONSTRAINT "maintenance_plans_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_plans" ADD CONSTRAINT "maintenance_plans_assigned_to_user_id_users_id_fk" FOREIGN KEY ("assigned_to_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_plans" ADD CONSTRAINT "maintenance_plans_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_plans" ADD CONSTRAINT "maintenance_plans_cost_center_id_cost_centers_id_fk" FOREIGN KEY ("cost_center_id") REFERENCES "public"."cost_centers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_plans" ADD CONSTRAINT "maintenance_plans_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_plans" ADD CONSTRAINT "maintenance_plans_vehicle_worksite_fk" FOREIGN KEY ("vehicle_id","worksite_id") REFERENCES "public"."fuel_vehicles"("id","worksite_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "maintenance_tasks" ADD CONSTRAINT "maintenance_tasks_maintenance_id_maintenance_records_id_fk" FOREIGN KEY ("maintenance_id") REFERENCES "public"."maintenance_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_tasks" ADD CONSTRAINT "maintenance_tasks_completed_by_users_id_fk" FOREIGN KEY ("completed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "maintenance_document_policies_unique" ON "maintenance_document_policies" USING btree ("equipment_type_id","document_type","required_at");--> statement-breakpoint
CREATE INDEX "maintenance_document_policies_active_idx" ON "maintenance_document_policies" USING btree ("equipment_type_id","is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "maintenance_documents_current_unique" ON "maintenance_documents" USING btree ("maintenance_id","document_type") WHERE "maintenance_documents"."status" = 'current';--> statement-breakpoint
CREATE INDEX "maintenance_documents_maintenance_idx" ON "maintenance_documents" USING btree ("maintenance_id","created_at");--> statement-breakpoint
CREATE INDEX "maintenance_labor_maintenance_idx" ON "maintenance_labor" USING btree ("maintenance_id");--> statement-breakpoint
CREATE INDEX "maintenance_parts_maintenance_idx" ON "maintenance_parts" USING btree ("maintenance_id");--> statement-breakpoint
CREATE INDEX "maintenance_plans_vehicle_active_idx" ON "maintenance_plans" USING btree ("vehicle_id","is_active");--> statement-breakpoint
CREATE INDEX "maintenance_plans_worksite_active_idx" ON "maintenance_plans" USING btree ("worksite_id","is_active");--> statement-breakpoint
CREATE INDEX "maintenance_plans_due_date_idx" ON "maintenance_plans" USING btree ("next_due_date","is_active");--> statement-breakpoint
CREATE INDEX "maintenance_tasks_order_idx" ON "maintenance_tasks" USING btree ("maintenance_id","sort_order");--> statement-breakpoint
ALTER TABLE "maintenance_records" ADD CONSTRAINT "maintenance_records_plan_id_maintenance_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."maintenance_plans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_records" ADD CONSTRAINT "maintenance_records_assigned_to_user_id_users_id_fk" FOREIGN KEY ("assigned_to_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_records" ADD CONSTRAINT "maintenance_records_cost_approved_by_user_id_users_id_fk" FOREIGN KEY ("cost_approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "maintenance_records_plan_idx" ON "maintenance_records" USING btree ("plan_id","status");--> statement-breakpoint
CREATE INDEX "maintenance_records_assignee_sla_idx" ON "maintenance_records" USING btree ("assigned_to_user_id","sla_due_at","status");--> statement-breakpoint
CREATE UNIQUE INDEX "maintenance_record_plan_due_unique" ON "maintenance_records" USING btree ("plan_id","maintenance_date") WHERE "maintenance_records"."plan_id" IS NOT NULL AND "maintenance_records"."status" <> 'cancelled';--> statement-breakpoint
ALTER TABLE "maintenance_records" ADD CONSTRAINT "maintenance_records_code_unique" UNIQUE("code");--> statement-breakpoint
ALTER TABLE "maintenance_records" ADD CONSTRAINT "maintenance_records_priority_valid" CHECK ("maintenance_records"."priority" IN ('low', 'normal', 'high', 'critical'));--> statement-breakpoint
ALTER TABLE "maintenance_records" ADD CONSTRAINT "maintenance_records_cost_approval_valid" CHECK ("maintenance_records"."cost_approval_status" IN ('not_required', 'pending', 'approved', 'rejected'));--> statement-breakpoint
ALTER TABLE "maintenance_records" ADD CONSTRAINT "maintenance_records_operational_impact_valid" CHECK ("maintenance_records"."operational_impact" IN ('none', 'maintenance', 'out_of_service'));--> statement-breakpoint
ALTER TABLE "maintenance_records" ADD CONSTRAINT "maintenance_records_cancel_consistent" CHECK ("maintenance_records"."status" <> 'cancelled' OR ("maintenance_records"."cancelled_at" IS NOT NULL AND length("maintenance_records"."cancellation_reason") >= 5));--> statement-breakpoint
ALTER TABLE "maintenance_records" ADD CONSTRAINT "maintenance_records_dates_valid" CHECK ("maintenance_records"."downtime_ended_at" IS NULL OR ("maintenance_records"."downtime_started_at" IS NOT NULL AND "maintenance_records"."downtime_ended_at" > "maintenance_records"."downtime_started_at"));--> statement-breakpoint
ALTER TABLE "maintenance_records" ADD CONSTRAINT "maintenance_records_version_positive" CHECK ("maintenance_records"."version" >= 1);
