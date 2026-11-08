CREATE TABLE "talana_absences" (
	"talana_absence_id" integer PRIMARY KEY NOT NULL,
	"rut" text NOT NULL,
	"absence_type" text,
	"starts_on" text NOT NULL,
	"ends_on" text NOT NULL,
	"return_on" text,
	"status" text,
	"approved" boolean,
	"last_seen_run_id" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "talana_absences_starts_on_valid" CHECK ("talana_absences"."starts_on" IS NULL OR "talana_absences"."starts_on" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
	CONSTRAINT "talana_absences_ends_on_valid" CHECK ("talana_absences"."ends_on" IS NULL OR "talana_absences"."ends_on" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
	CONSTRAINT "talana_absences_return_on_valid" CHECK ("talana_absences"."return_on" IS NULL OR "talana_absences"."return_on" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
	CONSTRAINT "talana_absences_text_lengths_valid" CHECK (
    ("talana_absences"."absence_type" IS NULL OR length("talana_absences"."absence_type") <= 120)
    AND ("talana_absences"."status" IS NULL OR length("talana_absences"."status") <= 60)
  )
);
--> statement-breakpoint
CREATE TABLE "talana_contracts" (
	"talana_contract_id" integer PRIMARY KEY NOT NULL,
	"talana_person_id" integer,
	"rut" text NOT NULL,
	"rut_valid" boolean NOT NULL,
	"first_name" text,
	"last_name_paternal" text,
	"last_name_maternal" text,
	"sex" text,
	"employer_name" text,
	"contract_type" text,
	"cargo" text,
	"cost_center_id" integer,
	"cost_center_name" text,
	"jefe_rut" text,
	"jefe_name" text,
	"hired_on" text,
	"starts_on" text,
	"ends_on" text,
	"finiquitado" boolean NOT NULL,
	"talana_active" boolean,
	"listed_active" boolean DEFAULT false NOT NULL,
	"talana_modified_at" timestamp with time zone,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_run_id" text,
	"missing_since" timestamp with time zone,
	"activation_processed_at" timestamp with time zone,
	"finiquito_processed_at" timestamp with time zone,
	CONSTRAINT "talana_contracts_sex_valid" CHECK ("talana_contracts"."sex" IS NULL OR "talana_contracts"."sex" IN ('M', 'F', 'N')),
	CONSTRAINT "talana_contracts_hired_on_valid" CHECK ("talana_contracts"."hired_on" IS NULL OR "talana_contracts"."hired_on" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
	CONSTRAINT "talana_contracts_starts_on_valid" CHECK ("talana_contracts"."starts_on" IS NULL OR "talana_contracts"."starts_on" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
	CONSTRAINT "talana_contracts_ends_on_valid" CHECK ("talana_contracts"."ends_on" IS NULL OR "talana_contracts"."ends_on" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
	CONSTRAINT "talana_contracts_text_lengths_valid" CHECK (
    length("talana_contracts"."rut") <= 20
    AND ("talana_contracts"."first_name" IS NULL OR length("talana_contracts"."first_name") <= 160)
    AND ("talana_contracts"."last_name_paternal" IS NULL OR length("talana_contracts"."last_name_paternal") <= 160)
    AND ("talana_contracts"."last_name_maternal" IS NULL OR length("talana_contracts"."last_name_maternal") <= 160)
    AND ("talana_contracts"."employer_name" IS NULL OR length("talana_contracts"."employer_name") <= 200)
    AND ("talana_contracts"."contract_type" IS NULL OR length("talana_contracts"."contract_type") <= 120)
    AND ("talana_contracts"."cargo" IS NULL OR length("talana_contracts"."cargo") <= 300)
    AND ("talana_contracts"."cost_center_name" IS NULL OR length("talana_contracts"."cost_center_name") <= 200)
    AND ("talana_contracts"."jefe_rut" IS NULL OR length("talana_contracts"."jefe_rut") <= 20)
    AND ("talana_contracts"."jefe_name" IS NULL OR length("talana_contracts"."jefe_name") <= 300)
  )
);
--> statement-breakpoint
CREATE TABLE "talana_sync_run_items" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"worker_id" text,
	"talana_contract_id" integer,
	"rut" text,
	"kind" text NOT NULL,
	"outcome" text NOT NULL,
	"reason_code" text,
	"before_label" text,
	"after_label" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "talana_sync_run_items_kind_valid" CHECK (
    "talana_sync_run_items"."kind" IN ('alta', 'reactivacion', 'baja', 'traslado', 'cargo', 'jefe', 'sexo')
  ),
	CONSTRAINT "talana_sync_run_items_outcome_valid" CHECK ("talana_sync_run_items"."outcome" IN ('planned', 'applied', 'skipped', 'failed')),
	CONSTRAINT "talana_sync_run_items_sex_without_values" CHECK (
    "talana_sync_run_items"."kind" <> 'sexo' OR ("talana_sync_run_items"."before_label" IS NULL AND "talana_sync_run_items"."after_label" IS NULL)
  ),
	CONSTRAINT "talana_sync_run_items_text_lengths_valid" CHECK (
    ("talana_sync_run_items"."reason_code" IS NULL OR length("talana_sync_run_items"."reason_code") <= 60)
    AND ("talana_sync_run_items"."before_label" IS NULL OR length("talana_sync_run_items"."before_label") <= 200)
    AND ("talana_sync_run_items"."after_label" IS NULL OR length("talana_sync_run_items"."after_label") <= 200)
  )
);
--> statement-breakpoint
CREATE TABLE "talana_sync_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"trigger" text NOT NULL,
	"mode" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"actor_user_id" text,
	"error_code" text,
	"fusible_reason" text,
	"fusible_accepted_at" timestamp with time zone,
	"fusible_accepted_by" text,
	"fusible_bypassed" boolean DEFAULT false NOT NULL,
	"contracts_received" integer DEFAULT 0 NOT NULL,
	"contracts_rejected" integer DEFAULT 0 NOT NULL,
	"active_contracts" integer DEFAULT 0 NOT NULL,
	"previous_active_contracts" integer DEFAULT 0 NOT NULL,
	"unexplained_drop" integer DEFAULT 0 NOT NULL,
	"absences_received" integer DEFAULT 0 NOT NULL,
	"altas" integer DEFAULT 0 NOT NULL,
	"reactivaciones" integer DEFAULT 0 NOT NULL,
	"bajas" integer DEFAULT 0 NOT NULL,
	"traslados" integer DEFAULT 0 NOT NULL,
	"cargos" integer DEFAULT 0 NOT NULL,
	"jefes" integer DEFAULT 0 NOT NULL,
	"sexos" integer DEFAULT 0 NOT NULL,
	"skipped" integer DEFAULT 0 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "talana_sync_runs_trigger_valid" CHECK ("talana_sync_runs"."trigger" IN ('cron', 'manual')),
	CONSTRAINT "talana_sync_runs_mode_valid" CHECK ("talana_sync_runs"."mode" IN ('simulate', 'apply')),
	CONSTRAINT "talana_sync_runs_status_valid" CHECK ("talana_sync_runs"."status" IN ('running', 'success', 'partial', 'failed', 'blocked')),
	CONSTRAINT "talana_sync_runs_error_code_valid" CHECK ("talana_sync_runs"."error_code" IS NULL OR "talana_sync_runs"."error_code" ~ '^TALANA_[A-Z_]+$'),
	CONSTRAINT "talana_sync_runs_failed_has_code" CHECK ("talana_sync_runs"."status" <> 'failed' OR "talana_sync_runs"."error_code" IS NOT NULL),
	CONSTRAINT "talana_sync_runs_fusible_valid" CHECK (
    "talana_sync_runs"."fusible_reason" IS NULL OR "talana_sync_runs"."fusible_reason" IN ('no_active_contracts', 'active_drop', 'mass_altas')
  ),
	CONSTRAINT "talana_sync_runs_blocked_has_reason" CHECK (("talana_sync_runs"."status" = 'blocked') = ("talana_sync_runs"."fusible_reason" IS NOT NULL)),
	CONSTRAINT "talana_sync_runs_counts_valid" CHECK (
    "talana_sync_runs"."contracts_received" >= 0 AND "talana_sync_runs"."contracts_rejected" >= 0 AND "talana_sync_runs"."active_contracts" >= 0
    AND "talana_sync_runs"."previous_active_contracts" >= 0 AND "talana_sync_runs"."unexplained_drop" >= 0 AND "talana_sync_runs"."absences_received" >= 0
    AND "talana_sync_runs"."altas" >= 0 AND "talana_sync_runs"."reactivaciones" >= 0 AND "talana_sync_runs"."bajas" >= 0 AND "talana_sync_runs"."traslados" >= 0
    AND "talana_sync_runs"."cargos" >= 0 AND "talana_sync_runs"."jefes" >= 0 AND "talana_sync_runs"."sexos" >= 0 AND "talana_sync_runs"."skipped" >= 0 AND "talana_sync_runs"."failed" >= 0
  )
);
--> statement-breakpoint
CREATE TABLE "talana_worker_links" (
	"rut" text PRIMARY KEY NOT NULL,
	"worker_id" text,
	"base_cargo_key" text,
	"base_position_id" text,
	"base_cost_center_id" integer,
	"base_worksite_id" text,
	"base_jefe_key" text,
	"base_supervisor" text,
	"base_updated_at" timestamp with time zone,
	"base_run_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "talana_sync_run_items" ADD CONSTRAINT "talana_sync_run_items_run_id_talana_sync_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."talana_sync_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talana_sync_run_items" ADD CONSTRAINT "talana_sync_run_items_worker_id_workers_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talana_sync_runs" ADD CONSTRAINT "talana_sync_runs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talana_sync_runs" ADD CONSTRAINT "talana_sync_runs_fusible_accepted_by_users_id_fk" FOREIGN KEY ("fusible_accepted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talana_worker_links" ADD CONSTRAINT "talana_worker_links_worker_id_workers_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "talana_absences_rut_idx" ON "talana_absences" USING btree ("rut");--> statement-breakpoint
CREATE INDEX "talana_contracts_rut_idx" ON "talana_contracts" USING btree ("rut");--> statement-breakpoint
CREATE INDEX "talana_contracts_listed_active_idx" ON "talana_contracts" USING btree ("listed_active") WHERE "talana_contracts"."listed_active";--> statement-breakpoint
CREATE INDEX "talana_sync_run_items_run_idx" ON "talana_sync_run_items" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "talana_sync_run_items_worker_idx" ON "talana_sync_run_items" USING btree ("worker_id");--> statement-breakpoint
CREATE INDEX "talana_sync_runs_started_idx" ON "talana_sync_runs" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "talana_sync_runs_status_idx" ON "talana_sync_runs" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "talana_worker_links_worker_unique" ON "talana_worker_links" USING btree ("worker_id");