CREATE TABLE "safety_indicator_denominators" (
	"id" text PRIMARY KEY NOT NULL,
	"worksite_id" text NOT NULL,
	"year" integer NOT NULL,
	"month" integer NOT NULL,
	"worker_count" integer NOT NULL,
	"worked_hours" numeric(14, 2) NOT NULL,
	"source_type" text NOT NULL,
	"source_reference" text NOT NULL,
	"evidence_reference" text,
	"evidence_checksum_sha256" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"reconciliation_status" text DEFAULT 'pending' NOT NULL,
	"reconciliation_notes" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by_user_id" text NOT NULL,
	"updated_by_user_id" text NOT NULL,
	"approved_by_user_id" text,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "safety_indicator_denominator_month_check" CHECK ("safety_indicator_denominators"."month" BETWEEN 1 AND 12),
	CONSTRAINT "safety_indicator_denominator_year_check" CHECK ("safety_indicator_denominators"."year" BETWEEN 2024 AND 2100),
	CONSTRAINT "safety_indicator_denominator_values_check" CHECK ("safety_indicator_denominators"."worker_count" >= 0 AND "safety_indicator_denominators"."worked_hours" >= 0),
	CONSTRAINT "safety_indicator_denominator_source_check" CHECK ("safety_indicator_denominators"."source_type" IN ('rrhh', 'xlsx_import', 'manual', 'other_system')),
	CONSTRAINT "safety_indicator_denominator_status_check" CHECK ("safety_indicator_denominators"."status" IN ('draft', 'pending_review', 'approved', 'rejected')),
	CONSTRAINT "safety_indicator_denominator_reconciliation_check" CHECK ("safety_indicator_denominators"."reconciliation_status" IN ('pending', 'matched', 'difference', 'exception')),
	CONSTRAINT "safety_indicator_denominator_version_check" CHECK ("safety_indicator_denominators"."version" >= 1),
	CONSTRAINT "safety_indicator_denominator_checksum_check" CHECK ("safety_indicator_denominators"."evidence_checksum_sha256" IS NULL OR length("safety_indicator_denominators"."evidence_checksum_sha256") = 64),
	CONSTRAINT "safety_indicator_denominator_approval_evidence_check" CHECK ("safety_indicator_denominators"."status" <> 'approved' OR ("safety_indicator_denominators"."approved_by_user_id" IS NOT NULL AND "safety_indicator_denominators"."approved_at" IS NOT NULL AND "safety_indicator_denominators"."evidence_reference" IS NOT NULL AND "safety_indicator_denominators"."reconciliation_status" <> 'pending'))
);
--> statement-breakpoint
CREATE TABLE "safety_indicator_history" (
	"id" text PRIMARY KEY NOT NULL,
	"worksite_id" text NOT NULL,
	"year" integer NOT NULL,
	"month" integer,
	"change_type" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"reason" text NOT NULL,
	"before_state" jsonb,
	"after_state" jsonb,
	"actor_user_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "safety_indicator_history_month_check" CHECK ("safety_indicator_history"."month" IS NULL OR "safety_indicator_history"."month" BETWEEN 1 AND 12),
	CONSTRAINT "safety_indicator_history_change_check" CHECK ("safety_indicator_history"."change_type" IN ('denominator_created', 'denominator_updated', 'denominator_submitted', 'denominator_approved', 'denominator_rejected', 'recalculated', 'closed', 'corrected', 'superseded')),
	CONSTRAINT "safety_indicator_history_entity_check" CHECK ("safety_indicator_history"."entity_type" IN ('denominator', 'snapshot', 'period', 'incident_person'))
);
--> statement-breakpoint
CREATE TABLE "safety_indicator_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"worksite_id" text NOT NULL,
	"period_type" text NOT NULL,
	"year" integer NOT NULL,
	"start_month" integer NOT NULL,
	"end_month" integer NOT NULL,
	"formula_version" text NOT NULL,
	"source_hash_sha256" text NOT NULL,
	"input_snapshot" jsonb NOT NULL,
	"result_snapshot" jsonb NOT NULL,
	"status" text NOT NULL,
	"has_pending_cases" boolean DEFAULT false NOT NULL,
	"reconciliation_status" text NOT NULL,
	"legacy_comparison" jsonb,
	"superseded_by_id" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by_user_id" text NOT NULL,
	"approved_by_user_id" text,
	"approval_reason" text,
	"created_at" timestamp with time zone NOT NULL,
	"approved_at" timestamp with time zone,
	CONSTRAINT "safety_indicator_snapshot_period_type_check" CHECK ("safety_indicator_snapshots"."period_type" IN ('monthly', 'semester', 'annual')),
	CONSTRAINT "safety_indicator_snapshot_months_check" CHECK ("safety_indicator_snapshots"."start_month" BETWEEN 1 AND 12 AND "safety_indicator_snapshots"."end_month" BETWEEN "safety_indicator_snapshots"."start_month" AND 12),
	CONSTRAINT "safety_indicator_snapshot_status_check" CHECK ("safety_indicator_snapshots"."status" IN ('provisional', 'approved', 'superseded')),
	CONSTRAINT "safety_indicator_snapshot_reconciliation_check" CHECK ("safety_indicator_snapshots"."reconciliation_status" IN ('pending', 'matched', 'difference', 'exception')),
	CONSTRAINT "safety_indicator_snapshot_hash_check" CHECK (length("safety_indicator_snapshots"."source_hash_sha256") = 64),
	CONSTRAINT "safety_indicator_snapshot_version_check" CHECK ("safety_indicator_snapshots"."version" >= 1),
	CONSTRAINT "safety_indicator_snapshot_approval_check" CHECK ("safety_indicator_snapshots"."status" <> 'approved' OR ("safety_indicator_snapshots"."approved_by_user_id" IS NOT NULL AND "safety_indicator_snapshots"."approved_at" IS NOT NULL AND "safety_indicator_snapshots"."approval_reason" IS NOT NULL AND "safety_indicator_snapshots"."has_pending_cases" = false AND "safety_indicator_snapshots"."reconciliation_status" = 'matched'))
);
--> statement-breakpoint
ALTER TABLE "safety_indicator_periods" ADD COLUMN "snapshot_id" text;--> statement-breakpoint
ALTER TABLE "safety_indicator_periods" ADD COLUMN "close_reason" text;--> statement-breakpoint
ALTER TABLE "safety_indicator_periods" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "safety_indicators" ADD COLUMN "provenance_status" text DEFAULT 'manual_legacy' NOT NULL;--> statement-breakpoint
ALTER TABLE "safety_indicators" ADD COLUMN "reconciled_snapshot_id" text;--> statement-breakpoint
ALTER TABLE "safety_indicators" ADD COLUMN "reconciled_by_user_id" text;--> statement-breakpoint
ALTER TABLE "safety_indicators" ADD COLUMN "reconciled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "prevention_incident_people" ADD COLUMN "indicator_inclusion_status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "prevention_incident_people" ADD COLUMN "indicator_inclusion_reason" text;--> statement-breakpoint
ALTER TABLE "prevention_incident_people" ADD COLUMN "indicator_classified_by_user_id" text;--> statement-breakpoint
ALTER TABLE "prevention_incident_people" ADD COLUMN "indicator_classified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "prevention_incident_people" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "safety_indicator_denominators" ADD CONSTRAINT "safety_indicator_denominators_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safety_indicator_denominators" ADD CONSTRAINT "safety_indicator_denominators_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safety_indicator_denominators" ADD CONSTRAINT "safety_indicator_denominators_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safety_indicator_denominators" ADD CONSTRAINT "safety_indicator_denominators_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safety_indicator_history" ADD CONSTRAINT "safety_indicator_history_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safety_indicator_history" ADD CONSTRAINT "safety_indicator_history_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safety_indicator_snapshots" ADD CONSTRAINT "safety_indicator_snapshots_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safety_indicator_snapshots" ADD CONSTRAINT "safety_indicator_snapshots_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safety_indicator_snapshots" ADD CONSTRAINT "safety_indicator_snapshots_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "safety_indicator_denominator_period_unique" ON "safety_indicator_denominators" USING btree ("worksite_id","year","month");--> statement-breakpoint
CREATE INDEX "safety_indicator_denominator_status_idx" ON "safety_indicator_denominators" USING btree ("status","reconciliation_status");--> statement-breakpoint
CREATE INDEX "safety_indicator_history_period_idx" ON "safety_indicator_history" USING btree ("worksite_id","year","month","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "safety_indicator_snapshot_source_unique" ON "safety_indicator_snapshots" USING btree ("worksite_id","period_type","year","start_month","end_month","source_hash_sha256");--> statement-breakpoint
CREATE INDEX "safety_indicator_snapshot_period_idx" ON "safety_indicator_snapshots" USING btree ("worksite_id","year","start_month","end_month","status");--> statement-breakpoint
ALTER TABLE "safety_indicators" ADD CONSTRAINT "safety_indicators_reconciled_by_user_id_users_id_fk" FOREIGN KEY ("reconciled_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_incident_people" ADD CONSTRAINT "prevention_incident_people_indicator_classified_by_user_id_users_id_fk" FOREIGN KEY ("indicator_classified_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safety_indicator_periods" ADD CONSTRAINT "safety_indicator_periods_version_check" CHECK ("safety_indicator_periods"."version" >= 1);--> statement-breakpoint
ALTER TABLE "safety_indicators" ADD CONSTRAINT "safety_indicators_provenance_check" CHECK ("safety_indicators"."provenance_status" IN ('manual_legacy', 'difference', 'reconciled'));--> statement-breakpoint
ALTER TABLE "prevention_incident_people" ADD CONSTRAINT "prevention_incident_person_indicator_status_valid" CHECK ("prevention_incident_people"."indicator_inclusion_status" IN ('pending', 'included', 'excluded'));--> statement-breakpoint
ALTER TABLE "prevention_incident_people" ADD CONSTRAINT "prevention_incident_person_indicator_classification_consistent" CHECK ("prevention_incident_people"."indicator_inclusion_status" = 'pending' OR ("prevention_incident_people"."indicator_inclusion_reason" IS NOT NULL AND "prevention_incident_people"."indicator_classified_by_user_id" IS NOT NULL AND "prevention_incident_people"."indicator_classified_at" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "prevention_incident_people" ADD CONSTRAINT "prevention_incident_person_version_positive" CHECK ("prevention_incident_people"."version" >= 1);