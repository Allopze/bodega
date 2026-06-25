CREATE TABLE "password_reset_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "password_reset_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "permissions" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"module" text NOT NULL,
	CONSTRAINT "permissions_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"role_id" text NOT NULL,
	"permission_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"is_global" boolean DEFAULT false NOT NULL,
	CONSTRAINT "roles_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "user_invitations" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"token_hash" text NOT NULL,
	"role_ids_json" text DEFAULT '[]' NOT NULL,
	"worksite_assignments_json" text DEFAULT '[]' NOT NULL,
	"invited_by_user_id" text,
	"expires_at" text NOT NULL,
	"accepted_at" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_invitations_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "user_permissions" (
	"user_id" text NOT NULL,
	"permission_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_roles" (
	"user_id" text NOT NULL,
	"role_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"hashed_password" text NOT NULL,
	"avatar_color" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"email_notifications" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "worksite_users" (
	"user_id" text NOT NULL,
	"worksite_id" text NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"rut" text,
	"business_activity" text,
	"contact_name" text,
	"email" text,
	"phone" text,
	"address" text,
	"commune" text,
	"city" text,
	"payment_terms" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "suppliers_rut_unique" UNIQUE("rut")
);
--> statement-breakpoint
CREATE TABLE "workers" (
	"id" text PRIMARY KEY NOT NULL,
	"rut" text,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"position" text,
	"supervisor" text,
	"prevencionista" text,
	"worksite_id" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workers_rut_unique" UNIQUE("rut")
);
--> statement-breakpoint
CREATE TABLE "worksites" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"address" text,
	"region" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "worksites_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "product_attributes" (
	"id" text PRIMARY KEY NOT NULL,
	"product_id" text,
	"category_id" text,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"is_required" boolean DEFAULT false NOT NULL,
	"options" text,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_categories" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"is_epp" boolean DEFAULT false NOT NULL,
	"requires_prevencion" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "product_categories_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "product_suppliers" (
	"id" text PRIMARY KEY NOT NULL,
	"product_id" text NOT NULL,
	"supplier_id" text NOT NULL,
	"unit_price" numeric(12, 2),
	"is_preferred" boolean DEFAULT false NOT NULL,
	"last_updated" timestamp with time zone DEFAULT now() NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" text PRIMARY KEY NOT NULL,
	"sku" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"category_id" text NOT NULL,
	"unit_of_measure" text DEFAULT 'unidad' NOT NULL,
	"is_epp" boolean DEFAULT false NOT NULL,
	"requires_prevencion" boolean DEFAULT false NOT NULL,
	"reference_price" numeric(12, 2),
	"is_active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_sku_unique" UNIQUE("sku")
);
--> statement-breakpoint
CREATE TABLE "approval_decisions" (
	"id" text PRIMARY KEY NOT NULL,
	"request_item_id" text,
	"request_id" text,
	"type" text NOT NULL,
	"decided_by" text NOT NULL,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reason" text,
	"modified_qty" real,
	"role_context" text,
	CONSTRAINT "approval_decisions_modified_qty_positive" CHECK ("approval_decisions"."modified_qty" IS NULL OR "approval_decisions"."modified_qty" > 0),
	CONSTRAINT "approval_decisions_type_valid" CHECK ("approval_decisions"."type" IN ('approve', 'reject', 'return', 'modify'))
);
--> statement-breakpoint
CREATE TABLE "purchase_request_items" (
	"id" text PRIMARY KEY NOT NULL,
	"request_id" text NOT NULL,
	"product_id" text,
	"product_name_free" text,
	"quantity" real NOT NULL,
	"unit_of_measure" text DEFAULT 'unidad' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"urgency" text,
	"required_date" text,
	"worker_id" text,
	"suggested_supplier_id" text,
	"supplier_hint" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_request_items_quantity_positive" CHECK ("purchase_request_items"."quantity" > 0),
	CONSTRAINT "purchase_request_items_state_valid" CHECK (
    "purchase_request_items"."status" IN (
      'draft', 'requested', 'approved', 'rejected', 'returned', 'postponed',
      'pending_purchase', 'in_purchase_order', 'purchased',
      'partially_received', 'received', 'partially_delivered', 'delivered'
    )
    AND ("purchase_request_items"."urgency" IS NULL OR "purchase_request_items"."urgency" IN ('normal', 'high', 'critical'))
  )
);
--> statement-breakpoint
CREATE TABLE "purchase_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"worksite_id" text NOT NULL,
	"requester_id" text NOT NULL,
	"request_type" text DEFAULT 'epp' NOT NULL,
	"urgency" text DEFAULT 'normal' NOT NULL,
	"required_date" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"submitted_at" text,
	"closed_at" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_requests_code_unique" UNIQUE("code"),
	CONSTRAINT "purchase_requests_type_urgency_status_valid" CHECK (
    "purchase_requests"."request_type" IN ('epp', 'stock', 'mantencion', 'otro', 'repuestos', 'servicios')
    AND "purchase_requests"."urgency" IN ('normal', 'high', 'critical')
    AND "purchase_requests"."status" IN (
      'draft', 'submitted', 'in_review', 'partially_approved', 'approved',
      'rejected', 'returned', 'in_purchasing', 'closed', 'cancelled'
    )
  )
);
--> statement-breakpoint
CREATE TABLE "request_item_attributes" (
	"id" text PRIMARY KEY NOT NULL,
	"request_item_id" text NOT NULL,
	"attribute_id" text,
	"attribute_name" text NOT NULL,
	"value" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "repuesto_quotations" (
	"id" text PRIMARY KEY NOT NULL,
	"request_id" text NOT NULL,
	"supplier_id" text,
	"supplier_name_free" text,
	"file_name" text NOT NULL,
	"file_path" text NOT NULL,
	"file_size" text,
	"uploaded_by" text,
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
CREATE TABLE "service_quotations" (
	"id" text PRIMARY KEY NOT NULL,
	"request_id" text NOT NULL,
	"supplier_id" text,
	"supplier_name_free" text,
	"file_name" text NOT NULL,
	"file_path" text NOT NULL,
	"file_size" text,
	"uploaded_by" text,
	"total_amount" numeric(12, 2) NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"notes" text,
	"decided_by" text,
	"selected_at" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_quotations_status_valid" CHECK (
    "service_quotations"."status" IN ('pending', 'selected', 'rejected')
  )
);
--> statement-breakpoint
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
CREATE TABLE "purchase_order_items" (
	"id" text PRIMARY KEY NOT NULL,
	"purchase_order_id" text NOT NULL,
	"request_item_id" text,
	"product_id" text,
	"product_name_free" text,
	"quantity" real NOT NULL,
	"unit_of_measure" text DEFAULT 'unidad' NOT NULL,
	"unit_price" numeric(12, 2) DEFAULT 0 NOT NULL,
	"discount" numeric(12, 2) DEFAULT 0 NOT NULL,
	"subtotal" numeric(12, 2) DEFAULT 0 NOT NULL,
	"quantity_office_received" real DEFAULT 0 NOT NULL,
	"quantity_received" real DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'issued' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"notes" text,
	CONSTRAINT "purchase_order_items_status_valid" CHECK (
    "purchase_order_items"."status" IN ('issued', 'partially_received', 'received', 'cancelled')
  ),
	CONSTRAINT "purchase_order_items_numeric_integrity" CHECK (
    "purchase_order_items"."quantity" > 0
    AND "purchase_order_items"."unit_price" >= 0
    AND "purchase_order_items"."discount" >= 0
    AND "purchase_order_items"."discount" <= 100
    AND "purchase_order_items"."subtotal" >= 0
    AND "purchase_order_items"."quantity_office_received" >= 0
    AND "purchase_order_items"."quantity_received" >= 0
    AND "purchase_order_items"."quantity_office_received" <= "purchase_order_items"."quantity"
    AND "purchase_order_items"."quantity_received" <= "purchase_order_items"."quantity_office_received"
  )
);
--> statement-breakpoint
CREATE TABLE "purchase_orders" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"worksite_id" text NOT NULL,
	"supplier_id" text NOT NULL,
	"created_by" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"issued_at" text,
	"issued_by" text,
	"sent_at" text,
	"confirmed_at" text,
	"estimated_delivery" text,
	"delivery_address" text,
	"payment_terms" text,
	"net_amount" numeric(12, 2) DEFAULT 0 NOT NULL,
	"tax_amount" numeric(12, 2) DEFAULT 0 NOT NULL,
	"total_amount" numeric(12, 2) DEFAULT 0 NOT NULL,
	"notes" text,
	"supplier_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_orders_code_unique" UNIQUE("code"),
	CONSTRAINT "purchase_orders_status_valid" CHECK (
    "purchase_orders"."status" IN (
      'draft', 'issued', 'sent', 'supplier_confirmed',
      'partially_office_received', 'office_received',
      'partially_received', 'received', 'closed', 'cancelled'
    )
  ),
	CONSTRAINT "purchase_orders_amounts_non_negative" CHECK (
    "purchase_orders"."net_amount" >= 0
    AND "purchase_orders"."tax_amount" >= 0
    AND "purchase_orders"."total_amount" >= 0
  )
);
--> statement-breakpoint
CREATE TABLE "quotations" (
	"id" text PRIMARY KEY NOT NULL,
	"purchase_order_id" text,
	"supplier_id" text NOT NULL,
	"file_name" text,
	"file_path" text,
	"amount" numeric(12, 2),
	"valid_until" text,
	"notes" text,
	"uploaded_by" text NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deliveries" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"delivered_by" text NOT NULL,
	"delivered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"destination_type" text NOT NULL,
	"worksite_id" text,
	"worker_id" text,
	"receiver_name" text,
	"signature_path" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deliveries_code_unique" UNIQUE("code"),
	CONSTRAINT "deliveries_destination_type_valid" CHECK ("deliveries"."destination_type" IN ('faena', 'worker'))
);
--> statement-breakpoint
CREATE TABLE "delivery_items" (
	"id" text PRIMARY KEY NOT NULL,
	"delivery_id" text NOT NULL,
	"request_item_id" text,
	"product_id" text,
	"product_name_free" text,
	"quantity" real NOT NULL,
	"unit_of_measure" text DEFAULT 'unidad' NOT NULL,
	"notes" text,
	"return_quantity" real,
	"return_product_id" text,
	"return_product_name_free" text,
	"return_reason" text,
	"return_notes" text,
	CONSTRAINT "delivery_items_quantity_positive" CHECK ("delivery_items"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "receipt_items" (
	"id" text PRIMARY KEY NOT NULL,
	"receipt_id" text NOT NULL,
	"purchase_order_item_id" text NOT NULL,
	"quantity_received" real DEFAULT 0 NOT NULL,
	"quantity_rejected" real DEFAULT 0 NOT NULL,
	"quantity_damaged" real DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'received' NOT NULL,
	"notes" text,
	CONSTRAINT "receipt_items_status_valid" CHECK (
    "receipt_items"."status" IN ('received', 'partially_received', 'rejected', 'damaged', 'pending')
  ),
	CONSTRAINT "receipt_items_quantities_valid" CHECK (
    "receipt_items"."quantity_received" > 0
    AND "receipt_items"."quantity_rejected" >= 0
    AND "receipt_items"."quantity_damaged" >= 0
  )
);
--> statement-breakpoint
CREATE TABLE "receipts" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"purchase_order_id" text NOT NULL,
	"received_by" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"location_type" text DEFAULT 'office' NOT NULL,
	"worksite_id" text,
	"dispatch_guide_no" text,
	"status" text DEFAULT 'open' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "receipts_code_unique" UNIQUE("code"),
	CONSTRAINT "receipts_location_status_valid" CHECK (
    "receipts"."location_type" IN ('office', 'faena')
    AND "receipts"."status" IN ('open', 'closed')
  )
);
--> statement-breakpoint
CREATE TABLE "inventory_movements" (
	"id" text PRIMARY KEY NOT NULL,
	"worksite_id" text NOT NULL,
	"product_id" text NOT NULL,
	"type" text NOT NULL,
	"quantity" real NOT NULL,
	"reference_type" text,
	"reference_id" text,
	"stock_before" real DEFAULT 0 NOT NULL,
	"stock_after" real DEFAULT 0 NOT NULL,
	"performed_by" text NOT NULL,
	"performed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reason" text,
	"notes" text,
	CONSTRAINT "inventory_movements_type_valid" CHECK (
    "inventory_movements"."type" IN ('ingreso_oc', 'egreso_entrega', 'ingreso_devolucion', 'egreso_desecho', 'ajuste')
  ),
	CONSTRAINT "inventory_movements_stock_non_negative" CHECK (
    "inventory_movements"."stock_before" >= 0
    AND "inventory_movements"."stock_after" >= 0
  )
);
--> statement-breakpoint
CREATE TABLE "worksite_stock" (
	"id" text PRIMARY KEY NOT NULL,
	"worksite_id" text NOT NULL,
	"product_id" text NOT NULL,
	"quantity" real DEFAULT 0 NOT NULL,
	"min_stock" real DEFAULT 0 NOT NULL,
	"last_movement_at" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "worksite_stock_quantity_non_negative" CHECK ("worksite_stock"."quantity" >= 0),
	CONSTRAINT "worksite_stock_min_stock_non_negative" CHECK ("worksite_stock"."min_stock" >= 0)
);
--> statement-breakpoint
CREATE TABLE "attachments" (
	"id" text PRIMARY KEY NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"file_name" text NOT NULL,
	"file_path" text NOT NULL,
	"file_size" integer,
	"mime_type" text,
	"uploaded_by" text NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"user_email" text,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"entity_code" text,
	"old_state" text,
	"new_state" text,
	"reason" text,
	"ip_address" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"entity_type" text,
	"entity_id" text,
	"entity_href" text,
	"is_read" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "status_history" (
	"id" text PRIMARY KEY NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"changed_by" text,
	"reason" text,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "code_sequences" (
	"prefix" text NOT NULL,
	"year" integer NOT NULL,
	"next_value" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "code_sequences_prefix_year_pk" PRIMARY KEY("prefix","year")
);
--> statement-breakpoint
CREATE TABLE "system_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"lock_until" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sst_action_plan" (
	"id" text PRIMARY KEY NOT NULL,
	"evaluation_id" text NOT NULL,
	"n" integer NOT NULL,
	"hallazgo" text NOT NULL,
	"accion" text NOT NULL,
	"responsable" text NOT NULL,
	"plazo" text NOT NULL,
	"estado" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sst_evaluations" (
	"id" text PRIMARY KEY NOT NULL,
	"worksite_id" text NOT NULL,
	"worker_id" text NOT NULL,
	"created_by" text NOT NULL,
	"definicion_code" text NOT NULL,
	"definicion_version" text NOT NULL,
	"tipo" text NOT NULL,
	"evaluator_role" text,
	"motivo" text,
	"motivo_otro" text,
	"descripcion_evento" text,
	"equipo_patente" text,
	"fecha_evaluacion" text NOT NULL,
	"estado" text DEFAULT 'borrador' NOT NULL,
	"cargos_json" jsonb,
	"resultado_final" text,
	"porcentaje_cumplimiento" real,
	"resultado_eficacia" text,
	"restricciones" text,
	"observaciones_generales" text,
	"schema_json" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sst_responses" (
	"id" text PRIMARY KEY NOT NULL,
	"evaluation_id" text NOT NULL,
	"seccion_id" text NOT NULL,
	"item_id" text NOT NULL,
	"estado" text,
	"observacion" text,
	"accion_correctiva" text
);
--> statement-breakpoint
CREATE TABLE "sst_scheduled_followups" (
	"id" text PRIMARY KEY NOT NULL,
	"evaluation_id" text NOT NULL,
	"instancia" text NOT NULL,
	"fecha_programada" text NOT NULL,
	"cumple" boolean,
	"observaciones" text,
	"realizado" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sst_weekly_evaluations" (
	"id" text PRIMARY KEY NOT NULL,
	"evaluation_id" text NOT NULL,
	"semana" integer NOT NULL,
	"fecha_desbloqueo" text NOT NULL,
	"estado" text DEFAULT 'pendiente' NOT NULL,
	"fecha_completada" text,
	"alert_sent_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ppa_submissions" (
	"id" text PRIMARY KEY NOT NULL,
	"worksite_id" text NOT NULL,
	"worker_id" text,
	"worker_name" text NOT NULL,
	"worker_rut" text,
	"worker_company" text,
	"manual_identificacion" boolean DEFAULT false NOT NULL,
	"tipo_trabajo" text NOT NULL,
	"es_critica" boolean DEFAULT false NOT NULL,
	"answers_json" jsonb NOT NULL,
	"resultado" text NOT NULL,
	"triggered_reasons" jsonb NOT NULL,
	"estado" text NOT NULL,
	"public_token" text NOT NULL,
	"reviewed_by" text,
	"fui_al_lugar" boolean,
	"accion_correctiva" text,
	"decision" text,
	"review_nota" text,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "ppa_submissions_public_token_unique" UNIQUE("public_token")
);
--> statement-breakpoint
CREATE TABLE "email_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"subject" text NOT NULL,
	"body_html" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_templates_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "feedback_reports" (
	"id" text PRIMARY KEY NOT NULL,
	"tipo" text NOT NULL,
	"titulo" text NOT NULL,
	"descripcion" text NOT NULL,
	"pagina" text,
	"estado" text DEFAULT 'abierto' NOT NULL,
	"nota_interna" text,
	"created_by" text NOT NULL,
	"resolved_by" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feedback_reports_tipo_valid" CHECK ("feedback_reports"."tipo" IN ('bug', 'consulta', 'sugerencia')),
	CONSTRAINT "feedback_reports_estado_valid" CHECK ("feedback_reports"."estado" IN ('abierto', 'en_progreso', 'resuelto', 'descartado'))
);
--> statement-breakpoint
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
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_permissions_id_fk" FOREIGN KEY ("permission_id") REFERENCES "public"."permissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_invitations" ADD CONSTRAINT "user_invitations_invited_by_user_id_users_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_permissions" ADD CONSTRAINT "user_permissions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_permissions" ADD CONSTRAINT "user_permissions_permission_id_permissions_id_fk" FOREIGN KEY ("permission_id") REFERENCES "public"."permissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worksite_users" ADD CONSTRAINT "worksite_users_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worksite_users" ADD CONSTRAINT "worksite_users_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workers" ADD CONSTRAINT "workers_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_attributes" ADD CONSTRAINT "product_attributes_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_attributes" ADD CONSTRAINT "product_attributes_category_id_product_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."product_categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_suppliers" ADD CONSTRAINT "product_suppliers_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_suppliers" ADD CONSTRAINT "product_suppliers_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_product_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."product_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_decisions" ADD CONSTRAINT "approval_decisions_request_item_id_purchase_request_items_id_fk" FOREIGN KEY ("request_item_id") REFERENCES "public"."purchase_request_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_decisions" ADD CONSTRAINT "approval_decisions_request_id_purchase_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."purchase_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_decisions" ADD CONSTRAINT "approval_decisions_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_request_items" ADD CONSTRAINT "purchase_request_items_request_id_purchase_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."purchase_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_request_items" ADD CONSTRAINT "purchase_request_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_request_items" ADD CONSTRAINT "purchase_request_items_worker_id_workers_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_request_items" ADD CONSTRAINT "purchase_request_items_suggested_supplier_id_suppliers_id_fk" FOREIGN KEY ("suggested_supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_requester_id_users_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_item_attributes" ADD CONSTRAINT "request_item_attributes_request_item_id_purchase_request_items_id_fk" FOREIGN KEY ("request_item_id") REFERENCES "public"."purchase_request_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_item_attributes" ADD CONSTRAINT "request_item_attributes_attribute_id_product_attributes_id_fk" FOREIGN KEY ("attribute_id") REFERENCES "public"."product_attributes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repuesto_quotations" ADD CONSTRAINT "repuesto_quotations_request_id_purchase_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."purchase_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repuesto_quotations" ADD CONSTRAINT "repuesto_quotations_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repuesto_quotations" ADD CONSTRAINT "repuesto_quotations_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repuesto_quotations" ADD CONSTRAINT "repuesto_quotations_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_quotations" ADD CONSTRAINT "service_quotations_request_id_purchase_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."purchase_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_quotations" ADD CONSTRAINT "service_quotations_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_quotations" ADD CONSTRAINT "service_quotations_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_quotations" ADD CONSTRAINT "service_quotations_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_invoices" ADD CONSTRAINT "purchase_order_invoices_purchase_order_id_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_invoices" ADD CONSTRAINT "purchase_order_invoices_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_purchase_order_id_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_request_item_id_purchase_request_items_id_fk" FOREIGN KEY ("request_item_id") REFERENCES "public"."purchase_request_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_issued_by_users_id_fk" FOREIGN KEY ("issued_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_purchase_order_id_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_delivered_by_users_id_fk" FOREIGN KEY ("delivered_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_worker_id_workers_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_items" ADD CONSTRAINT "delivery_items_delivery_id_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."deliveries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_items" ADD CONSTRAINT "delivery_items_request_item_id_purchase_request_items_id_fk" FOREIGN KEY ("request_item_id") REFERENCES "public"."purchase_request_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_items" ADD CONSTRAINT "delivery_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_items" ADD CONSTRAINT "delivery_items_return_product_id_products_id_fk" FOREIGN KEY ("return_product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_items" ADD CONSTRAINT "receipt_items_receipt_id_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."receipts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_items" ADD CONSTRAINT "receipt_items_purchase_order_item_id_purchase_order_items_id_fk" FOREIGN KEY ("purchase_order_item_id") REFERENCES "public"."purchase_order_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_purchase_order_id_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_received_by_users_id_fk" FOREIGN KEY ("received_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_performed_by_users_id_fk" FOREIGN KEY ("performed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worksite_stock" ADD CONSTRAINT "worksite_stock_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worksite_stock" ADD CONSTRAINT "worksite_stock_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "status_history" ADD CONSTRAINT "status_history_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sst_action_plan" ADD CONSTRAINT "sst_action_plan_evaluation_id_sst_evaluations_id_fk" FOREIGN KEY ("evaluation_id") REFERENCES "public"."sst_evaluations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sst_evaluations" ADD CONSTRAINT "sst_evaluations_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sst_evaluations" ADD CONSTRAINT "sst_evaluations_worker_id_workers_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sst_evaluations" ADD CONSTRAINT "sst_evaluations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sst_responses" ADD CONSTRAINT "sst_responses_evaluation_id_sst_evaluations_id_fk" FOREIGN KEY ("evaluation_id") REFERENCES "public"."sst_evaluations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sst_scheduled_followups" ADD CONSTRAINT "sst_scheduled_followups_evaluation_id_sst_evaluations_id_fk" FOREIGN KEY ("evaluation_id") REFERENCES "public"."sst_evaluations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sst_weekly_evaluations" ADD CONSTRAINT "sst_weekly_evaluations_evaluation_id_sst_evaluations_id_fk" FOREIGN KEY ("evaluation_id") REFERENCES "public"."sst_evaluations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ppa_submissions" ADD CONSTRAINT "ppa_submissions_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ppa_submissions" ADD CONSTRAINT "ppa_submissions_worker_id_workers_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ppa_submissions" ADD CONSTRAINT "ppa_submissions_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_reports" ADD CONSTRAINT "feedback_reports_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_reports" ADD CONSTRAINT "feedback_reports_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_vehicles" ADD CONSTRAINT "fuel_vehicles_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_loads" ADD CONSTRAINT "fuel_loads_vehicle_id_fuel_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."fuel_vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_loads" ADD CONSTRAINT "fuel_loads_fuel_supplier_id_fuel_suppliers_id_fk" FOREIGN KEY ("fuel_supplier_id") REFERENCES "public"."fuel_suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_loads" ADD CONSTRAINT "fuel_loads_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_loads" ADD CONSTRAINT "fuel_loads_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_monthly_statements" ADD CONSTRAINT "fuel_monthly_statements_fuel_supplier_id_fuel_suppliers_id_fk" FOREIGN KEY ("fuel_supplier_id") REFERENCES "public"."fuel_suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_monthly_statements" ADD CONSTRAINT "fuel_monthly_statements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_payments" ADD CONSTRAINT "fuel_payments_statement_id_fuel_monthly_statements_id_fk" FOREIGN KEY ("statement_id") REFERENCES "public"."fuel_monthly_statements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_payments" ADD CONSTRAINT "fuel_payments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "role_permissions_role_permission_unique" ON "role_permissions" USING btree ("role_id","permission_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_permissions_user_permission_unique" ON "user_permissions" USING btree ("user_id","permission_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_roles_user_role_unique" ON "user_roles" USING btree ("user_id","role_id");--> statement-breakpoint
CREATE UNIQUE INDEX "worksite_users_user_worksite_unique" ON "worksite_users" USING btree ("user_id","worksite_id");--> statement-breakpoint
CREATE UNIQUE INDEX "product_suppliers_product_supplier_unique" ON "product_suppliers" USING btree ("product_id","supplier_id");--> statement-breakpoint
CREATE INDEX "purchase_request_items_request_id_status_idx" ON "purchase_request_items" USING btree ("request_id","status");--> statement-breakpoint
CREATE INDEX "purchase_requests_worksite_id_status_idx" ON "purchase_requests" USING btree ("worksite_id","status");--> statement-breakpoint
CREATE INDEX "purchase_requests_requester_id_created_at_idx" ON "purchase_requests" USING btree ("requester_id","created_at");--> statement-breakpoint
CREATE INDEX "purchase_orders_worksite_status_idx" ON "purchase_orders" USING btree ("worksite_id","status","created_at");--> statement-breakpoint
CREATE INDEX "purchase_orders_status_sent_idx" ON "purchase_orders" USING btree ("status","sent_at");--> statement-breakpoint
CREATE INDEX "inventory_movements_worksite_performed_at_idx" ON "inventory_movements" USING btree ("worksite_id","performed_at");--> statement-breakpoint
CREATE INDEX "inventory_movements_product_performed_at_idx" ON "inventory_movements" USING btree ("product_id","performed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "worksite_stock_unique" ON "worksite_stock" USING btree ("worksite_id","product_id");--> statement-breakpoint
CREATE INDEX "audit_log_created_at_idx" ON "audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_log_entity_idx" ON "audit_log" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "notifications_user_read_idx" ON "notifications" USING btree ("user_id","is_read","created_at");--> statement-breakpoint
CREATE INDEX "status_history_entity_idx" ON "status_history" USING btree ("entity_type","entity_id","changed_at");--> statement-breakpoint
CREATE INDEX "feedback_reports_created_by_idx" ON "feedback_reports" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "feedback_reports_estado_idx" ON "feedback_reports" USING btree ("estado");--> statement-breakpoint
CREATE INDEX "feedback_reports_tipo_idx" ON "feedback_reports" USING btree ("tipo");--> statement-breakpoint
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
CREATE INDEX "fuel_payments_statement_idx" ON "fuel_payments" USING btree ("statement_id");--> statement-breakpoint
-- ─────────────────────────────────────────────────────────────────────────────
-- Custom DB objects not managed by the Drizzle schema (functions, triggers and
-- the inventory_movements archive table). Preserved verbatim from the squashed
-- migrations 0014 (next_document_code), 0015 (set_updated_at + triggers) and
-- 0018 (audit/inventory archival). All statements are idempotent.
-- ─────────────────────────────────────────────────────────────────────────────

-- 0014: native per-(prefix, year) sequence generator for document codes.
CREATE OR REPLACE FUNCTION next_document_code(p_prefix text, p_year int)
RETURNS int
LANGUAGE plpgsql
AS $$
DECLARE
  seq_name text := 'code_seq_' || lower(p_prefix) || '_' || p_year::text;
  next_val int;
BEGIN
  EXECUTE format(
    'CREATE SEQUENCE IF NOT EXISTS %I AS int MINVALUE 1 NO CYCLE',
    seq_name
  );
  EXECUTE format('SELECT nextval(%L)', seq_name) INTO next_val;
  RETURN next_val;
END;
$$;--> statement-breakpoint

-- 0014: backfill sequences from any pre-existing code_sequences rows (no-op on a
-- fresh database where code_sequences is empty).
DO $$
DECLARE
  r record;
  seq_name text;
BEGIN
  FOR r IN SELECT prefix, year, next_value FROM code_sequences LOOP
    seq_name := 'code_seq_' || lower(r.prefix) || '_' || r.year::text;
    EXECUTE format(
      'CREATE SEQUENCE IF NOT EXISTS %I AS int MINVALUE 1 START WITH %s NO CYCLE',
      seq_name,
      r.next_value + 1
    );
  END LOOP;
END;
$$;--> statement-breakpoint

-- 0015: shared updated_at trigger function + BEFORE UPDATE triggers.
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;--> statement-breakpoint
DROP TRIGGER IF EXISTS users_set_updated_at ON users;--> statement-breakpoint
CREATE TRIGGER users_set_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
DROP TRIGGER IF EXISTS worksites_set_updated_at ON worksites;--> statement-breakpoint
CREATE TRIGGER worksites_set_updated_at BEFORE UPDATE ON worksites FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
DROP TRIGGER IF EXISTS products_set_updated_at ON products;--> statement-breakpoint
CREATE TRIGGER products_set_updated_at BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
DROP TRIGGER IF EXISTS suppliers_set_updated_at ON suppliers;--> statement-breakpoint
CREATE TRIGGER suppliers_set_updated_at BEFORE UPDATE ON suppliers FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
DROP TRIGGER IF EXISTS purchase_requests_set_updated_at ON purchase_requests;--> statement-breakpoint
CREATE TRIGGER purchase_requests_set_updated_at BEFORE UPDATE ON purchase_requests FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
DROP TRIGGER IF EXISTS purchase_request_items_set_updated_at ON purchase_request_items;--> statement-breakpoint
CREATE TRIGGER purchase_request_items_set_updated_at BEFORE UPDATE ON purchase_request_items FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
DROP TRIGGER IF EXISTS purchase_orders_set_updated_at ON purchase_orders;--> statement-breakpoint
CREATE TRIGGER purchase_orders_set_updated_at BEFORE UPDATE ON purchase_orders FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
DROP TRIGGER IF EXISTS code_sequences_set_updated_at ON code_sequences;--> statement-breakpoint
CREATE TRIGGER code_sequences_set_updated_at BEFORE UPDATE ON code_sequences FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint

-- 0018: audit_log retention function.
CREATE OR REPLACE FUNCTION cleanup_old_audit_log(p_keep_years int DEFAULT 6)
RETURNS bigint
LANGUAGE plpgsql
AS $$
DECLARE
  v_cutoff  timestamptz;
  v_deleted bigint;
BEGIN
  IF p_keep_years < 5 THEN
    RAISE EXCEPTION 'Retention period must be at least 5 years (legal requirement DS N°44/2024)';
  END IF;
  v_cutoff := now() - (p_keep_years * interval '1 year');
  DELETE FROM audit_log WHERE created_at < v_cutoff;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;--> statement-breakpoint

-- 0018: inventory_movements archive table + archival function.
CREATE TABLE IF NOT EXISTS inventory_movements_archive (LIKE inventory_movements INCLUDING ALL);--> statement-breakpoint
CREATE OR REPLACE FUNCTION archive_old_inventory_movements(p_keep_months int DEFAULT 36)
RETURNS bigint
LANGUAGE plpgsql
AS $$
DECLARE
  v_cutoff  timestamptz;
  v_archived bigint;
BEGIN
  v_cutoff := now() - (p_keep_months * interval '1 month');
  WITH moved AS (
    DELETE FROM inventory_movements
    WHERE performed_at < v_cutoff
    RETURNING *
  )
  INSERT INTO inventory_movements_archive
  SELECT * FROM moved;
  GET DIAGNOSTICS v_archived = ROW_COUNT;
  RETURN v_archived;
END;
$$;
