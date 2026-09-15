CREATE TABLE "pdtp_accreditation_bindings" (
	"id" text PRIMARY KEY NOT NULL,
	"source_type" text NOT NULL,
	"source_id" text NOT NULL,
	"event_type" text NOT NULL,
	"catalog_activity_id" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "pdtp_accreditation_bindings_event_type_check" CHECK ("pdtp_accreditation_bindings"."event_type" IN ('execute', 'review', 'publish', 'acknowledge', 'close', 'complete_drill'))
);
--> statement-breakpoint
CREATE TABLE "pdtp_catalog_activities" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"current_revision" integer DEFAULT 1 NOT NULL,
	"retired_reason" text,
	"retired_by_user_id" text,
	"retired_at" timestamp with time zone,
	"created_by_user_id" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "pdtp_catalog_activities_code_check" CHECK ("pdtp_catalog_activities"."code" ~ '^PDT-[A-Z0-9][A-Z0-9-]{2,116}[A-Z0-9]$'),
	CONSTRAINT "pdtp_catalog_activities_status_check" CHECK ("pdtp_catalog_activities"."status" IN ('draft', 'active', 'retired')),
	CONSTRAINT "pdtp_catalog_activities_revision_check" CHECK ("pdtp_catalog_activities"."current_revision" >= 1),
	CONSTRAINT "pdtp_catalog_activities_retirement_check" CHECK ("pdtp_catalog_activities"."status" <> 'retired' OR (
    length(trim(COALESCE("pdtp_catalog_activities"."retired_reason", ''))) >= 10 AND "pdtp_catalog_activities"."retired_at" IS NOT NULL
  ))
);
--> statement-breakpoint
CREATE TABLE "pdtp_catalog_activity_revisions" (
	"id" text PRIMARY KEY NOT NULL,
	"catalog_activity_id" text NOT NULL,
	"revision" integer NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"execution_guidance" text NOT NULL,
	"change_note" text,
	"created_by_user_id" text,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "pdtp_catalog_activity_revisions_revision_check" CHECK ("pdtp_catalog_activity_revisions"."revision" >= 1),
	CONSTRAINT "pdtp_catalog_activity_revisions_title_check" CHECK (length(trim("pdtp_catalog_activity_revisions"."title")) BETWEEN 3 AND 80),
	CONSTRAINT "pdtp_catalog_activity_revisions_description_check" CHECK (length(trim("pdtp_catalog_activity_revisions"."description")) >= 3),
	CONSTRAINT "pdtp_catalog_activity_revisions_guidance_check" CHECK (length(trim("pdtp_catalog_activity_revisions"."execution_guidance")) >= 2)
);
--> statement-breakpoint
CREATE TABLE "pdtp_fulfillment_event_targets" (
	"id" text PRIMARY KEY NOT NULL,
	"event_id" text NOT NULL,
	"catalog_activity_id" text NOT NULL,
	"resolved_activity_id" text,
	"activity_number_snapshot" integer,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "pdtp_fulfillment_event_targets_number_check" CHECK ("pdtp_fulfillment_event_targets"."activity_number_snapshot" IS NULL OR "pdtp_fulfillment_event_targets"."activity_number_snapshot" >= 1)
);
--> statement-breakpoint
ALTER TABLE "pdtp_activities" ADD COLUMN "catalog_activity_id" text;--> statement-breakpoint
ALTER TABLE "pdtp_activities" ADD COLUMN "catalog_revision" integer;--> statement-breakpoint
ALTER TABLE "pdtp_accreditation_bindings" ADD CONSTRAINT "pdtp_accreditation_bindings_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdtp_accreditation_bindings" ADD CONSTRAINT "pdtp_binding_catalog_activity_fk" FOREIGN KEY ("catalog_activity_id") REFERENCES "public"."pdtp_catalog_activities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdtp_catalog_activities" ADD CONSTRAINT "pdtp_catalog_activities_retired_by_user_id_users_id_fk" FOREIGN KEY ("retired_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdtp_catalog_activities" ADD CONSTRAINT "pdtp_catalog_activities_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdtp_catalog_activity_revisions" ADD CONSTRAINT "pdtp_catalog_activity_revisions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdtp_catalog_activity_revisions" ADD CONSTRAINT "pdtp_revision_catalog_activity_fk" FOREIGN KEY ("catalog_activity_id") REFERENCES "public"."pdtp_catalog_activities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdtp_fulfillment_event_targets" ADD CONSTRAINT "pdtp_event_target_event_fk" FOREIGN KEY ("event_id") REFERENCES "public"."pdtp_fulfillment_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdtp_fulfillment_event_targets" ADD CONSTRAINT "pdtp_event_target_catalog_activity_fk" FOREIGN KEY ("catalog_activity_id") REFERENCES "public"."pdtp_catalog_activities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdtp_fulfillment_event_targets" ADD CONSTRAINT "pdtp_event_target_annual_activity_fk" FOREIGN KEY ("resolved_activity_id") REFERENCES "public"."pdtp_activities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pdtp_accreditation_bindings_unique" ON "pdtp_accreditation_bindings" USING btree ("source_type","source_id","event_type","catalog_activity_id");--> statement-breakpoint
CREATE INDEX "pdtp_accreditation_bindings_source_idx" ON "pdtp_accreditation_bindings" USING btree ("source_type","source_id","event_type");--> statement-breakpoint
CREATE INDEX "pdtp_accreditation_bindings_activity_idx" ON "pdtp_accreditation_bindings" USING btree ("catalog_activity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pdtp_catalog_activities_code_unique" ON "pdtp_catalog_activities" USING btree ("code");--> statement-breakpoint
CREATE INDEX "pdtp_catalog_activities_status_idx" ON "pdtp_catalog_activities" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "pdtp_catalog_activity_revisions_identity_unique" ON "pdtp_catalog_activity_revisions" USING btree ("catalog_activity_id","revision");--> statement-breakpoint
CREATE INDEX "pdtp_catalog_activity_revisions_activity_idx" ON "pdtp_catalog_activity_revisions" USING btree ("catalog_activity_id","revision");--> statement-breakpoint
CREATE UNIQUE INDEX "pdtp_fulfillment_event_targets_identity_unique" ON "pdtp_fulfillment_event_targets" USING btree ("event_id","catalog_activity_id");--> statement-breakpoint
CREATE INDEX "pdtp_fulfillment_event_targets_catalog_idx" ON "pdtp_fulfillment_event_targets" USING btree ("catalog_activity_id");--> statement-breakpoint
CREATE INDEX "pdtp_fulfillment_event_targets_resolved_idx" ON "pdtp_fulfillment_event_targets" USING btree ("resolved_activity_id");--> statement-breakpoint
ALTER TABLE "pdtp_activities" ADD CONSTRAINT "pdtp_activities_catalog_revision_fk" FOREIGN KEY ("catalog_activity_id","catalog_revision") REFERENCES "public"."pdtp_catalog_activity_revisions"("catalog_activity_id","revision") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pdtp_activities_program_catalog_unique" ON "pdtp_activities" USING btree ("program_id","catalog_activity_id");--> statement-breakpoint
ALTER TABLE "pdtp_activities" ADD CONSTRAINT "pdtp_activities_catalog_revision_pair_check" CHECK (("pdtp_activities"."catalog_activity_id" IS NULL) = ("pdtp_activities"."catalog_revision" IS NULL));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION prevent_pdtp_catalog_revision_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'La revisión de actividad PDTP es inmutable';
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS pdtp_catalog_revision_immutable ON pdtp_catalog_activity_revisions;
--> statement-breakpoint
CREATE TRIGGER pdtp_catalog_revision_immutable
BEFORE UPDATE OR DELETE ON pdtp_catalog_activity_revisions
FOR EACH ROW EXECUTE FUNCTION prevent_pdtp_catalog_revision_mutation();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION prevent_pdtp_catalog_code_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.code IS DISTINCT FROM OLD.code THEN
    RAISE EXCEPTION 'El código de actividad PDTP es inmutable';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS pdtp_catalog_code_immutable ON pdtp_catalog_activities;
--> statement-breakpoint
CREATE TRIGGER pdtp_catalog_code_immutable
BEFORE UPDATE OF code ON pdtp_catalog_activities
FOR EACH ROW EXECUTE FUNCTION prevent_pdtp_catalog_code_mutation();
