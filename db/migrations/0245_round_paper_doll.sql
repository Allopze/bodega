CREATE TABLE "it_access_systems" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "it_asset_assignments" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"asset_id" text NOT NULL,
	"worker_id" text NOT NULL,
	"worksite_id" text NOT NULL,
	"kind" text DEFAULT 'delivery' NOT NULL,
	"delivered_at" timestamp with time zone NOT NULL,
	"delivered_by_user_id" text NOT NULL,
	"physical_state" text DEFAULT 'bueno' NOT NULL,
	"observations" text,
	"accepted_at" timestamp with time zone,
	"accepted_by_user_id" text,
	"returned_at" timestamp with time zone,
	"returned_by_user_id" text,
	"return_physical_state" text,
	"return_observations" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "it_asset_assignments_code_unique" UNIQUE("code"),
	CONSTRAINT "it_asset_assignments_kind_valid" CHECK ("it_asset_assignments"."kind" IN ('delivery', 'loan', 'transfer', 'repair_exit')),
	CONSTRAINT "it_asset_assignments_physical_state_valid" CHECK ("it_asset_assignments"."physical_state" IN ('bueno', 'regular', 'malo', 'nuevo')),
	CONSTRAINT "it_asset_assignments_return_state_valid" CHECK ("it_asset_assignments"."return_physical_state" IS NULL OR "it_asset_assignments"."return_physical_state" IN ('bueno', 'regular', 'malo'))
);
--> statement-breakpoint
CREATE TABLE "it_asset_history" (
	"id" text PRIMARY KEY NOT NULL,
	"asset_id" text NOT NULL,
	"action" text NOT NULL,
	"detail" text NOT NULL,
	"changes" text,
	"actor_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "it_asset_history_action_valid" CHECK ("it_asset_history"."action" IN ('created', 'assigned', 'returned', 'status_changed', 'edited', 'maintenance', 'ticket', 'document', 'photo', 'warranty', 'retired'))
);
--> statement-breakpoint
CREATE TABLE "it_asset_retirements" (
	"id" text PRIMARY KEY NOT NULL,
	"asset_id" text NOT NULL,
	"date" text NOT NULL,
	"reason" text NOT NULL,
	"responsible_user_id" text NOT NULL,
	"authorized_by_user_id" text NOT NULL,
	"destination" text,
	"observations" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "it_asset_retirements_reason_valid" CHECK ("it_asset_retirements"."reason" IN ('venta', 'reciclaje', 'destruccion', 'repuesto', 'donacion', 'perdida', 'robo'))
);
--> statement-breakpoint
CREATE TABLE "it_asset_types" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"has_specs" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "it_asset_types_category_valid" CHECK ("it_asset_types"."category" IN ('computacion', 'periferico', 'red', 'telefonia', 'movilidad', 'almacenamiento', 'otro'))
);
--> statement-breakpoint
CREATE TABLE "it_assets" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"asset_type_id" text NOT NULL,
	"brand" text,
	"model" text,
	"serial_number" text,
	"status" text DEFAULT 'disponible' NOT NULL,
	"worker_id" text,
	"worksite_id" text,
	"location" text,
	"purchase_date" text,
	"supplier_id" text,
	"purchase_doc_type" text,
	"purchase_doc_ref" text,
	"cost" numeric(14, 2),
	"warranty_end_date" text,
	"processor" text,
	"ram" text,
	"storage" text,
	"os" text,
	"observations" text,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "it_assets_code_unique" UNIQUE("code"),
	CONSTRAINT "it_assets_serial_number_unique" UNIQUE("serial_number"),
	CONSTRAINT "it_assets_status_valid" CHECK ("it_assets"."status" IN ('disponible', 'asignado', 'en_prestamo', 'en_reparacion', 'en_bodega', 'dado_de_baja', 'perdido', 'robado')),
	CONSTRAINT "it_assets_purchase_doc_type_valid" CHECK ("it_assets"."purchase_doc_type" IS NULL OR "it_assets"."purchase_doc_type" IN ('factura', 'oc', 'otro')),
	CONSTRAINT "it_assets_cost_valid" CHECK ("it_assets"."cost" IS NULL OR "it_assets"."cost" >= 0)
);
--> statement-breakpoint
CREATE TABLE "it_assignment_accessories" (
	"id" text PRIMARY KEY NOT NULL,
	"assignment_id" text NOT NULL,
	"name" text NOT NULL,
	"returned_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "it_assignment_photos" (
	"id" text PRIMARY KEY NOT NULL,
	"assignment_id" text,
	"stage" text DEFAULT 'delivery' NOT NULL,
	"file_name" text NOT NULL,
	"file_path" text NOT NULL,
	"file_size" integer,
	"mime_type" text,
	"caption" text,
	"uploaded_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "it_assignment_photos_stage_valid" CHECK ("it_assignment_photos"."stage" IN ('delivery', 'return'))
);
--> statement-breakpoint
CREATE TABLE "it_checklist_tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"checklist_id" text NOT NULL,
	"name" text NOT NULL,
	"done" boolean DEFAULT false NOT NULL,
	"done_at" timestamp with time zone,
	"done_by_user_id" text,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "it_license_assignments" (
	"id" text PRIMARY KEY NOT NULL,
	"license_id" text NOT NULL,
	"worker_id" text,
	"asset_id" text,
	"area" text,
	"worksite_id" text,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"notes" text,
	CONSTRAINT "it_license_assignments_target_valid" CHECK (("it_license_assignments"."worker_id" IS NOT NULL OR "it_license_assignments"."asset_id" IS NOT NULL OR "it_license_assignments"."area" IS NOT NULL OR "it_license_assignments"."worksite_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "it_licenses" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"supplier_id" text,
	"type" text,
	"purchased_quantity" integer DEFAULT 0 NOT NULL,
	"cost" numeric(14, 2),
	"periodicity" text DEFAULT 'anual' NOT NULL,
	"start_date" text,
	"renewal_date" text,
	"responsible_user_id" text,
	"notes" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "it_licenses_periodicity_valid" CHECK ("it_licenses"."periodicity" IN ('mensual', 'anual', 'unica')),
	CONSTRAINT "it_licenses_cost_valid" CHECK ("it_licenses"."cost" IS NULL OR "it_licenses"."cost" >= 0),
	CONSTRAINT "it_licenses_quantity_valid" CHECK ("it_licenses"."purchased_quantity" >= 0)
);
--> statement-breakpoint
CREATE TABLE "it_maintenances" (
	"id" text PRIMARY KEY NOT NULL,
	"asset_id" text NOT NULL,
	"type" text DEFAULT 'correctiva' NOT NULL,
	"date" text NOT NULL,
	"reported_issue" text,
	"diagnosis" text,
	"work_done" text NOT NULL,
	"parts_used" text,
	"supplier_id" text,
	"technician_name" text,
	"technician_user_id" text,
	"cost" numeric(14, 2) DEFAULT 0 NOT NULL,
	"observations" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "it_maintenances_type_valid" CHECK ("it_maintenances"."type" IN ('preventiva', 'correctiva', 'reparacion', 'actualizacion', 'revision')),
	CONSTRAINT "it_maintenances_cost_valid" CHECK ("it_maintenances"."cost" >= 0)
);
--> statement-breakpoint
CREATE TABLE "it_supplier_links" (
	"id" text PRIMARY KEY NOT NULL,
	"supplier_id" text NOT NULL,
	"category" text NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "it_supplier_links_category_valid" CHECK ("it_supplier_links"."category" IN ('reparacion', 'venta_hardware', 'licencias', 'telefonia', 'internet', 'cloud', 'otro'))
);
--> statement-breakpoint
CREATE TABLE "it_system_access" (
	"id" text PRIMARY KEY NOT NULL,
	"system_id" text NOT NULL,
	"worker_id" text NOT NULL,
	"status" text DEFAULT 'activo' NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"responsible_user_id" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "it_system_access_status_valid" CHECK ("it_system_access"."status" IN ('activo', 'suspendido', 'baja'))
);
--> statement-breakpoint
CREATE TABLE "it_ticket_comments" (
	"id" text PRIMARY KEY NOT NULL,
	"ticket_id" text NOT NULL,
	"body" text NOT NULL,
	"author_user_id" text NOT NULL,
	"is_internal" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "it_tickets" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"subject" text NOT NULL,
	"description" text NOT NULL,
	"category" text DEFAULT 'hardware' NOT NULL,
	"priority" text DEFAULT 'normal' NOT NULL,
	"status" text DEFAULT 'nuevo' NOT NULL,
	"requester_user_id" text NOT NULL,
	"worker_id" text,
	"worksite_id" text NOT NULL,
	"asset_id" text,
	"assignee_user_id" text,
	"resolved_at" timestamp with time zone,
	"resolution" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "it_tickets_code_unique" UNIQUE("code"),
	CONSTRAINT "it_tickets_category_valid" CHECK ("it_tickets"."category" IN ('hardware', 'software', 'correo', 'internet', 'impresoras', 'telefonia', 'accesos', 'plataforma', 'cuentas', 'otro')),
	CONSTRAINT "it_tickets_priority_valid" CHECK ("it_tickets"."priority" IN ('baja', 'normal', 'alta', 'critica')),
	CONSTRAINT "it_tickets_status_valid" CHECK ("it_tickets"."status" IN ('nuevo', 'asignado', 'en_diagnostico', 'en_progreso', 'esperando_usuario', 'esperando_proveedor', 'resuelto', 'cerrado'))
);
--> statement-breakpoint
CREATE TABLE "it_worker_checklists" (
	"id" text PRIMARY KEY NOT NULL,
	"worker_id" text NOT NULL,
	"kind" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"created_by_user_id" text NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "it_worker_checklists_kind_valid" CHECK ("it_worker_checklists"."kind" IN ('onboarding', 'offboarding'))
);
--> statement-breakpoint
ALTER TABLE "it_asset_assignments" ADD CONSTRAINT "it_asset_assignments_asset_id_it_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."it_assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "it_asset_assignments" ADD CONSTRAINT "it_asset_assignments_worker_id_workers_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "it_asset_assignments" ADD CONSTRAINT "it_asset_assignments_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "it_asset_assignments" ADD CONSTRAINT "it_asset_assignments_delivered_by_user_id_users_id_fk" FOREIGN KEY ("delivered_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "it_asset_assignments" ADD CONSTRAINT "it_asset_assignments_accepted_by_user_id_users_id_fk" FOREIGN KEY ("accepted_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "it_asset_assignments" ADD CONSTRAINT "it_asset_assignments_returned_by_user_id_users_id_fk" FOREIGN KEY ("returned_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "it_asset_history" ADD CONSTRAINT "it_asset_history_asset_id_it_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."it_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "it_asset_history" ADD CONSTRAINT "it_asset_history_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "it_asset_retirements" ADD CONSTRAINT "it_asset_retirements_asset_id_it_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."it_assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "it_asset_retirements" ADD CONSTRAINT "it_asset_retirements_responsible_user_id_users_id_fk" FOREIGN KEY ("responsible_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "it_asset_retirements" ADD CONSTRAINT "it_asset_retirements_authorized_by_user_id_users_id_fk" FOREIGN KEY ("authorized_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "it_assets" ADD CONSTRAINT "it_assets_asset_type_id_it_asset_types_id_fk" FOREIGN KEY ("asset_type_id") REFERENCES "public"."it_asset_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "it_assets" ADD CONSTRAINT "it_assets_worker_id_workers_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "it_assets" ADD CONSTRAINT "it_assets_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "it_assets" ADD CONSTRAINT "it_assets_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "it_assignment_accessories" ADD CONSTRAINT "it_assignment_accessories_assignment_id_it_asset_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."it_asset_assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "it_assignment_photos" ADD CONSTRAINT "it_assignment_photos_assignment_id_it_asset_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."it_asset_assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "it_assignment_photos" ADD CONSTRAINT "it_assignment_photos_uploaded_by_user_id_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "it_checklist_tasks" ADD CONSTRAINT "it_checklist_tasks_checklist_id_it_worker_checklists_id_fk" FOREIGN KEY ("checklist_id") REFERENCES "public"."it_worker_checklists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "it_checklist_tasks" ADD CONSTRAINT "it_checklist_tasks_done_by_user_id_users_id_fk" FOREIGN KEY ("done_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "it_license_assignments" ADD CONSTRAINT "it_license_assignments_license_id_it_licenses_id_fk" FOREIGN KEY ("license_id") REFERENCES "public"."it_licenses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "it_license_assignments" ADD CONSTRAINT "it_license_assignments_worker_id_workers_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "it_license_assignments" ADD CONSTRAINT "it_license_assignments_asset_id_it_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."it_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "it_license_assignments" ADD CONSTRAINT "it_license_assignments_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "it_licenses" ADD CONSTRAINT "it_licenses_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "it_licenses" ADD CONSTRAINT "it_licenses_responsible_user_id_users_id_fk" FOREIGN KEY ("responsible_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "it_maintenances" ADD CONSTRAINT "it_maintenances_asset_id_it_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."it_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "it_maintenances" ADD CONSTRAINT "it_maintenances_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "it_maintenances" ADD CONSTRAINT "it_maintenances_technician_user_id_users_id_fk" FOREIGN KEY ("technician_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "it_supplier_links" ADD CONSTRAINT "it_supplier_links_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "it_system_access" ADD CONSTRAINT "it_system_access_system_id_it_access_systems_id_fk" FOREIGN KEY ("system_id") REFERENCES "public"."it_access_systems"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "it_system_access" ADD CONSTRAINT "it_system_access_worker_id_workers_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "it_system_access" ADD CONSTRAINT "it_system_access_responsible_user_id_users_id_fk" FOREIGN KEY ("responsible_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "it_ticket_comments" ADD CONSTRAINT "it_ticket_comments_ticket_id_it_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."it_tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "it_ticket_comments" ADD CONSTRAINT "it_ticket_comments_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "it_tickets" ADD CONSTRAINT "it_tickets_requester_user_id_users_id_fk" FOREIGN KEY ("requester_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "it_tickets" ADD CONSTRAINT "it_tickets_worker_id_workers_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "it_tickets" ADD CONSTRAINT "it_tickets_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "it_tickets" ADD CONSTRAINT "it_tickets_asset_id_it_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."it_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "it_tickets" ADD CONSTRAINT "it_tickets_assignee_user_id_users_id_fk" FOREIGN KEY ("assignee_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "it_worker_checklists" ADD CONSTRAINT "it_worker_checklists_worker_id_workers_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "it_worker_checklists" ADD CONSTRAINT "it_worker_checklists_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "it_access_systems_active_idx" ON "it_access_systems" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "it_asset_assignments_asset_idx" ON "it_asset_assignments" USING btree ("asset_id","created_at");--> statement-breakpoint
CREATE INDEX "it_asset_assignments_worker_idx" ON "it_asset_assignments" USING btree ("worker_id");--> statement-breakpoint
CREATE INDEX "it_asset_assignments_worksite_idx" ON "it_asset_assignments" USING btree ("worksite_id");--> statement-breakpoint
CREATE UNIQUE INDEX "it_asset_assignments_active_asset_unique" ON "it_asset_assignments" USING btree ("asset_id") WHERE "it_asset_assignments"."returned_at" IS NULL;--> statement-breakpoint
CREATE INDEX "it_asset_history_asset_created_idx" ON "it_asset_history" USING btree ("asset_id","created_at");--> statement-breakpoint
CREATE INDEX "it_asset_retirements_asset_idx" ON "it_asset_retirements" USING btree ("asset_id","date");--> statement-breakpoint
CREATE INDEX "it_asset_types_active_idx" ON "it_asset_types" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "it_assets_status_idx" ON "it_assets" USING btree ("status");--> statement-breakpoint
CREATE INDEX "it_assets_worker_idx" ON "it_assets" USING btree ("worker_id");--> statement-breakpoint
CREATE INDEX "it_assets_worksite_idx" ON "it_assets" USING btree ("worksite_id");--> statement-breakpoint
CREATE INDEX "it_assets_type_idx" ON "it_assets" USING btree ("asset_type_id");--> statement-breakpoint
CREATE INDEX "it_assets_supplier_idx" ON "it_assets" USING btree ("supplier_id");--> statement-breakpoint
CREATE INDEX "it_assets_warranty_idx" ON "it_assets" USING btree ("warranty_end_date");--> statement-breakpoint
CREATE INDEX "it_assets_deleted_idx" ON "it_assets" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "it_assignment_accessories_assignment_idx" ON "it_assignment_accessories" USING btree ("assignment_id");--> statement-breakpoint
CREATE INDEX "it_assignment_photos_assignment_idx" ON "it_assignment_photos" USING btree ("assignment_id","stage","created_at");--> statement-breakpoint
CREATE INDEX "it_checklist_tasks_checklist_idx" ON "it_checklist_tasks" USING btree ("checklist_id");--> statement-breakpoint
CREATE INDEX "it_license_assignments_license_idx" ON "it_license_assignments" USING btree ("license_id","revoked_at");--> statement-breakpoint
CREATE INDEX "it_license_assignments_worker_idx" ON "it_license_assignments" USING btree ("worker_id");--> statement-breakpoint
CREATE INDEX "it_license_assignments_asset_idx" ON "it_license_assignments" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "it_licenses_renewal_idx" ON "it_licenses" USING btree ("renewal_date");--> statement-breakpoint
CREATE INDEX "it_licenses_active_idx" ON "it_licenses" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "it_maintenances_asset_date_idx" ON "it_maintenances" USING btree ("asset_id","date");--> statement-breakpoint
CREATE INDEX "it_maintenances_supplier_idx" ON "it_maintenances" USING btree ("supplier_id");--> statement-breakpoint
CREATE UNIQUE INDEX "it_supplier_links_supplier_category_unique" ON "it_supplier_links" USING btree ("supplier_id","category");--> statement-breakpoint
CREATE INDEX "it_supplier_links_supplier_idx" ON "it_supplier_links" USING btree ("supplier_id");--> statement-breakpoint
CREATE UNIQUE INDEX "it_system_access_system_worker_unique" ON "it_system_access" USING btree ("system_id","worker_id");--> statement-breakpoint
CREATE INDEX "it_system_access_worker_idx" ON "it_system_access" USING btree ("worker_id","status");--> statement-breakpoint
CREATE INDEX "it_ticket_comments_ticket_created_idx" ON "it_ticket_comments" USING btree ("ticket_id","created_at");--> statement-breakpoint
CREATE INDEX "it_tickets_status_idx" ON "it_tickets" USING btree ("status");--> statement-breakpoint
CREATE INDEX "it_tickets_worksite_idx" ON "it_tickets" USING btree ("worksite_id");--> statement-breakpoint
CREATE INDEX "it_tickets_assignee_idx" ON "it_tickets" USING btree ("assignee_user_id");--> statement-breakpoint
CREATE INDEX "it_tickets_requester_idx" ON "it_tickets" USING btree ("requester_user_id");--> statement-breakpoint
CREATE INDEX "it_tickets_asset_idx" ON "it_tickets" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "it_tickets_created_idx" ON "it_tickets" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "it_worker_checklists_worker_idx" ON "it_worker_checklists" USING btree ("worker_id","kind","created_at");