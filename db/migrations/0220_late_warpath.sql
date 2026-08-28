CREATE TABLE "prevention_emergency_resource_assignments" (
	"id" text PRIMARY KEY NOT NULL,
	"point_id" text NOT NULL,
	"resource_id" text NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"unassigned_at" timestamp with time zone,
	"reason" text,
	"actor_user_id" text,
	CONSTRAINT "prevention_emergency_resource_assignment_dates_valid" CHECK ("prevention_emergency_resource_assignments"."unassigned_at" IS NULL OR "prevention_emergency_resource_assignments"."unassigned_at" >= "prevention_emergency_resource_assignments"."assigned_at")
);
--> statement-breakpoint
CREATE TABLE "prevention_emergency_resource_events" (
	"id" text PRIMARY KEY NOT NULL,
	"worksite_id" text NOT NULL,
	"resource_id" text NOT NULL,
	"event_type" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_user_id" text,
	"source_type" text,
	"source_id" text,
	"notes" text,
	"snapshot" jsonb,
	CONSTRAINT "prevention_emergency_resource_event_type_valid" CHECK ("prevention_emergency_resource_events"."event_type" IN ('used', 'service_requested', 'service_completed', 'reassigned', 'retired', 'imported', 'classified'))
);
--> statement-breakpoint
CREATE TABLE "prevention_emergency_resource_import_batches" (
	"id" text PRIMARY KEY NOT NULL,
	"worksite_id" text NOT NULL,
	"file_name" text NOT NULL,
	"file_fingerprint" text NOT NULL,
	"file_size" integer NOT NULL,
	"status" text DEFAULT 'applied' NOT NULL,
	"summary" jsonb NOT NULL,
	"snapshots" jsonb NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"rolled_back_at" timestamp with time zone,
	CONSTRAINT "prevention_emergency_resource_import_status_valid" CHECK ("prevention_emergency_resource_import_batches"."status" IN ('applied', 'superseded', 'rolled_back')),
	CONSTRAINT "prevention_emergency_resource_import_size_valid" CHECK ("prevention_emergency_resource_import_batches"."file_size" >= 0)
);
--> statement-breakpoint
CREATE TABLE "prevention_emergency_resource_points" (
	"id" text PRIMARY KEY NOT NULL,
	"worksite_id" text NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"point_kind" text NOT NULL,
	"vehicle_id" text,
	"fixed_location" text,
	"required_type_id" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prevention_emergency_resource_point_kind_valid" CHECK ("prevention_emergency_resource_points"."point_kind" IN ('vehicle', 'fixed')),
	CONSTRAINT "prevention_emergency_resource_point_target_valid" CHECK (
    ("prevention_emergency_resource_points"."point_kind" = 'vehicle' AND "prevention_emergency_resource_points"."vehicle_id" IS NOT NULL AND "prevention_emergency_resource_points"."fixed_location" IS NULL)
    OR ("prevention_emergency_resource_points"."point_kind" = 'fixed' AND "prevention_emergency_resource_points"."vehicle_id" IS NULL AND "prevention_emergency_resource_points"."fixed_location" IS NOT NULL)
  ),
	CONSTRAINT "prevention_emergency_resource_point_version_positive" CHECK ("prevention_emergency_resource_points"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "prevention_emergency_resource_types" (
	"id" text PRIMARY KEY NOT NULL,
	"resource_class" text NOT NULL,
	"agent" text,
	"capacity" numeric(10, 3),
	"capacity_unit" text,
	"canonical_name" text NOT NULL,
	"service_product_id" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prevention_emergency_resource_type_class_valid" CHECK ("prevention_emergency_resource_types"."resource_class" IN ('extinguisher', 'first_aid_kit', 'spill_kit', 'stretcher', 'defibrillator', 'other')),
	CONSTRAINT "prevention_emergency_resource_type_capacity_positive" CHECK ("prevention_emergency_resource_types"."capacity" IS NULL OR "prevention_emergency_resource_types"."capacity" > 0),
	CONSTRAINT "prevention_emergency_resource_type_extinguisher_complete" CHECK ("prevention_emergency_resource_types"."resource_class" <> 'extinguisher' OR ("prevention_emergency_resource_types"."agent" IS NOT NULL AND "prevention_emergency_resource_types"."capacity" IS NOT NULL AND "prevention_emergency_resource_types"."capacity_unit" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "prevention_emergency_resource_service_cases" (
	"id" text PRIMARY KEY NOT NULL,
	"resource_id" text NOT NULL,
	"previous_point_id" text,
	"request_item_id" text NOT NULL,
	"completed_receipt_item_id" text,
	"status" text DEFAULT 'open' NOT NULL,
	"opened_by_user_id" text NOT NULL,
	"completed_by_user_id" text,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "prevention_emergency_resource_service_case_status_valid" CHECK ("prevention_emergency_resource_service_cases"."status" IN ('open', 'completed', 'cancelled')),
	CONSTRAINT "prevention_emergency_resource_service_case_completion_valid" CHECK (
    ("prevention_emergency_resource_service_cases"."status" = 'completed' AND "prevention_emergency_resource_service_cases"."completed_at" IS NOT NULL AND "prevention_emergency_resource_service_cases"."completed_receipt_item_id" IS NOT NULL)
    OR ("prevention_emergency_resource_service_cases"."status" <> 'completed' AND "prevention_emergency_resource_service_cases"."completed_at" IS NULL)
  )
);
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "service_subject_kind" text;--> statement-breakpoint
ALTER TABLE "purchase_request_items" ADD COLUMN "emergency_resource_id" text;--> statement-breakpoint
ALTER TABLE "pdtp_execution_checklists" ADD COLUMN "subject_resource_id" text;--> statement-breakpoint
ALTER TABLE "prevention_emergency_resources" ADD COLUMN "asset_code" text;--> statement-breakpoint
ALTER TABLE "prevention_emergency_resources" ADD COLUMN "type_id" text;--> statement-breakpoint
ALTER TABLE "prevention_emergency_resources" ADD COLUMN "last_maintenance_at" text;--> statement-breakpoint
ALTER TABLE "prevention_emergency_resources" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
-- 0219 agregó esta columna mediante SQL custom y no produjo snapshot Drizzle.
-- IF NOT EXISTS mantiene esta migración compatible con la cadena real.
ALTER TABLE "dte_documents" ADD COLUMN IF NOT EXISTS "referenced_order_codes" text;--> statement-breakpoint
ALTER TABLE "prevention_emergency_resource_assignments" ADD CONSTRAINT "prevention_emergency_resource_assignments_point_id_prevention_emergency_resource_points_id_fk" FOREIGN KEY ("point_id") REFERENCES "public"."prevention_emergency_resource_points"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_emergency_resource_assignments" ADD CONSTRAINT "prevention_emergency_resource_assignments_resource_id_prevention_emergency_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."prevention_emergency_resources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_emergency_resource_assignments" ADD CONSTRAINT "prevention_emergency_resource_assignments_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_emergency_resource_events" ADD CONSTRAINT "prevention_emergency_resource_events_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_emergency_resource_events" ADD CONSTRAINT "prevention_emergency_resource_events_resource_id_prevention_emergency_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."prevention_emergency_resources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_emergency_resource_events" ADD CONSTRAINT "prevention_emergency_resource_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_emergency_resource_import_batches" ADD CONSTRAINT "prevention_emergency_resource_import_batches_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_emergency_resource_import_batches" ADD CONSTRAINT "prevention_emergency_resource_import_batches_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_emergency_resource_points" ADD CONSTRAINT "prevention_emergency_resource_points_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_emergency_resource_points" ADD CONSTRAINT "prevention_emergency_resource_points_vehicle_id_fuel_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."fuel_vehicles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_emergency_resource_points" ADD CONSTRAINT "prevention_emergency_resource_points_required_type_id_prevention_emergency_resource_types_id_fk" FOREIGN KEY ("required_type_id") REFERENCES "public"."prevention_emergency_resource_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_emergency_resource_types" ADD CONSTRAINT "prevention_emergency_resource_types_service_product_id_products_id_fk" FOREIGN KEY ("service_product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_emergency_resource_service_cases" ADD CONSTRAINT "prevention_emergency_resource_service_cases_resource_id_prevention_emergency_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."prevention_emergency_resources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_emergency_resource_service_cases" ADD CONSTRAINT "prevention_emergency_resource_service_cases_previous_point_id_prevention_emergency_resource_points_id_fk" FOREIGN KEY ("previous_point_id") REFERENCES "public"."prevention_emergency_resource_points"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_emergency_resource_service_cases" ADD CONSTRAINT "prevention_emergency_resource_service_cases_request_item_id_purchase_request_items_id_fk" FOREIGN KEY ("request_item_id") REFERENCES "public"."purchase_request_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_emergency_resource_service_cases" ADD CONSTRAINT "prevention_emergency_resource_service_cases_completed_receipt_item_id_receipt_items_id_fk" FOREIGN KEY ("completed_receipt_item_id") REFERENCES "public"."receipt_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_emergency_resource_service_cases" ADD CONSTRAINT "prevention_emergency_resource_service_cases_opened_by_user_id_users_id_fk" FOREIGN KEY ("opened_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_emergency_resource_service_cases" ADD CONSTRAINT "prevention_emergency_resource_service_cases_completed_by_user_id_users_id_fk" FOREIGN KEY ("completed_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "prevention_emergency_resource_assignment_active_point_unique" ON "prevention_emergency_resource_assignments" USING btree ("point_id") WHERE "prevention_emergency_resource_assignments"."unassigned_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "prevention_emergency_resource_assignment_active_resource_unique" ON "prevention_emergency_resource_assignments" USING btree ("resource_id") WHERE "prevention_emergency_resource_assignments"."unassigned_at" IS NULL;--> statement-breakpoint
CREATE INDEX "prevention_emergency_resource_assignment_resource_history_idx" ON "prevention_emergency_resource_assignments" USING btree ("resource_id","assigned_at");--> statement-breakpoint
CREATE INDEX "prevention_emergency_resource_event_timeline_idx" ON "prevention_emergency_resource_events" USING btree ("resource_id","occurred_at");--> statement-breakpoint
CREATE INDEX "prevention_emergency_resource_event_worksite_idx" ON "prevention_emergency_resource_events" USING btree ("worksite_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "prevention_emergency_resource_import_worksite_fingerprint_unique" ON "prevention_emergency_resource_import_batches" USING btree ("worksite_id","file_fingerprint");--> statement-breakpoint
CREATE UNIQUE INDEX "prevention_emergency_resource_point_worksite_code_unique" ON "prevention_emergency_resource_points" USING btree ("worksite_id","code");--> statement-breakpoint
CREATE INDEX "prevention_emergency_resource_point_worksite_active_idx" ON "prevention_emergency_resource_points" USING btree ("worksite_id","is_active");--> statement-breakpoint
CREATE INDEX "prevention_emergency_resource_point_vehicle_idx" ON "prevention_emergency_resource_points" USING btree ("vehicle_id");--> statement-breakpoint
CREATE UNIQUE INDEX "prevention_emergency_resource_type_spec_unique" ON "prevention_emergency_resource_types" USING btree ("resource_class","agent","capacity","capacity_unit");--> statement-breakpoint
CREATE INDEX "prevention_emergency_resource_type_service_product_idx" ON "prevention_emergency_resource_types" USING btree ("service_product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "prevention_emergency_resource_service_case_request_item_unique" ON "prevention_emergency_resource_service_cases" USING btree ("request_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "prevention_emergency_resource_service_case_open_resource_unique" ON "prevention_emergency_resource_service_cases" USING btree ("resource_id") WHERE "prevention_emergency_resource_service_cases"."status" = 'open';--> statement-breakpoint
CREATE INDEX "prevention_emergency_resource_service_case_resource_idx" ON "prevention_emergency_resource_service_cases" USING btree ("resource_id","opened_at");--> statement-breakpoint
ALTER TABLE "purchase_request_items" ADD CONSTRAINT "purchase_request_items_emergency_resource_id_prevention_emergency_resources_id_fk" FOREIGN KEY ("emergency_resource_id") REFERENCES "public"."prevention_emergency_resources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdtp_execution_checklists" ADD CONSTRAINT "pdtp_execution_checklists_subject_resource_id_prevention_emergency_resources_id_fk" FOREIGN KEY ("subject_resource_id") REFERENCES "public"."prevention_emergency_resources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_emergency_resources" ADD CONSTRAINT "prevention_emergency_resources_type_id_prevention_emergency_resource_types_id_fk" FOREIGN KEY ("type_id") REFERENCES "public"."prevention_emergency_resource_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "purchase_request_items_emergency_resource_idx" ON "purchase_request_items" USING btree ("emergency_resource_id");--> statement-breakpoint
CREATE INDEX "pdtp_execution_checklists_subject_resource_idx" ON "pdtp_execution_checklists" USING btree ("subject_resource_id");--> statement-breakpoint
CREATE UNIQUE INDEX "prevention_emergency_resource_worksite_asset_code_unique" ON "prevention_emergency_resources" USING btree ("worksite_id","asset_code") WHERE "prevention_emergency_resources"."asset_code" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "prevention_emergency_resource_type_idx" ON "prevention_emergency_resources" USING btree ("type_id");--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_service_subject_kind_valid" CHECK ("products"."service_subject_kind" IS NULL OR "products"."service_subject_kind" IN ('service_equipment', 'emergency_resource'));--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_service_subject_consistent" CHECK ("products"."service_subject_kind" IS NULL OR "products"."is_service" = true);--> statement-breakpoint
ALTER TABLE "purchase_request_items" ADD CONSTRAINT "purchase_request_items_one_service_subject" CHECK (NOT ("purchase_request_items"."equipment_id" IS NOT NULL AND "purchase_request_items"."emergency_resource_id" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "pdtp_execution_checklists" ADD CONSTRAINT "pdtp_execution_checklists_extinguisher_subject_fk" CHECK ("pdtp_execution_checklists"."subject_type" <> 'extintor' OR "pdtp_execution_checklists"."subject_resource_id" IS NOT NULL OR "pdtp_execution_checklists"."subject_id" <> '');--> statement-breakpoint
ALTER TABLE "prevention_emergency_resources" ADD CONSTRAINT "prevention_emergency_resource_version_positive" CHECK ("prevention_emergency_resources"."version" >= 1);--> statement-breakpoint

CREATE OR REPLACE FUNCTION prevent_emergency_resource_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Los eventos de activos de emergencia son inmutables';
END;
$$;--> statement-breakpoint

DROP TRIGGER IF EXISTS prevention_emergency_resource_events_immutable
ON prevention_emergency_resource_events;--> statement-breakpoint

CREATE TRIGGER prevention_emergency_resource_events_immutable
BEFORE UPDATE OR DELETE ON prevention_emergency_resource_events
FOR EACH ROW EXECUTE FUNCTION prevent_emergency_resource_event_mutation();--> statement-breakpoint

INSERT INTO product_categories (
  id, name, slug, is_epp, requires_prevencion, sort_order
) VALUES (
  'cat-servicios-operacionales', 'Servicios operacionales', 'servicios-operacionales', false, false, 90
)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  slug = EXCLUDED.slug;--> statement-breakpoint

INSERT INTO products (
  id, sku, name, description, category_id, unit_of_measure,
  is_epp, requires_prevencion, is_service, requires_worker,
  equipment_kind, service_subject_kind, reference_price, is_active, notes
) VALUES (
  'prod-srv-recarga-extintor',
  'SRV-RECARGA-EXTINTOR',
  'Recarga y mantención de extintor',
  'Recarga, mantención y certificación de un extintor del padrón de activos de emergencia.',
  'cat-servicios-operacionales',
  'servicio', false, false, true, false,
  NULL, 'emergency_resource', NULL, true,
  'Servicio sin precio previo: el costo real se registra en la OC.'
)
ON CONFLICT (id) DO UPDATE SET
  sku = EXCLUDED.sku,
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  category_id = EXCLUDED.category_id,
  unit_of_measure = EXCLUDED.unit_of_measure,
  is_service = true,
  requires_worker = false,
  equipment_kind = NULL,
  service_subject_kind = 'emergency_resource',
  reference_price = NULL,
  is_active = true,
  notes = EXCLUDED.notes,
  updated_at = now();
