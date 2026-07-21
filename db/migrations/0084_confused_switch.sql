CREATE TABLE "prevention_exposure_agents" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"agent_type" text NOT NULL,
	"unit" text NOT NULL,
	"permissible_limit" numeric(14, 4),
	"action_level_factor" numeric(5, 4) DEFAULT '0.5' NOT NULL,
	"limit_basis" text NOT NULL,
	"surveillance_protocol" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prevention_exposure_agents_code_unique" UNIQUE("code"),
	CONSTRAINT "prevention_exposure_agent_type_valid" CHECK ("prevention_exposure_agents"."agent_type" IN ('chemical', 'physical', 'biological', 'ergonomic', 'psychosocial')),
	CONSTRAINT "prevention_exposure_agent_basis_valid" CHECK (length("prevention_exposure_agents"."limit_basis") >= 5),
	CONSTRAINT "prevention_exposure_agent_action_factor_valid" CHECK ("prevention_exposure_agents"."action_level_factor" > 0 AND "prevention_exposure_agents"."action_level_factor" <= 1),
	CONSTRAINT "prevention_exposure_agent_limit_positive" CHECK ("prevention_exposure_agents"."permissible_limit" IS NULL OR "prevention_exposure_agents"."permissible_limit" > 0)
);
--> statement-breakpoint
CREATE TABLE "prevention_exposure_group_members" (
	"id" text PRIMARY KEY NOT NULL,
	"group_id" text NOT NULL,
	"worker_id" text NOT NULL,
	"joined_on" text NOT NULL,
	"left_on" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prevention_exposure_group_member_dates_valid" CHECK ("prevention_exposure_group_members"."left_on" IS NULL OR "prevention_exposure_group_members"."left_on" >= "prevention_exposure_group_members"."joined_on")
);
--> statement-breakpoint
CREATE TABLE "prevention_exposure_groups" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"worksite_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"process_description" text NOT NULL,
	"risk_entry_id" text,
	"surveillance_required" boolean DEFAULT false NOT NULL,
	"surveillance_reason" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prevention_exposure_groups_code_unique" UNIQUE("code"),
	CONSTRAINT "prevention_exposure_group_surveillance_consistent" CHECK ("prevention_exposure_groups"."surveillance_required" = false OR length("prevention_exposure_groups"."surveillance_reason") >= 10),
	CONSTRAINT "prevention_exposure_group_version_positive" CHECK ("prevention_exposure_groups"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "prevention_exposure_measurements" (
	"id" text PRIMARY KEY NOT NULL,
	"group_id" text NOT NULL,
	"measured_on" text NOT NULL,
	"value" numeric(14, 4) NOT NULL,
	"unit" text NOT NULL,
	"permissible_limit_snapshot" numeric(14, 4),
	"action_level_snapshot" numeric(14, 4),
	"outcome" text NOT NULL,
	"method" text NOT NULL,
	"laboratory_name" text,
	"equipment_tag" text NOT NULL,
	"calibration_date" text,
	"sample_duration_minutes" integer,
	"report_reference" text,
	"recorded_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prevention_exposure_measurement_outcome_valid" CHECK ("prevention_exposure_measurements"."outcome" IN ('below_action', 'above_action', 'above_limit', 'not_comparable')),
	CONSTRAINT "prevention_exposure_measurement_value_nonnegative" CHECK ("prevention_exposure_measurements"."value" >= 0),
	CONSTRAINT "prevention_exposure_measurement_duration_valid" CHECK ("prevention_exposure_measurements"."sample_duration_minutes" IS NULL OR "prevention_exposure_measurements"."sample_duration_minutes" > 0)
);
--> statement-breakpoint
CREATE TABLE "prevention_hygiene_history" (
	"id" text PRIMARY KEY NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"worksite_id" text,
	"change_type" text NOT NULL,
	"reason" text NOT NULL,
	"before_state" jsonb,
	"after_state" jsonb,
	"actor_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prevention_surveillance_enrollments" (
	"id" text PRIMARY KEY NOT NULL,
	"program_id" text NOT NULL,
	"worker_id" text NOT NULL,
	"group_id" text,
	"enrolled_on" text NOT NULL,
	"due_on" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"summoned_at" timestamp with time zone,
	"attended_on" text,
	"health_record_id" text,
	"absence_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prevention_surveillance_enrollment_status_valid" CHECK ("prevention_surveillance_enrollments"."status" IN ('pending', 'summoned', 'attended', 'absent', 'exempt')),
	CONSTRAINT "prevention_surveillance_enrollment_attended_consistent" CHECK ("prevention_surveillance_enrollments"."status" <> 'attended' OR "prevention_surveillance_enrollments"."attended_on" IS NOT NULL),
	CONSTRAINT "prevention_surveillance_enrollment_absent_consistent" CHECK ("prevention_surveillance_enrollments"."status" <> 'absent' OR length("prevention_surveillance_enrollments"."absence_reason") >= 5)
);
--> statement-breakpoint
CREATE TABLE "prevention_surveillance_programs" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"protocol" text NOT NULL,
	"agent_id" text,
	"worksite_id" text NOT NULL,
	"periodicity_months" integer NOT NULL,
	"legal_basis" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prevention_surveillance_programs_code_unique" UNIQUE("code"),
	CONSTRAINT "prevention_surveillance_program_status_valid" CHECK ("prevention_surveillance_programs"."status" IN ('active', 'suspended', 'closed')),
	CONSTRAINT "prevention_surveillance_program_periodicity_valid" CHECK ("prevention_surveillance_programs"."periodicity_months" > 0 AND "prevention_surveillance_programs"."periodicity_months" <= 120),
	CONSTRAINT "prevention_surveillance_program_basis_valid" CHECK (length("prevention_surveillance_programs"."legal_basis") >= 5)
);
--> statement-breakpoint
ALTER TABLE "prevention_exposure_agents" ADD CONSTRAINT "prevention_exposure_agents_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_exposure_group_members" ADD CONSTRAINT "prevention_exposure_group_members_group_id_prevention_exposure_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."prevention_exposure_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_exposure_group_members" ADD CONSTRAINT "prevention_exposure_group_members_worker_id_workers_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_exposure_groups" ADD CONSTRAINT "prevention_exposure_groups_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_exposure_groups" ADD CONSTRAINT "prevention_exposure_groups_agent_id_prevention_exposure_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."prevention_exposure_agents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_exposure_groups" ADD CONSTRAINT "prevention_exposure_groups_risk_entry_id_prevention_risk_entries_id_fk" FOREIGN KEY ("risk_entry_id") REFERENCES "public"."prevention_risk_entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_exposure_groups" ADD CONSTRAINT "prevention_exposure_groups_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_exposure_measurements" ADD CONSTRAINT "prevention_exposure_measurements_group_id_prevention_exposure_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."prevention_exposure_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_exposure_measurements" ADD CONSTRAINT "prevention_exposure_measurements_recorded_by_user_id_users_id_fk" FOREIGN KEY ("recorded_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_hygiene_history" ADD CONSTRAINT "prevention_hygiene_history_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_hygiene_history" ADD CONSTRAINT "prevention_hygiene_history_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_surveillance_enrollments" ADD CONSTRAINT "prevention_surveillance_enrollments_program_id_prevention_surveillance_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."prevention_surveillance_programs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_surveillance_enrollments" ADD CONSTRAINT "prevention_surveillance_enrollments_worker_id_workers_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_surveillance_enrollments" ADD CONSTRAINT "prevention_surveillance_enrollments_group_id_prevention_exposure_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."prevention_exposure_groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_surveillance_enrollments" ADD CONSTRAINT "prevention_surveillance_enrollments_health_record_id_prevention_health_records_id_fk" FOREIGN KEY ("health_record_id") REFERENCES "public"."prevention_health_records"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_surveillance_programs" ADD CONSTRAINT "prevention_surveillance_programs_agent_id_prevention_exposure_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."prevention_exposure_agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_surveillance_programs" ADD CONSTRAINT "prevention_surveillance_programs_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_surveillance_programs" ADD CONSTRAINT "prevention_surveillance_programs_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "prevention_exposure_agent_type_idx" ON "prevention_exposure_agents" USING btree ("agent_type","is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "prevention_exposure_group_member_unique" ON "prevention_exposure_group_members" USING btree ("group_id","worker_id") WHERE "prevention_exposure_group_members"."left_on" IS NULL;--> statement-breakpoint
CREATE INDEX "prevention_exposure_group_member_worker_idx" ON "prevention_exposure_group_members" USING btree ("worker_id");--> statement-breakpoint
CREATE INDEX "prevention_exposure_group_worksite_idx" ON "prevention_exposure_groups" USING btree ("worksite_id","is_active");--> statement-breakpoint
CREATE INDEX "prevention_exposure_group_agent_idx" ON "prevention_exposure_groups" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "prevention_exposure_measurement_group_idx" ON "prevention_exposure_measurements" USING btree ("group_id","measured_on");--> statement-breakpoint
CREATE INDEX "prevention_hygiene_history_entity_idx" ON "prevention_hygiene_history" USING btree ("entity_type","entity_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "prevention_surveillance_enrollment_unique" ON "prevention_surveillance_enrollments" USING btree ("program_id","worker_id","due_on");--> statement-breakpoint
CREATE INDEX "prevention_surveillance_enrollment_due_idx" ON "prevention_surveillance_enrollments" USING btree ("due_on","status");--> statement-breakpoint
CREATE INDEX "prevention_surveillance_program_worksite_idx" ON "prevention_surveillance_programs" USING btree ("worksite_id","status");