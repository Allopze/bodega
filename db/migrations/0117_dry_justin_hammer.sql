CREATE TABLE "operational_activity_events" (
	"id" text PRIMARY KEY NOT NULL,
	"event_type" text NOT NULL,
	"module" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"entity_code" text,
	"worksite_id" text,
	"actor_user_id" text,
	"actor_snapshot" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "operational_activity_events_fields_nonempty" CHECK (length("operational_activity_events"."event_type") > 0 AND length("operational_activity_events"."module") > 0 AND length("operational_activity_events"."entity_type") > 0 AND length("operational_activity_events"."entity_id") > 0)
);
--> statement-breakpoint
CREATE TABLE "operational_metric_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"metric" text NOT NULL,
	"worksite_id" text NOT NULL,
	"snapshot_date" text NOT NULL,
	"value" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "operational_metric_snapshots_fields_nonempty" CHECK (length("operational_metric_snapshots"."metric") > 0 AND length("operational_metric_snapshots"."snapshot_date") = 10 AND length("operational_metric_snapshots"."value") > 0)
);
--> statement-breakpoint
CREATE TABLE "work_item_assignments" (
	"id" text PRIMARY KEY NOT NULL,
	"source_type" text NOT NULL,
	"source_id" text NOT NULL,
	"action_key" text NOT NULL,
	"worksite_id" text NOT NULL,
	"assignee_user_id" text,
	"assigned_by_user_id" text,
	"committed_due_at" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_item_assignments_source_fields_nonempty" CHECK (length("work_item_assignments"."source_type") > 0 AND length("work_item_assignments"."source_id") > 0 AND length("work_item_assignments"."action_key") > 0)
);
--> statement-breakpoint
ALTER TABLE "operational_activity_events" ADD CONSTRAINT "operational_activity_events_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operational_activity_events" ADD CONSTRAINT "operational_activity_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operational_metric_snapshots" ADD CONSTRAINT "operational_metric_snapshots_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_assignments" ADD CONSTRAINT "work_item_assignments_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_assignments" ADD CONSTRAINT "work_item_assignments_assignee_user_id_users_id_fk" FOREIGN KEY ("assignee_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_assignments" ADD CONSTRAINT "work_item_assignments_assigned_by_user_id_users_id_fk" FOREIGN KEY ("assigned_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "operational_activity_events_worksite_occurred_idx" ON "operational_activity_events" USING btree ("worksite_id","occurred_at");--> statement-breakpoint
CREATE INDEX "operational_activity_events_entity_idx" ON "operational_activity_events" USING btree ("entity_type","entity_id","occurred_at");--> statement-breakpoint
CREATE INDEX "operational_activity_events_module_occurred_idx" ON "operational_activity_events" USING btree ("module","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "operational_metric_snapshot_unique" ON "operational_metric_snapshots" USING btree ("metric","worksite_id","snapshot_date");--> statement-breakpoint
CREATE INDEX "operational_metric_snapshot_metric_date_idx" ON "operational_metric_snapshots" USING btree ("metric","snapshot_date");--> statement-breakpoint
CREATE UNIQUE INDEX "work_item_assignments_source_stage_unique" ON "work_item_assignments" USING btree ("source_type","source_id","action_key");--> statement-breakpoint
CREATE INDEX "work_item_assignments_worksite_assignee_idx" ON "work_item_assignments" USING btree ("worksite_id","assignee_user_id");--> statement-breakpoint
CREATE INDEX "work_item_assignments_due_idx" ON "work_item_assignments" USING btree ("committed_due_at");
--> statement-breakpoint
-- Actividad transversal forward-only. Se alimenta del audit log existente, por
-- lo que se confirma dentro de la misma transacción de la mutación origen y
-- no reconstruye hechos anteriores al despliegue.
CREATE OR REPLACE FUNCTION public.record_operational_activity_from_audit()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_worksite_id text;
  target_module text;
BEGIN
  CASE NEW.entity_type
    WHEN 'purchase_request' THEN
      SELECT worksite_id INTO target_worksite_id FROM purchase_requests WHERE id = NEW.entity_id;
      target_module := 'solicitudes';
    WHEN 'purchase_request_item' THEN
      SELECT pr.worksite_id INTO target_worksite_id
      FROM purchase_request_items pri
      INNER JOIN purchase_requests pr ON pr.id = pri.request_id
      WHERE pri.id = NEW.entity_id;
      target_module := 'solicitudes';
    WHEN 'purchase_order' THEN
      SELECT worksite_id INTO target_worksite_id FROM purchase_orders WHERE id = NEW.entity_id;
      target_module := 'compras';
    WHEN 'receipt' THEN
      SELECT po.worksite_id INTO target_worksite_id
      FROM receipts r INNER JOIN purchase_orders po ON po.id = r.purchase_order_id
      WHERE r.id = NEW.entity_id;
      target_module := 'recepciones';
    WHEN 'delivery' THEN
      SELECT worksite_id INTO target_worksite_id FROM deliveries WHERE id = NEW.entity_id;
      target_module := 'entregas';
    ELSE
      RETURN NEW;
  END CASE;

  IF target_worksite_id IS NULL THEN RETURN NEW; END IF;

  INSERT INTO operational_activity_events (
    id, event_type, module, entity_type, entity_id, entity_code,
    worksite_id, actor_user_id, payload
  ) VALUES (
    'opevt-' || md5(random()::text || clock_timestamp()::text || NEW.id),
    'audit.' || NEW.action,
    target_module,
    NEW.entity_type,
    NEW.entity_id,
    NEW.entity_code,
    target_worksite_id,
    NEW.user_id,
    jsonb_build_object('action', NEW.action)
  );
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER audit_log_operational_activity_trigger
AFTER INSERT ON audit_log
FOR EACH ROW EXECUTE FUNCTION public.record_operational_activity_from_audit();
