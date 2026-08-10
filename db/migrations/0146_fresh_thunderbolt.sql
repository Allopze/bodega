CREATE TABLE "traceability_integrity_cases" (
	"id" text PRIMARY KEY NOT NULL,
	"finding_key" text NOT NULL,
	"request_item_id" text NOT NULL,
	"worksite_id" text NOT NULL,
	"finding_code" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "traceability_integrity_case_code_valid" CHECK (
    "traceability_integrity_cases"."finding_code" IN ('DELIVERY_EXCEEDS_FAENA_RECEIPT', 'DELIVERY_BEFORE_FAENA_RECEIPT')
  )
);
--> statement-breakpoint
CREATE TABLE "traceability_integrity_resolutions" (
	"id" text PRIMARY KEY NOT NULL,
	"case_id" text NOT NULL,
	"action" text NOT NULL,
	"reason" text NOT NULL,
	"compensating_movement_id" text,
	"resolved_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "traceability_integrity_resolution_action_valid" CHECK (
    "traceability_integrity_resolutions"."action" IN ('acknowledge', 'compensating_movement')
  ),
	CONSTRAINT "traceability_integrity_resolution_reason_length" CHECK (
    char_length(trim("traceability_integrity_resolutions"."reason")) BETWEEN 10 AND 2000
  ),
	CONSTRAINT "traceability_integrity_resolution_movement_required" CHECK (
    ("traceability_integrity_resolutions"."action" = 'acknowledge' AND "traceability_integrity_resolutions"."compensating_movement_id" IS NULL)
    OR ("traceability_integrity_resolutions"."action" = 'compensating_movement' AND "traceability_integrity_resolutions"."compensating_movement_id" IS NOT NULL)
  )
);
--> statement-breakpoint
ALTER TABLE "traceability_integrity_cases" ADD CONSTRAINT "traceability_integrity_cases_request_item_id_purchase_request_items_id_fk" FOREIGN KEY ("request_item_id") REFERENCES "public"."purchase_request_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "traceability_integrity_cases" ADD CONSTRAINT "traceability_integrity_cases_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "traceability_integrity_resolutions" ADD CONSTRAINT "traceability_integrity_resolutions_case_id_traceability_integrity_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."traceability_integrity_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "traceability_integrity_resolutions" ADD CONSTRAINT "traceability_integrity_resolutions_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "traceability_integrity_cases_finding_key_unique" ON "traceability_integrity_cases" USING btree ("finding_key");--> statement-breakpoint
CREATE INDEX "traceability_integrity_cases_worksite_detected_at_idx" ON "traceability_integrity_cases" USING btree ("worksite_id","detected_at");--> statement-breakpoint
CREATE INDEX "traceability_integrity_cases_request_item_idx" ON "traceability_integrity_cases" USING btree ("request_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "traceability_integrity_resolutions_case_unique" ON "traceability_integrity_resolutions" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "traceability_integrity_resolutions_created_at_idx" ON "traceability_integrity_resolutions" USING btree ("created_at");