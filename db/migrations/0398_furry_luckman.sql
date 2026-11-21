CREATE TABLE "worksite_aliases" (
	"id" text PRIMARY KEY NOT NULL,
	"worksite_id" text NOT NULL,
	"alias_text" text NOT NULL,
	"alias_key" text NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fleet_owners" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fleet_owners_kind_valid" CHECK ("fleet_owners"."kind" IN ('propia', 'relacionada', 'financiera', 'tercero')),
	CONSTRAINT "fleet_owners_name_valid" CHECK (char_length(trim("fleet_owners"."name")) >= 2)
);
--> statement-breakpoint
CREATE TABLE "mant_historical_findings" (
	"source_key" text PRIMARY KEY NOT NULL,
	"inspection_source_key" text NOT NULL,
	"source_row" integer NOT NULL,
	"found_on" text NOT NULL,
	"section" text NOT NULL,
	"item" text NOT NULL,
	"condition" text NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mant_historical_findings_condition_valid" CHECK ("mant_historical_findings"."condition" IN ('regular', 'mal', 'no_tiene')),
	CONSTRAINT "mant_historical_findings_source_row_valid" CHECK ("mant_historical_findings"."source_row" >= 2)
);
--> statement-breakpoint
CREATE TABLE "mant_historical_inspections" (
	"source_key" text PRIMARY KEY NOT NULL,
	"fingerprint" text NOT NULL,
	"source_file" text NOT NULL,
	"source_sheet" text NOT NULL,
	"source_row" integer NOT NULL,
	"source_record_id" text,
	"submitted_at" text NOT NULL,
	"inspection_date" text NOT NULL,
	"form_kind" text NOT NULL,
	"unit_kind" text NOT NULL,
	"equipment_text" text NOT NULL,
	"vehicle_id" text,
	"equipment_match" text NOT NULL,
	"worksite_text" text NOT NULL,
	"worksite_id" text,
	"reading" numeric(14, 1),
	"good_count" integer DEFAULT 0 NOT NULL,
	"regular_count" integer DEFAULT 0 NOT NULL,
	"bad_count" integer DEFAULT 0 NOT NULL,
	"missing_count" integer DEFAULT 0 NOT NULL,
	"not_applicable_count" integer DEFAULT 0 NOT NULL,
	"fields" jsonb NOT NULL,
	"imported_by" text NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mant_historical_inspections_source_row_valid" CHECK ("mant_historical_inspections"."source_row" >= 2),
	CONSTRAINT "mant_historical_inspections_match_valid" CHECK (("mant_historical_inspections"."equipment_match" = 'linked' AND "mant_historical_inspections"."vehicle_id" IS NOT NULL) OR ("mant_historical_inspections"."equipment_match" IN ('unmatched', 'conflict') AND "mant_historical_inspections"."vehicle_id" IS NULL)),
	CONSTRAINT "mant_historical_inspections_counts_valid" CHECK ("mant_historical_inspections"."good_count" >= 0 AND "mant_historical_inspections"."regular_count" >= 0 AND "mant_historical_inspections"."bad_count" >= 0 AND "mant_historical_inspections"."missing_count" >= 0 AND "mant_historical_inspections"."not_applicable_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "mant_historical_schedule_checks" (
	"source_key" text PRIMARY KEY NOT NULL,
	"fingerprint" text NOT NULL,
	"source_file" text NOT NULL,
	"source_sheet" text NOT NULL,
	"source_row" integer NOT NULL,
	"submitted_at" text NOT NULL,
	"performed_on" text,
	"form_kind" text NOT NULL,
	"schedule_label" text NOT NULL,
	"equipment_text" text NOT NULL,
	"vehicle_id" text,
	"equipment_match" text NOT NULL,
	"worksite_text" text NOT NULL,
	"worksite_id" text,
	"reading" numeric(14, 1),
	"done_count" integer DEFAULT 0 NOT NULL,
	"not_done_count" integer DEFAULT 0 NOT NULL,
	"not_applicable_count" integer DEFAULT 0 NOT NULL,
	"compliance" numeric(5, 4),
	"is_test" boolean DEFAULT false NOT NULL,
	"fields" jsonb NOT NULL,
	"imported_by" text NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mant_historical_schedule_checks_source_row_valid" CHECK ("mant_historical_schedule_checks"."source_row" >= 2),
	CONSTRAINT "mant_historical_schedule_checks_match_valid" CHECK (("mant_historical_schedule_checks"."equipment_match" = 'linked' AND "mant_historical_schedule_checks"."vehicle_id" IS NOT NULL) OR ("mant_historical_schedule_checks"."equipment_match" IN ('unmatched', 'conflict') AND "mant_historical_schedule_checks"."vehicle_id" IS NULL)),
	CONSTRAINT "mant_historical_schedule_checks_counts_valid" CHECK ("mant_historical_schedule_checks"."done_count" >= 0 AND "mant_historical_schedule_checks"."not_done_count" >= 0 AND "mant_historical_schedule_checks"."not_applicable_count" >= 0),
	CONSTRAINT "mant_historical_schedule_checks_compliance_valid" CHECK ("mant_historical_schedule_checks"."compliance" IS NULL OR ("mant_historical_schedule_checks"."compliance" >= 0 AND "mant_historical_schedule_checks"."compliance" <= 1))
);
--> statement-breakpoint
ALTER TABLE "worksites" ADD COLUMN "kind" text DEFAULT 'operacion' NOT NULL;--> statement-breakpoint
ALTER TABLE "fuel_vehicles" ADD COLUMN "owner_id" text;--> statement-breakpoint
ALTER TABLE "fuel_vehicles" ADD COLUMN "location_pending_confirmation" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "mant_work_orders" ADD COLUMN "action_type" text;--> statement-breakpoint
ALTER TABLE "mant_work_orders" ADD COLUMN "specialties" text[];--> statement-breakpoint
ALTER TABLE "mant_work_orders" ADD COLUMN "labor_hours" numeric(8, 2);--> statement-breakpoint
ALTER TABLE "mant_work_orders" ADD COLUMN "execution_worksite_id" text;--> statement-breakpoint
ALTER TABLE "mant_work_orders" ADD COLUMN "work_performed" text;--> statement-breakpoint
ALTER TABLE "mant_historical_records" ADD COLUMN "source_record_id" text;--> statement-breakpoint
ALTER TABLE "mant_historical_records" ADD COLUMN "origin_source" text;--> statement-breakpoint
ALTER TABLE "mant_historical_records" ADD COLUMN "action_type" text;--> statement-breakpoint
ALTER TABLE "mant_historical_records" ADD COLUMN "labor_hours" numeric(8, 2);--> statement-breakpoint
ALTER TABLE "mant_historical_records" ADD COLUMN "downtime_days" numeric(7, 1);--> statement-breakpoint
ALTER TABLE "mant_historical_records" ADD COLUMN "specialties" text[];--> statement-breakpoint
ALTER TABLE "mant_historical_records" ADD COLUMN "contract_text" text;--> statement-breakpoint
ALTER TABLE "mant_historical_records" ADD COLUMN "quality_notes" text;--> statement-breakpoint
ALTER TABLE "mant_historical_records" ADD COLUMN "is_test" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "worksite_aliases" ADD CONSTRAINT "worksite_aliases_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worksite_aliases" ADD CONSTRAINT "worksite_aliases_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mant_historical_findings" ADD CONSTRAINT "mant_historical_findings_inspection_fk" FOREIGN KEY ("inspection_source_key") REFERENCES "public"."mant_historical_inspections"("source_key") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mant_historical_inspections" ADD CONSTRAINT "mant_historical_inspections_vehicle_id_fuel_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."fuel_vehicles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mant_historical_inspections" ADD CONSTRAINT "mant_historical_inspections_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mant_historical_inspections" ADD CONSTRAINT "mant_historical_inspections_imported_by_users_id_fk" FOREIGN KEY ("imported_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mant_historical_schedule_checks" ADD CONSTRAINT "mant_historical_schedule_checks_vehicle_id_fuel_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."fuel_vehicles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mant_historical_schedule_checks" ADD CONSTRAINT "mant_historical_schedule_checks_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mant_historical_schedule_checks" ADD CONSTRAINT "mant_historical_schedule_checks_imported_by_users_id_fk" FOREIGN KEY ("imported_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "worksite_aliases_key_unique" ON "worksite_aliases" USING btree ("alias_key");--> statement-breakpoint
CREATE INDEX "worksite_aliases_worksite_idx" ON "worksite_aliases" USING btree ("worksite_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fleet_owners_name_unique" ON "fleet_owners" USING btree (lower("name"));--> statement-breakpoint
CREATE INDEX "mant_historical_findings_inspection_idx" ON "mant_historical_findings" USING btree ("inspection_source_key");--> statement-breakpoint
CREATE INDEX "mant_historical_findings_condition_date_idx" ON "mant_historical_findings" USING btree ("condition","found_on");--> statement-breakpoint
CREATE INDEX "mant_historical_inspections_vehicle_date_idx" ON "mant_historical_inspections" USING btree ("vehicle_id","inspection_date");--> statement-breakpoint
CREATE INDEX "mant_historical_inspections_worksite_date_idx" ON "mant_historical_inspections" USING btree ("worksite_id","inspection_date");--> statement-breakpoint
CREATE INDEX "mant_historical_schedule_checks_vehicle_date_idx" ON "mant_historical_schedule_checks" USING btree ("vehicle_id","performed_on");--> statement-breakpoint
CREATE INDEX "mant_historical_schedule_checks_worksite_date_idx" ON "mant_historical_schedule_checks" USING btree ("worksite_id","performed_on");--> statement-breakpoint
ALTER TABLE "fuel_vehicles" ADD CONSTRAINT "fuel_vehicles_owner_id_fleet_owners_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."fleet_owners"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mant_work_orders" ADD CONSTRAINT "mant_work_orders_execution_worksite_id_worksites_id_fk" FOREIGN KEY ("execution_worksite_id") REFERENCES "public"."worksites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "fuel_vehicles_code_key_unique" ON "fuel_vehicles" USING btree (regexp_replace(upper(regexp_replace("code", '[^A-Za-z0-9]', '', 'g')), '^([A-Z]+)0+([0-9])', '\1\2')) WHERE "fuel_vehicles"."code" IS NOT NULL AND btrim("fuel_vehicles"."code") <> '';--> statement-breakpoint
CREATE INDEX "fuel_vehicles_owner_idx" ON "fuel_vehicles" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "mant_work_orders_action_type_idx" ON "mant_work_orders" USING btree ("action_type");--> statement-breakpoint
CREATE INDEX "mant_historical_records_source_record_idx" ON "mant_historical_records" USING btree ("source_record_id");--> statement-breakpoint
ALTER TABLE "worksites" ADD CONSTRAINT "worksites_kind_valid" CHECK ("worksites"."kind" IN ('operacion', 'deposito', 'administracion'));--> statement-breakpoint
ALTER TABLE "mant_work_orders" ADD CONSTRAINT "mant_work_orders_action_type_valid" CHECK ("mant_work_orders"."action_type" IS NULL OR "mant_work_orders"."action_type" IN ('preventiva', 'correctiva', 'predictiva'));--> statement-breakpoint
ALTER TABLE "mant_work_orders" ADD CONSTRAINT "mant_work_orders_specialties_valid" CHECK ("mant_work_orders"."specialties" IS NULL OR "mant_work_orders"."specialties" <@ ARRAY['mecanica', 'electrica', 'soldadura', 'hidraulica']::text[]);--> statement-breakpoint
ALTER TABLE "mant_work_orders" ADD CONSTRAINT "mant_work_orders_labor_hours_valid" CHECK ("mant_work_orders"."labor_hours" IS NULL OR ("mant_work_orders"."labor_hours" >= 0 AND "mant_work_orders"."labor_hours" <= 10000));--> statement-breakpoint
ALTER TABLE "mant_historical_records" ADD CONSTRAINT "mant_historical_records_action_type_valid" CHECK ("mant_historical_records"."action_type" IS NULL OR "mant_historical_records"."action_type" IN ('preventiva', 'correctiva', 'predictiva', 'sin_clasificar'));--> statement-breakpoint
ALTER TABLE "mant_historical_records" ADD CONSTRAINT "mant_historical_records_specialties_valid" CHECK ("mant_historical_records"."specialties" IS NULL OR "mant_historical_records"."specialties" <@ ARRAY['mecanica', 'electrica', 'soldadura', 'hidraulica']::text[]);--> statement-breakpoint
ALTER TABLE "mant_historical_records" ADD CONSTRAINT "mant_historical_records_numbers_valid" CHECK (("mant_historical_records"."labor_hours" IS NULL OR "mant_historical_records"."labor_hours" >= 0) AND ("mant_historical_records"."downtime_days" IS NULL OR "mant_historical_records"."downtime_days" >= 0));