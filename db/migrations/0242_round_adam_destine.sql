CREATE TABLE "pdtp_fulfillment_events" (
	"id" text PRIMARY KEY NOT NULL,
	"source_type" text NOT NULL,
	"source_id" text NOT NULL,
	"event_type" text NOT NULL,
	"source_version" text,
	"worksite_id" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"quantity" numeric(10, 2) DEFAULT 1 NOT NULL,
	"evidence_ref" text,
	"return_href" text,
	"idempotency_key" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"program_id" text,
	"activity_numbers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"result_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"reconciled_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "pdtp_fulfillment_events_event_type_check" CHECK ("pdtp_fulfillment_events"."event_type" IN ('completed', 'revoked')),
	CONSTRAINT "pdtp_fulfillment_events_status_check" CHECK ("pdtp_fulfillment_events"."status" IN ('pending', 'accredited', 'rejected', 'revoked', 'error')),
	CONSTRAINT "pdtp_fulfillment_events_quantity_check" CHECK ("pdtp_fulfillment_events"."quantity" >= 0),
	CONSTRAINT "pdtp_fulfillment_events_attempts_check" CHECK ("pdtp_fulfillment_events"."attempts" >= 0)
);
--> statement-breakpoint
ALTER TABLE "pdtp_fulfillment_events" ADD CONSTRAINT "pdtp_fulfillment_events_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdtp_fulfillment_events" ADD CONSTRAINT "pdtp_fulfillment_events_program_id_pdtp_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."pdtp_programs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pdtp_fulfillment_events_idempotency_key_unique" ON "pdtp_fulfillment_events" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "pdtp_fulfillment_events_status_idx" ON "pdtp_fulfillment_events" USING btree ("status");--> statement-breakpoint
CREATE INDEX "pdtp_fulfillment_events_worksite_period_idx" ON "pdtp_fulfillment_events" USING btree ("worksite_id","occurred_at");--> statement-breakpoint
CREATE INDEX "pdtp_fulfillment_events_source_idx" ON "pdtp_fulfillment_events" USING btree ("source_type","source_id");