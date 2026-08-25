CREATE TABLE "feedback_report_events" (
	"id" text PRIMARY KEY NOT NULL,
	"report_id" text NOT NULL,
	"event_type" text NOT NULL,
	"from_estado" text,
	"to_estado" text,
	"note" text,
	"actor_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feedback_report_events_type_valid" CHECK ("feedback_report_events"."event_type" IN ('created', 'status_changed', 'note_added'))
);
--> statement-breakpoint
ALTER TABLE "fuel_import_batches" ALTER COLUMN "fuente" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "feedback_report_events" ADD CONSTRAINT "feedback_report_events_report_id_feedback_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."feedback_reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_report_events" ADD CONSTRAINT "feedback_report_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "feedback_report_events_report_created_idx" ON "feedback_report_events" USING btree ("report_id","created_at");
--> statement-breakpoint
-- Append-only evidence: state and notes are corrected by a new event, never
-- by rewriting or deleting a historic row.
CREATE OR REPLACE FUNCTION prevent_feedback_report_events_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- The foreign-key cascade deletes event rows only while deleting their
  -- parent ticket. Direct deletion remains forbidden.
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'feedback_report_events is append-only';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER feedback_report_events_prevent_mutation
BEFORE UPDATE OR DELETE ON feedback_report_events
FOR EACH ROW EXECUTE FUNCTION prevent_feedback_report_events_mutation();
