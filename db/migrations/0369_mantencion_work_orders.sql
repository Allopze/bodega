-- Órdenes de trabajo del módulo de mantención (2026-11-02), calcadas del
-- talonario «Orden de Trabajo Reparación/Mantención» de Chome.
--
-- Migración aditiva: crea mant_work_orders, mant_work_order_items y
-- mant_work_order_events; agrega mant_records.work_order_id (nulo para los
-- registros existentes) y amplía el contador de folios para aceptar 'OT'
-- (OT-BIO-0001). No modifica ni borra datos existentes.
CREATE TABLE "mant_work_order_events" (
	"id" text PRIMARY KEY NOT NULL,
	"work_order_id" text NOT NULL,
	"type" text NOT NULL,
	"from_status" text,
	"to_status" text,
	"reason" text,
	"change_set" jsonb,
	"actor_user_id" text NOT NULL,
	"device_id" text,
	"client_op_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mant_work_order_events_type_valid" CHECK ("mant_work_order_events"."type" IN ('created', 'edited', 'assigned', 'unassigned', 'taken', 'started', 'entry_updated', 'estimate_changed', 'item_added', 'items_marked', 'finished', 'received', 'rejected', 'conformed', 'voided', 'reopened', 'record_linked'))
);
--> statement-breakpoint
CREATE TABLE "mant_work_order_items" (
	"id" text PRIMARY KEY NOT NULL,
	"work_order_id" text NOT NULL,
	"kind" text NOT NULL,
	"origin" text DEFAULT 'solicitud' NOT NULL,
	"description" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"done" text,
	"note" text,
	"marked_by_user_id" text,
	"marked_at" timestamp with time zone,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mant_work_order_items_kind_valid" CHECK ("mant_work_order_items"."kind" IN ('anexo', 'mantencion')),
	CONSTRAINT "mant_work_order_items_origin_valid" CHECK ("mant_work_order_items"."origin" IN ('solicitud', 'taller')),
	CONSTRAINT "mant_work_order_items_description_valid" CHECK (char_length(trim("mant_work_order_items"."description")) >= 3),
	CONSTRAINT "mant_work_order_items_mark_valid" CHECK (
    ("mant_work_order_items"."done" IS NULL AND "mant_work_order_items"."marked_by_user_id" IS NULL AND "mant_work_order_items"."marked_at" IS NULL)
    OR ("mant_work_order_items"."done" IN ('si', 'no') AND "mant_work_order_items"."marked_by_user_id" IS NOT NULL AND "mant_work_order_items"."marked_at" IS NOT NULL)
  )
);
--> statement-breakpoint
CREATE TABLE "mant_work_orders" (
	"id" text PRIMARY KEY NOT NULL,
	"folio" text NOT NULL,
	"client_request_id" text,
	"vehicle_id" text NOT NULL,
	"worksite_id" text NOT NULL,
	"equipment_snapshot" jsonb NOT NULL,
	"repair" boolean DEFAULT false NOT NULL,
	"maintenance" boolean DEFAULT false NOT NULL,
	"request_date" text NOT NULL,
	"requested_by_user_id" text NOT NULL,
	"requester_name" text NOT NULL,
	"repair_description" text,
	"observations" text,
	"status" text DEFAULT 'solicitada' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"rejection_count" integer DEFAULT 0 NOT NULL,
	"assigned_to_user_id" text,
	"assigned_by_user_id" text,
	"assigned_at" timestamp with time zone,
	"workshop_kind" text,
	"workshop_id" text,
	"workshop_name" text,
	"workshop_manager_name" text,
	"operator_driver_id" text,
	"operator_name" text,
	"workshop_entry_at" timestamp with time zone,
	"entry_odometer" numeric(14, 1),
	"entry_hourmeter" numeric(14, 1),
	"estimated_delivery_date" text,
	"started_by_user_id" text,
	"started_at" timestamp with time zone,
	"workshop_exit_at" timestamp with time zone,
	"finished_by_user_id" text,
	"finished_at" timestamp with time zone,
	"received_at" timestamp with time zone,
	"receiver_name" text,
	"received_by_user_id" text,
	"received_recorded_at" timestamp with time zone,
	"faena_received_at" timestamp with time zone,
	"faena_receiver_name" text,
	"faena_received_by_user_id" text,
	"closed_at" timestamp with time zone,
	"voided_by_user_id" text,
	"voided_at" timestamp with time zone,
	"void_reason" text,
	"inspection_finding_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mant_work_orders_status_valid" CHECK ("mant_work_orders"."status" IN ('solicitada', 'asignada', 'en_ejecucion', 'trabajo_terminado', 'recepcionada', 'cerrada', 'anulada')),
	CONSTRAINT "mant_work_orders_kind_valid" CHECK ("mant_work_orders"."repair" OR "mant_work_orders"."maintenance"),
	CONSTRAINT "mant_work_orders_repair_description_valid" CHECK (NOT "mant_work_orders"."repair" OR char_length(trim(coalesce("mant_work_orders"."repair_description", ''))) >= 5),
	CONSTRAINT "mant_work_orders_requester_valid" CHECK (char_length(trim("mant_work_orders"."requester_name")) >= 2),
	CONSTRAINT "mant_work_orders_assignment_valid" CHECK (
    ("mant_work_orders"."status" = 'solicitada' AND "mant_work_orders"."assigned_to_user_id" IS NULL)
    OR ("mant_work_orders"."status" IN ('asignada', 'en_ejecucion', 'trabajo_terminado', 'recepcionada', 'cerrada') AND "mant_work_orders"."assigned_to_user_id" IS NOT NULL)
    OR "mant_work_orders"."status" = 'anulada'
  ),
	CONSTRAINT "mant_work_orders_entry_valid" CHECK (
    "mant_work_orders"."status" NOT IN ('en_ejecucion', 'trabajo_terminado', 'recepcionada', 'cerrada')
    OR ("mant_work_orders"."workshop_entry_at" IS NOT NULL AND "mant_work_orders"."estimated_delivery_date" IS NOT NULL AND "mant_work_orders"."started_at" IS NOT NULL AND "mant_work_orders"."workshop_kind" IS NOT NULL)
  ),
	CONSTRAINT "mant_work_orders_workshop_valid" CHECK (
    "mant_work_orders"."workshop_kind" IS NULL
    OR ("mant_work_orders"."workshop_kind" = 'interno' AND "mant_work_orders"."workshop_id" IS NULL)
    OR ("mant_work_orders"."workshop_kind" = 'externo' AND "mant_work_orders"."workshop_id" IS NOT NULL)
  ),
	CONSTRAINT "mant_work_orders_exit_valid" CHECK (
    ("mant_work_orders"."status" IN ('trabajo_terminado', 'recepcionada', 'cerrada')
      AND "mant_work_orders"."workshop_exit_at" IS NOT NULL AND "mant_work_orders"."finished_at" IS NOT NULL AND "mant_work_orders"."workshop_exit_at" >= "mant_work_orders"."workshop_entry_at")
    OR ("mant_work_orders"."status" NOT IN ('trabajo_terminado', 'recepcionada', 'cerrada') AND "mant_work_orders"."status" <> 'anulada'
      AND "mant_work_orders"."workshop_exit_at" IS NULL AND "mant_work_orders"."finished_at" IS NULL)
    OR "mant_work_orders"."status" = 'anulada'
  ),
	CONSTRAINT "mant_work_orders_reception_valid" CHECK (
    ("mant_work_orders"."status" IN ('recepcionada', 'cerrada')
      AND "mant_work_orders"."received_at" IS NOT NULL AND "mant_work_orders"."received_by_user_id" IS NOT NULL AND "mant_work_orders"."received_recorded_at" IS NOT NULL
      AND char_length(trim(coalesce("mant_work_orders"."receiver_name", ''))) >= 2)
    OR ("mant_work_orders"."status" NOT IN ('recepcionada', 'cerrada') AND "mant_work_orders"."status" <> 'anulada'
      AND "mant_work_orders"."received_at" IS NULL AND "mant_work_orders"."received_by_user_id" IS NULL AND "mant_work_orders"."received_recorded_at" IS NULL AND "mant_work_orders"."receiver_name" IS NULL)
    OR "mant_work_orders"."status" = 'anulada'
  ),
	CONSTRAINT "mant_work_orders_closure_valid" CHECK (
    ("mant_work_orders"."status" = 'cerrada'
      AND "mant_work_orders"."faena_received_at" IS NOT NULL AND "mant_work_orders"."faena_received_by_user_id" IS NOT NULL AND "mant_work_orders"."closed_at" IS NOT NULL
      AND char_length(trim(coalesce("mant_work_orders"."faena_receiver_name", ''))) >= 2)
    OR ("mant_work_orders"."status" <> 'cerrada'
      AND "mant_work_orders"."faena_received_at" IS NULL AND "mant_work_orders"."faena_received_by_user_id" IS NULL AND "mant_work_orders"."closed_at" IS NULL AND "mant_work_orders"."faena_receiver_name" IS NULL)
  ),
	CONSTRAINT "mant_work_orders_void_valid" CHECK (
    ("mant_work_orders"."status" = 'anulada' AND "mant_work_orders"."voided_at" IS NOT NULL AND "mant_work_orders"."voided_by_user_id" IS NOT NULL
      AND char_length(trim(coalesce("mant_work_orders"."void_reason", ''))) >= 5)
    OR ("mant_work_orders"."status" <> 'anulada' AND "mant_work_orders"."voided_at" IS NULL AND "mant_work_orders"."voided_by_user_id" IS NULL AND "mant_work_orders"."void_reason" IS NULL)
  ),
	CONSTRAINT "mant_work_orders_readings_valid" CHECK (coalesce("mant_work_orders"."entry_odometer", 0) >= 0 AND coalesce("mant_work_orders"."entry_hourmeter", 0) >= 0),
	CONSTRAINT "mant_work_orders_counters_valid" CHECK ("mant_work_orders"."version" >= 1 AND "mant_work_orders"."rejection_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "mant_folio_counters" DROP CONSTRAINT IF EXISTS "mant_folio_counters_kind_valid";--> statement-breakpoint
ALTER TABLE "mant_records" ADD COLUMN "work_order_id" text;--> statement-breakpoint
ALTER TABLE "mant_work_order_events" ADD CONSTRAINT "mant_work_order_events_work_order_id_mant_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."mant_work_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mant_work_order_events" ADD CONSTRAINT "mant_work_order_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mant_work_order_items" ADD CONSTRAINT "mant_work_order_items_work_order_id_mant_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."mant_work_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mant_work_order_items" ADD CONSTRAINT "mant_work_order_items_marked_by_user_id_users_id_fk" FOREIGN KEY ("marked_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mant_work_order_items" ADD CONSTRAINT "mant_work_order_items_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mant_work_orders" ADD CONSTRAINT "mant_work_orders_vehicle_id_fuel_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."fuel_vehicles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mant_work_orders" ADD CONSTRAINT "mant_work_orders_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mant_work_orders" ADD CONSTRAINT "mant_work_orders_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mant_work_orders" ADD CONSTRAINT "mant_work_orders_assigned_to_user_id_users_id_fk" FOREIGN KEY ("assigned_to_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mant_work_orders" ADD CONSTRAINT "mant_work_orders_assigned_by_user_id_users_id_fk" FOREIGN KEY ("assigned_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mant_work_orders" ADD CONSTRAINT "mant_work_orders_workshop_id_mant_workshops_id_fk" FOREIGN KEY ("workshop_id") REFERENCES "public"."mant_workshops"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mant_work_orders" ADD CONSTRAINT "mant_work_orders_operator_driver_id_mant_drivers_id_fk" FOREIGN KEY ("operator_driver_id") REFERENCES "public"."mant_drivers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mant_work_orders" ADD CONSTRAINT "mant_work_orders_started_by_user_id_users_id_fk" FOREIGN KEY ("started_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mant_work_orders" ADD CONSTRAINT "mant_work_orders_finished_by_user_id_users_id_fk" FOREIGN KEY ("finished_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mant_work_orders" ADD CONSTRAINT "mant_work_orders_received_by_user_id_users_id_fk" FOREIGN KEY ("received_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mant_work_orders" ADD CONSTRAINT "mant_work_orders_faena_received_by_user_id_users_id_fk" FOREIGN KEY ("faena_received_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mant_work_orders" ADD CONSTRAINT "mant_work_orders_voided_by_user_id_users_id_fk" FOREIGN KEY ("voided_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mant_work_orders" ADD CONSTRAINT "mant_work_orders_finding_fk" FOREIGN KEY ("inspection_finding_id") REFERENCES "public"."prevention_inspection_findings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mant_work_order_events_order_idx" ON "mant_work_order_events" USING btree ("work_order_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "mant_work_order_events_client_op_unique" ON "mant_work_order_events" USING btree ("client_op_id");--> statement-breakpoint
CREATE INDEX "mant_work_order_items_order_idx" ON "mant_work_order_items" USING btree ("work_order_id","kind","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "mant_work_orders_folio_unique" ON "mant_work_orders" USING btree ("folio");--> statement-breakpoint
CREATE UNIQUE INDEX "mant_work_orders_client_request_unique" ON "mant_work_orders" USING btree ("client_request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mant_work_orders_finding_unique" ON "mant_work_orders" USING btree ("inspection_finding_id") WHERE "mant_work_orders"."inspection_finding_id" IS NOT NULL AND "mant_work_orders"."status" <> 'anulada';--> statement-breakpoint
CREATE INDEX "mant_work_orders_status_idx" ON "mant_work_orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX "mant_work_orders_worksite_status_idx" ON "mant_work_orders" USING btree ("worksite_id","status");--> statement-breakpoint
CREATE INDEX "mant_work_orders_assigned_status_idx" ON "mant_work_orders" USING btree ("assigned_to_user_id","status");--> statement-breakpoint
CREATE INDEX "mant_work_orders_vehicle_created_idx" ON "mant_work_orders" USING btree ("vehicle_id","created_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "mant_records" ADD CONSTRAINT "mant_records_work_order_id_mant_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."mant_work_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mant_records_work_order_idx" ON "mant_records" USING btree ("work_order_id");--> statement-breakpoint
ALTER TABLE "mant_folio_counters" ADD CONSTRAINT "mant_folio_counters_kind_valid" CHECK ("mant_folio_counters"."kind" IN ('P', 'C', 'OT'));