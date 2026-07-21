CREATE TABLE "prevention_jsa_steps" (
	"id" text PRIMARY KEY NOT NULL,
	"permit_id" text NOT NULL,
	"step_order" integer NOT NULL,
	"step_description" text NOT NULL,
	"hazards" jsonb NOT NULL,
	"controls" jsonb NOT NULL,
	"residual_risk" text NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prevention_jsa_step_order_positive" CHECK ("prevention_jsa_steps"."step_order" >= 1),
	CONSTRAINT "prevention_jsa_residual_valid" CHECK ("prevention_jsa_steps"."residual_risk" IN ('low', 'medium', 'high', 'critical'))
);
--> statement-breakpoint
CREATE TABLE "prevention_permit_controls" (
	"id" text PRIMARY KEY NOT NULL,
	"permit_id" text NOT NULL,
	"description" text NOT NULL,
	"is_mandatory" boolean DEFAULT true NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"verified_by_user_id" text,
	"verified_at" timestamp with time zone,
	"not_applicable_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prevention_permit_control_verified_consistent" CHECK ("prevention_permit_controls"."verified" = false OR ("prevention_permit_controls"."verified_by_user_id" IS NOT NULL AND "prevention_permit_controls"."verified_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "prevention_permit_crew" (
	"id" text PRIMARY KEY NOT NULL,
	"permit_id" text NOT NULL,
	"worker_id" text,
	"contractor_worker_id" text,
	"role" text NOT NULL,
	"acknowledged_at" timestamp with time zone,
	"acknowledgement_sha256" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prevention_permit_crew_role_valid" CHECK ("prevention_permit_crew"."role" IN ('executor', 'supervisor', 'standby', 'observer')),
	CONSTRAINT "prevention_permit_crew_one_identity" CHECK (("prevention_permit_crew"."worker_id" IS NOT NULL) <> ("prevention_permit_crew"."contractor_worker_id" IS NOT NULL)),
	CONSTRAINT "prevention_permit_crew_ack_consistent" CHECK (("prevention_permit_crew"."acknowledged_at" IS NULL AND "prevention_permit_crew"."acknowledgement_sha256" IS NULL) OR ("prevention_permit_crew"."acknowledged_at" IS NOT NULL AND length("prevention_permit_crew"."acknowledgement_sha256") = 64))
);
--> statement-breakpoint
CREATE TABLE "prevention_permit_history" (
	"id" text PRIMARY KEY NOT NULL,
	"permit_id" text NOT NULL,
	"change_type" text NOT NULL,
	"from_status" text,
	"to_status" text,
	"reason" text NOT NULL,
	"before_state" jsonb,
	"after_state" jsonb,
	"actor_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prevention_permit_isolations" (
	"id" text PRIMARY KEY NOT NULL,
	"permit_id" text NOT NULL,
	"energy_source" text NOT NULL,
	"equipment_tag" text NOT NULL,
	"isolation_method" text NOT NULL,
	"lock_tag_id" text NOT NULL,
	"applied_by_user_id" text,
	"applied_at" timestamp with time zone,
	"verified_zero_energy" boolean DEFAULT false NOT NULL,
	"removed_by_user_id" text,
	"removed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prevention_permit_isolation_energy_valid" CHECK ("prevention_permit_isolations"."energy_source" IN ('electrical', 'mechanical', 'hydraulic', 'pneumatic', 'thermal', 'chemical', 'gravitational', 'other')),
	CONSTRAINT "prevention_permit_isolation_applied_consistent" CHECK (("prevention_permit_isolations"."applied_at" IS NULL AND "prevention_permit_isolations"."applied_by_user_id" IS NULL) OR ("prevention_permit_isolations"."applied_at" IS NOT NULL AND "prevention_permit_isolations"."applied_by_user_id" IS NOT NULL)),
	CONSTRAINT "prevention_permit_isolation_removed_consistent" CHECK (("prevention_permit_isolations"."removed_at" IS NULL AND "prevention_permit_isolations"."removed_by_user_id" IS NULL) OR ("prevention_permit_isolations"."removed_at" IS NOT NULL AND "prevention_permit_isolations"."removed_by_user_id" IS NOT NULL AND "prevention_permit_isolations"."applied_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "prevention_permit_measurements" (
	"id" text PRIMARY KEY NOT NULL,
	"permit_id" text NOT NULL,
	"parameter" text NOT NULL,
	"value" numeric(12, 4) NOT NULL,
	"unit" text NOT NULL,
	"acceptable_min" numeric(12, 4),
	"acceptable_max" numeric(12, 4),
	"within_range" boolean NOT NULL,
	"equipment_tag" text NOT NULL,
	"calibration_date" text,
	"taken_by_user_id" text NOT NULL,
	"taken_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prevention_permit_types" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"competency_task_key" text,
	"requires_isolation" boolean DEFAULT false NOT NULL,
	"requires_measurement" boolean DEFAULT false NOT NULL,
	"requires_jsa" boolean DEFAULT true NOT NULL,
	"measurement_validity_minutes" integer,
	"max_duration_hours" integer DEFAULT 12 NOT NULL,
	"legal_basis" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prevention_permit_types_code_unique" UNIQUE("code"),
	CONSTRAINT "prevention_permit_type_duration_valid" CHECK ("prevention_permit_types"."max_duration_hours" > 0 AND "prevention_permit_types"."max_duration_hours" <= 72),
	CONSTRAINT "prevention_permit_type_measurement_validity" CHECK ("prevention_permit_types"."requires_measurement" = false OR "prevention_permit_types"."measurement_validity_minutes" > 0),
	CONSTRAINT "prevention_permit_type_basis_valid" CHECK (length("prevention_permit_types"."legal_basis") >= 5)
);
--> statement-breakpoint
CREATE TABLE "prevention_work_permits" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"permit_type_id" text NOT NULL,
	"worksite_id" text NOT NULL,
	"task_description" text NOT NULL,
	"location" text NOT NULL,
	"risk_entry_id" text,
	"supervisor_user_id" text NOT NULL,
	"planned_start_at" timestamp with time zone NOT NULL,
	"planned_end_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"requested_by_user_id" text NOT NULL,
	"submitted_at" timestamp with time zone,
	"approved_by_user_id" text,
	"approved_at" timestamp with time zone,
	"rejection_reason" text,
	"activated_by_user_id" text,
	"activated_at" timestamp with time zone,
	"suspended_by_user_id" text,
	"suspended_at" timestamp with time zone,
	"suspension_reason" text,
	"extended_until_at" timestamp with time zone,
	"extension_reason" text,
	"closed_by_user_id" text,
	"closed_at" timestamp with time zone,
	"closure_summary" text,
	"cancelled_by_user_id" text,
	"cancelled_at" timestamp with time zone,
	"cancellation_reason" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prevention_work_permits_code_unique" UNIQUE("code"),
	CONSTRAINT "prevention_work_permit_status_valid" CHECK ("prevention_work_permits"."status" IN ('draft', 'pending_approval', 'approved', 'active', 'suspended', 'closed', 'rejected', 'cancelled')),
	CONSTRAINT "prevention_work_permit_window_valid" CHECK ("prevention_work_permits"."planned_end_at" > "prevention_work_permits"."planned_start_at"),
	CONSTRAINT "prevention_work_permit_extension_valid" CHECK ("prevention_work_permits"."extended_until_at" IS NULL OR ("prevention_work_permits"."extended_until_at" > "prevention_work_permits"."planned_end_at" AND length("prevention_work_permits"."extension_reason") >= 10)),
	CONSTRAINT "prevention_work_permit_reject_consistent" CHECK ("prevention_work_permits"."status" <> 'rejected' OR length("prevention_work_permits"."rejection_reason") >= 10),
	CONSTRAINT "prevention_work_permit_suspend_consistent" CHECK (("prevention_work_permits"."suspended_at" IS NULL AND "prevention_work_permits"."suspended_by_user_id" IS NULL) OR ("prevention_work_permits"."suspended_at" IS NOT NULL AND "prevention_work_permits"."suspended_by_user_id" IS NOT NULL AND length("prevention_work_permits"."suspension_reason") >= 10)),
	CONSTRAINT "prevention_work_permit_cancel_consistent" CHECK (("prevention_work_permits"."cancelled_at" IS NULL AND "prevention_work_permits"."cancelled_by_user_id" IS NULL) OR ("prevention_work_permits"."cancelled_at" IS NOT NULL AND "prevention_work_permits"."cancelled_by_user_id" IS NOT NULL AND length("prevention_work_permits"."cancellation_reason") >= 10)),
	CONSTRAINT "prevention_work_permit_close_consistent" CHECK (("prevention_work_permits"."closed_at" IS NULL AND "prevention_work_permits"."closed_by_user_id" IS NULL) OR ("prevention_work_permits"."closed_at" IS NOT NULL AND "prevention_work_permits"."closed_by_user_id" IS NOT NULL AND length("prevention_work_permits"."closure_summary") >= 10)),
	CONSTRAINT "prevention_work_permit_version_positive" CHECK ("prevention_work_permits"."version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "prevention_capa_actions" DROP CONSTRAINT "prevention_capa_source_type_valid";--> statement-breakpoint
ALTER TABLE "ppa_submissions" ADD COLUMN "work_permit_id" text;--> statement-breakpoint
ALTER TABLE "prevention_jsa_steps" ADD CONSTRAINT "prevention_jsa_steps_permit_id_prevention_work_permits_id_fk" FOREIGN KEY ("permit_id") REFERENCES "public"."prevention_work_permits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_jsa_steps" ADD CONSTRAINT "prevention_jsa_steps_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_permit_controls" ADD CONSTRAINT "prevention_permit_controls_permit_id_prevention_work_permits_id_fk" FOREIGN KEY ("permit_id") REFERENCES "public"."prevention_work_permits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_permit_controls" ADD CONSTRAINT "prevention_permit_controls_verified_by_user_id_users_id_fk" FOREIGN KEY ("verified_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_permit_crew" ADD CONSTRAINT "prevention_permit_crew_permit_id_prevention_work_permits_id_fk" FOREIGN KEY ("permit_id") REFERENCES "public"."prevention_work_permits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_permit_crew" ADD CONSTRAINT "prevention_permit_crew_worker_id_workers_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_permit_crew" ADD CONSTRAINT "prevention_permit_crew_contractor_worker_id_prevention_contractor_workers_id_fk" FOREIGN KEY ("contractor_worker_id") REFERENCES "public"."prevention_contractor_workers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_permit_history" ADD CONSTRAINT "prevention_permit_history_permit_id_prevention_work_permits_id_fk" FOREIGN KEY ("permit_id") REFERENCES "public"."prevention_work_permits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_permit_history" ADD CONSTRAINT "prevention_permit_history_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_permit_isolations" ADD CONSTRAINT "prevention_permit_isolations_permit_id_prevention_work_permits_id_fk" FOREIGN KEY ("permit_id") REFERENCES "public"."prevention_work_permits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_permit_isolations" ADD CONSTRAINT "prevention_permit_isolations_applied_by_user_id_users_id_fk" FOREIGN KEY ("applied_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_permit_isolations" ADD CONSTRAINT "prevention_permit_isolations_removed_by_user_id_users_id_fk" FOREIGN KEY ("removed_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_permit_measurements" ADD CONSTRAINT "prevention_permit_measurements_permit_id_prevention_work_permits_id_fk" FOREIGN KEY ("permit_id") REFERENCES "public"."prevention_work_permits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_permit_measurements" ADD CONSTRAINT "prevention_permit_measurements_taken_by_user_id_users_id_fk" FOREIGN KEY ("taken_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_permit_types" ADD CONSTRAINT "prevention_permit_types_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_work_permits" ADD CONSTRAINT "prevention_work_permits_permit_type_id_prevention_permit_types_id_fk" FOREIGN KEY ("permit_type_id") REFERENCES "public"."prevention_permit_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_work_permits" ADD CONSTRAINT "prevention_work_permits_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_work_permits" ADD CONSTRAINT "prevention_work_permits_risk_entry_id_prevention_risk_entries_id_fk" FOREIGN KEY ("risk_entry_id") REFERENCES "public"."prevention_risk_entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_work_permits" ADD CONSTRAINT "prevention_work_permits_supervisor_user_id_users_id_fk" FOREIGN KEY ("supervisor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_work_permits" ADD CONSTRAINT "prevention_work_permits_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_work_permits" ADD CONSTRAINT "prevention_work_permits_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_work_permits" ADD CONSTRAINT "prevention_work_permits_activated_by_user_id_users_id_fk" FOREIGN KEY ("activated_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_work_permits" ADD CONSTRAINT "prevention_work_permits_suspended_by_user_id_users_id_fk" FOREIGN KEY ("suspended_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_work_permits" ADD CONSTRAINT "prevention_work_permits_closed_by_user_id_users_id_fk" FOREIGN KEY ("closed_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_work_permits" ADD CONSTRAINT "prevention_work_permits_cancelled_by_user_id_users_id_fk" FOREIGN KEY ("cancelled_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "prevention_jsa_step_order_unique" ON "prevention_jsa_steps" USING btree ("permit_id","step_order");--> statement-breakpoint
CREATE INDEX "prevention_permit_control_permit_idx" ON "prevention_permit_controls" USING btree ("permit_id");--> statement-breakpoint
CREATE UNIQUE INDEX "prevention_permit_crew_worker_unique" ON "prevention_permit_crew" USING btree ("permit_id","worker_id");--> statement-breakpoint
CREATE UNIQUE INDEX "prevention_permit_crew_contractor_unique" ON "prevention_permit_crew" USING btree ("permit_id","contractor_worker_id");--> statement-breakpoint
CREATE INDEX "prevention_permit_crew_permit_idx" ON "prevention_permit_crew" USING btree ("permit_id");--> statement-breakpoint
CREATE INDEX "prevention_permit_history_permit_idx" ON "prevention_permit_history" USING btree ("permit_id","created_at");--> statement-breakpoint
CREATE INDEX "prevention_permit_isolation_permit_idx" ON "prevention_permit_isolations" USING btree ("permit_id");--> statement-breakpoint
CREATE INDEX "prevention_permit_measurement_permit_idx" ON "prevention_permit_measurements" USING btree ("permit_id","taken_at");--> statement-breakpoint
CREATE INDEX "prevention_permit_type_active_idx" ON "prevention_permit_types" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "prevention_work_permit_worksite_idx" ON "prevention_work_permits" USING btree ("worksite_id","status");--> statement-breakpoint
CREATE INDEX "prevention_work_permit_window_idx" ON "prevention_work_permits" USING btree ("planned_start_at","planned_end_at");--> statement-breakpoint
CREATE INDEX "idx_ppa_work_permit" ON "ppa_submissions" USING btree ("work_permit_id");--> statement-breakpoint
ALTER TABLE "prevention_capa_actions" ADD CONSTRAINT "prevention_capa_source_type_valid" CHECK ("prevention_capa_actions"."source_type" IN ('pdtp', 'sst_evaluation', 'ppa', 'incident', 'risk', 'legal_requirement', 'training', 'contractor', 'work_permit', 'manual'));