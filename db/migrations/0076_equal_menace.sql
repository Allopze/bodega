CREATE TABLE "prevention_legal_applicabilities" (
	"id" text PRIMARY KEY NOT NULL,
	"requirement_id" text NOT NULL,
	"worksite_id" text NOT NULL,
	"process_id" text,
	"activity_reference" text,
	"applicability_status" text DEFAULT 'pending' NOT NULL,
	"rationale" text NOT NULL,
	"responsible_user_id" text,
	"responsible_snapshot" text NOT NULL,
	"evidence_reference" text,
	"evidence_due_at" text,
	"compliance_status" text DEFAULT 'not_assessed' NOT NULL,
	"assessed_by_user_id" text,
	"assessed_at" timestamp with time zone,
	"approved_by_user_id" text,
	"approved_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prevention_legal_applicabilities_status_valid" CHECK ("prevention_legal_applicabilities"."applicability_status" IN ('pending', 'applicable', 'not_applicable')),
	CONSTRAINT "prevention_legal_applicabilities_compliance_valid" CHECK ("prevention_legal_applicabilities"."compliance_status" IN ('not_assessed', 'compliant', 'partial', 'noncompliant', 'not_applicable')),
	CONSTRAINT "prevention_legal_applicabilities_non_applicable_evidence" CHECK ("prevention_legal_applicabilities"."applicability_status" <> 'not_applicable' OR (length("prevention_legal_applicabilities"."rationale") >= 10 AND "prevention_legal_applicabilities"."approved_by_user_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "prevention_legal_assessments" (
	"id" text PRIMARY KEY NOT NULL,
	"applicability_id" text NOT NULL,
	"status" text NOT NULL,
	"finding" text,
	"evidence_reference" text,
	"capa_action_id" text,
	"assessed_by_user_id" text NOT NULL,
	"assessed_at" timestamp with time zone NOT NULL,
	"next_assessment_at" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prevention_legal_assessments_status_valid" CHECK ("prevention_legal_assessments"."status" IN ('compliant', 'partial', 'noncompliant', 'not_applicable')),
	CONSTRAINT "prevention_legal_assessments_gap_capa" CHECK ("prevention_legal_assessments"."status" NOT IN ('partial', 'noncompliant') OR ("prevention_legal_assessments"."capa_action_id" IS NOT NULL AND length(coalesce("prevention_legal_assessments"."finding", '')) >= 5))
);
--> statement-breakpoint
CREATE TABLE "prevention_legal_requirements" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"requirement_version" integer NOT NULL,
	"source_type" text NOT NULL,
	"authority" text NOT NULL,
	"source_title" text NOT NULL,
	"source_reference" text NOT NULL,
	"source_url" text,
	"article" text NOT NULL,
	"requirement" text NOT NULL,
	"version_label" text NOT NULL,
	"valid_from" text NOT NULL,
	"valid_to" text,
	"topic" text NOT NULL,
	"chome_role" text NOT NULL,
	"evidence_required" text NOT NULL,
	"frequency" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"supersedes_requirement_id" text,
	"published_hash_sha256" text,
	"created_by_user_id" text NOT NULL,
	"reviewed_by_user_id" text,
	"reviewed_at" timestamp with time zone,
	"approved_by_user_id" text,
	"approved_at" timestamp with time zone,
	"published_by_user_id" text,
	"published_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prevention_legal_requirements_source_type_valid" CHECK ("prevention_legal_requirements"."source_type" IN ('legal', 'regulatory', 'contractual', 'standard', 'internal')),
	CONSTRAINT "prevention_legal_requirements_status_valid" CHECK ("prevention_legal_requirements"."status" IN ('draft', 'in_review', 'reviewed', 'approved', 'published', 'superseded')),
	CONSTRAINT "prevention_legal_requirements_publish_evidence" CHECK ("prevention_legal_requirements"."status" NOT IN ('approved', 'published', 'superseded') OR ("prevention_legal_requirements"."reviewed_by_user_id" IS NOT NULL AND "prevention_legal_requirements"."approved_by_user_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "prevention_pdtp_source_links" (
	"id" text PRIMARY KEY NOT NULL,
	"activity_id" text NOT NULL,
	"worksite_id" text NOT NULL,
	"source_type" text NOT NULL,
	"source_id" text NOT NULL,
	"source_version_snapshot" text NOT NULL,
	"justification" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_user_id" text NOT NULL,
	"retired_by_user_id" text,
	"retired_at" timestamp with time zone,
	"retirement_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prevention_pdtp_source_links_type_valid" CHECK ("prevention_pdtp_source_links"."source_type" IN ('risk_control', 'legal_requirement', 'incident_capa', 'audit', 'internal_objective', 'contractual_obligation')),
	CONSTRAINT "prevention_pdtp_source_links_internal_reason" CHECK ("prevention_pdtp_source_links"."source_type" <> 'internal_objective' OR length("prevention_pdtp_source_links"."justification") >= 10)
);
--> statement-breakpoint
CREATE TABLE "prevention_pdtp_update_obligations" (
	"id" text PRIMARY KEY NOT NULL,
	"idempotency_key" text NOT NULL,
	"worksite_id" text NOT NULL,
	"source_type" text NOT NULL,
	"source_id" text NOT NULL,
	"source_version_snapshot" text NOT NULL,
	"due_at" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"addressed_by_program_id" text,
	"addressed_by_user_id" text,
	"addressed_at" timestamp with time zone,
	"resolution" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prevention_pdtp_update_obligations_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "prevention_pdtp_update_obligations_source_valid" CHECK ("prevention_pdtp_update_obligations"."source_type" IN ('risk_matrix', 'legal_requirement')),
	CONSTRAINT "prevention_pdtp_update_obligations_status_valid" CHECK ("prevention_pdtp_update_obligations"."status" IN ('pending', 'addressed', 'overdue', 'waived'))
);
--> statement-breakpoint
CREATE TABLE "prevention_risk_controls" (
	"id" text PRIMARY KEY NOT NULL,
	"risk_entry_id" text NOT NULL,
	"description" text NOT NULL,
	"hierarchy" text NOT NULL,
	"is_existing" boolean DEFAULT false NOT NULL,
	"is_critical" boolean DEFAULT false NOT NULL,
	"performance_standard" text,
	"verification_frequency" text,
	"responsible_user_id" text,
	"responsible_snapshot" text NOT NULL,
	"due_date" text,
	"status" text DEFAULT 'proposed' NOT NULL,
	"evidence_reference" text,
	"last_verified_by_user_id" text,
	"last_verified_at" timestamp with time zone,
	"effectiveness_status" text DEFAULT 'not_assessed' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prevention_risk_controls_hierarchy_valid" CHECK ("prevention_risk_controls"."hierarchy" IN ('elimination', 'substitution', 'engineering', 'administrative', 'ppe')),
	CONSTRAINT "prevention_risk_controls_status_valid" CHECK ("prevention_risk_controls"."status" IN ('proposed', 'implemented', 'verified', 'ineffective', 'retired')),
	CONSTRAINT "prevention_risk_controls_effectiveness_valid" CHECK ("prevention_risk_controls"."effectiveness_status" IN ('not_assessed', 'effective', 'ineffective')),
	CONSTRAINT "prevention_risk_controls_critical_standard" CHECK ("prevention_risk_controls"."is_critical" = false OR (length(coalesce("prevention_risk_controls"."performance_standard", '')) >= 5 AND length(coalesce("prevention_risk_controls"."verification_frequency", '')) >= 2))
);
--> statement-breakpoint
CREATE TABLE "prevention_risk_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"matrix_id" text NOT NULL,
	"process_id" text NOT NULL,
	"task_id" text NOT NULL,
	"position_id" text NOT NULL,
	"hazard_code" text NOT NULL,
	"hazard" text NOT NULL,
	"risk_factor" text NOT NULL,
	"expected_event_or_damage" text NOT NULL,
	"exposed_people_description" text NOT NULL,
	"exposed_people_count" integer,
	"gender_considerations" text NOT NULL,
	"sensitive_worker_considerations" text NOT NULL,
	"special_methodology_reference" text,
	"inherent_dimensions" jsonb NOT NULL,
	"inherent_score" numeric(12, 4),
	"inherent_level" text NOT NULL,
	"residual_dimensions" jsonb NOT NULL,
	"residual_score" numeric(12, 4),
	"residual_level" text NOT NULL,
	"is_critical" boolean DEFAULT false NOT NULL,
	"responsible_user_id" text,
	"responsible_snapshot" text NOT NULL,
	"evidence_reference" text,
	"source_row_number" integer,
	"source_original" jsonb,
	"source_normalized" jsonb,
	"normalization_decision" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prevention_risk_entries_exposed_count_valid" CHECK ("prevention_risk_entries"."exposed_people_count" IS NULL OR "prevention_risk_entries"."exposed_people_count" >= 0),
	CONSTRAINT "prevention_risk_entries_version_positive" CHECK ("prevention_risk_entries"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "prevention_risk_import_batches" (
	"id" text PRIMARY KEY NOT NULL,
	"worksite_id" text NOT NULL,
	"source_file_name" text NOT NULL,
	"source_file_path" text NOT NULL,
	"source_checksum_sha256" text NOT NULL,
	"source_size_bytes" integer NOT NULL,
	"source_sheet_name" text NOT NULL,
	"status" text DEFAULT 'staged' NOT NULL,
	"total_rows" integer DEFAULT 0 NOT NULL,
	"ready_rows" integer DEFAULT 0 NOT NULL,
	"review_rows" integer DEFAULT 0 NOT NULL,
	"activated_matrix_id" text,
	"created_by_user_id" text NOT NULL,
	"approved_by_user_id" text,
	"approved_at" timestamp with time zone,
	"activated_by_user_id" text,
	"activated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prevention_risk_import_batches_status_valid" CHECK ("prevention_risk_import_batches"."status" IN ('staged', 'reviewed', 'approved', 'activated', 'rejected')),
	CONSTRAINT "prevention_risk_import_batches_size_positive" CHECK ("prevention_risk_import_batches"."source_size_bytes" > 0)
);
--> statement-breakpoint
CREATE TABLE "prevention_risk_import_rows" (
	"id" text PRIMARY KEY NOT NULL,
	"batch_id" text NOT NULL,
	"row_number" integer NOT NULL,
	"original" jsonb NOT NULL,
	"normalized" jsonb NOT NULL,
	"fingerprint_sha256" text NOT NULL,
	"status" text NOT NULL,
	"issues" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"resolution" text,
	"resolved_by_user_id" text,
	"resolved_at" timestamp with time zone,
	"risk_entry_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prevention_risk_import_rows_status_valid" CHECK ("prevention_risk_import_rows"."status" IN ('ready', 'needs_review', 'duplicate', 'rejected', 'activated'))
);
--> statement-breakpoint
CREATE TABLE "prevention_risk_legal_history" (
	"id" text PRIMARY KEY NOT NULL,
	"domain" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"worksite_id" text,
	"change_type" text NOT NULL,
	"reason" text NOT NULL,
	"before_state" jsonb,
	"after_state" jsonb,
	"actor_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prevention_risk_legal_history_domain_valid" CHECK ("prevention_risk_legal_history"."domain" IN ('risk', 'legal', 'pdtp_coverage', 'import'))
);
--> statement-breakpoint
CREATE TABLE "prevention_risk_matrices" (
	"id" text PRIMARY KEY NOT NULL,
	"worksite_id" text NOT NULL,
	"matrix_version" integer NOT NULL,
	"title" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"methodology_id" text NOT NULL,
	"methodology_snapshot" jsonb NOT NULL,
	"revision_reason" text NOT NULL,
	"participation_summary" text NOT NULL,
	"consultation_evidence_reference" text NOT NULL,
	"effective_from" text,
	"review_due_at" text,
	"source_import_batch_id" text,
	"supersedes_matrix_id" text,
	"published_hash_sha256" text,
	"created_by_user_id" text NOT NULL,
	"reviewed_by_user_id" text,
	"reviewed_at" timestamp with time zone,
	"approved_by_user_id" text,
	"approved_at" timestamp with time zone,
	"published_by_user_id" text,
	"published_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prevention_risk_matrices_status_valid" CHECK ("prevention_risk_matrices"."status" IN ('draft', 'in_review', 'reviewed', 'approved', 'published', 'superseded')),
	CONSTRAINT "prevention_risk_matrices_version_positive" CHECK ("prevention_risk_matrices"."matrix_version" > 0 AND "prevention_risk_matrices"."version" > 0),
	CONSTRAINT "prevention_risk_matrices_publish_evidence" CHECK ("prevention_risk_matrices"."status" NOT IN ('approved', 'published', 'superseded') OR ("prevention_risk_matrices"."reviewed_by_user_id" IS NOT NULL AND "prevention_risk_matrices"."approved_by_user_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "prevention_risk_methodologies" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"version_label" text NOT NULL,
	"kind" text NOT NULL,
	"authority_source" text NOT NULL,
	"configuration" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prevention_risk_methodologies_kind_valid" CHECK ("prevention_risk_methodologies"."kind" IN ('primary', 'special'))
);
--> statement-breakpoint
CREATE TABLE "prevention_risk_positions" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"worker_position_key" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prevention_risk_processes" (
	"id" text PRIMARY KEY NOT NULL,
	"worksite_id" text NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prevention_risk_review_triggers" (
	"id" text PRIMARY KEY NOT NULL,
	"idempotency_key" text NOT NULL,
	"worksite_id" text NOT NULL,
	"matrix_id" text,
	"trigger_type" text NOT NULL,
	"source_type" text NOT NULL,
	"source_id" text NOT NULL,
	"description" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"assigned_to_user_id" text,
	"due_at" text NOT NULL,
	"created_by_user_id" text,
	"resolved_by_user_id" text,
	"resolved_at" timestamp with time zone,
	"resolution" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prevention_risk_review_triggers_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "prevention_risk_review_triggers_type_valid" CHECK ("prevention_risk_review_triggers"."trigger_type" IN ('annual', 'work_change', 'work_accident', 'occupational_disease', 'grave_imminent', 'new_material_process', 'audit_finding', 'critical_control_failure', 'legal_change', 'manual')),
	CONSTRAINT "prevention_risk_review_triggers_status_valid" CHECK ("prevention_risk_review_triggers"."status" IN ('pending', 'in_progress', 'completed', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "prevention_risk_tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"process_id" text NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"is_routine" boolean DEFAULT true NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "prevention_legal_applicabilities" ADD CONSTRAINT "prevention_legal_applicabilities_requirement_id_prevention_legal_requirements_id_fk" FOREIGN KEY ("requirement_id") REFERENCES "public"."prevention_legal_requirements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_legal_applicabilities" ADD CONSTRAINT "prevention_legal_applicabilities_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_legal_applicabilities" ADD CONSTRAINT "prevention_legal_applicabilities_process_id_prevention_risk_processes_id_fk" FOREIGN KEY ("process_id") REFERENCES "public"."prevention_risk_processes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_legal_applicabilities" ADD CONSTRAINT "prevention_legal_applicabilities_responsible_user_id_users_id_fk" FOREIGN KEY ("responsible_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_legal_applicabilities" ADD CONSTRAINT "prevention_legal_applicabilities_assessed_by_user_id_users_id_fk" FOREIGN KEY ("assessed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_legal_applicabilities" ADD CONSTRAINT "prevention_legal_applicabilities_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_legal_assessments" ADD CONSTRAINT "prevention_legal_assessments_applicability_id_prevention_legal_applicabilities_id_fk" FOREIGN KEY ("applicability_id") REFERENCES "public"."prevention_legal_applicabilities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_legal_assessments" ADD CONSTRAINT "prevention_legal_assessments_capa_action_id_prevention_capa_actions_id_fk" FOREIGN KEY ("capa_action_id") REFERENCES "public"."prevention_capa_actions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_legal_assessments" ADD CONSTRAINT "prevention_legal_assessments_assessed_by_user_id_users_id_fk" FOREIGN KEY ("assessed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_legal_requirements" ADD CONSTRAINT "prevention_legal_requirements_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_legal_requirements" ADD CONSTRAINT "prevention_legal_requirements_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_legal_requirements" ADD CONSTRAINT "prevention_legal_requirements_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_legal_requirements" ADD CONSTRAINT "prevention_legal_requirements_published_by_user_id_users_id_fk" FOREIGN KEY ("published_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_pdtp_source_links" ADD CONSTRAINT "prevention_pdtp_source_links_activity_id_pdtp_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."pdtp_activities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_pdtp_source_links" ADD CONSTRAINT "prevention_pdtp_source_links_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_pdtp_source_links" ADD CONSTRAINT "prevention_pdtp_source_links_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_pdtp_source_links" ADD CONSTRAINT "prevention_pdtp_source_links_retired_by_user_id_users_id_fk" FOREIGN KEY ("retired_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_pdtp_update_obligations" ADD CONSTRAINT "prevention_pdtp_update_obligations_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_pdtp_update_obligations" ADD CONSTRAINT "prevention_pdtp_update_obligations_addressed_by_program_id_pdtp_programs_id_fk" FOREIGN KEY ("addressed_by_program_id") REFERENCES "public"."pdtp_programs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_pdtp_update_obligations" ADD CONSTRAINT "prevention_pdtp_update_obligations_addressed_by_user_id_users_id_fk" FOREIGN KEY ("addressed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_risk_controls" ADD CONSTRAINT "prevention_risk_controls_risk_entry_id_prevention_risk_entries_id_fk" FOREIGN KEY ("risk_entry_id") REFERENCES "public"."prevention_risk_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_risk_controls" ADD CONSTRAINT "prevention_risk_controls_responsible_user_id_users_id_fk" FOREIGN KEY ("responsible_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_risk_controls" ADD CONSTRAINT "prevention_risk_controls_last_verified_by_user_id_users_id_fk" FOREIGN KEY ("last_verified_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_risk_entries" ADD CONSTRAINT "prevention_risk_entries_matrix_id_prevention_risk_matrices_id_fk" FOREIGN KEY ("matrix_id") REFERENCES "public"."prevention_risk_matrices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_risk_entries" ADD CONSTRAINT "prevention_risk_entries_process_id_prevention_risk_processes_id_fk" FOREIGN KEY ("process_id") REFERENCES "public"."prevention_risk_processes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_risk_entries" ADD CONSTRAINT "prevention_risk_entries_task_id_prevention_risk_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."prevention_risk_tasks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_risk_entries" ADD CONSTRAINT "prevention_risk_entries_position_id_prevention_risk_positions_id_fk" FOREIGN KEY ("position_id") REFERENCES "public"."prevention_risk_positions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_risk_entries" ADD CONSTRAINT "prevention_risk_entries_responsible_user_id_users_id_fk" FOREIGN KEY ("responsible_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_risk_import_batches" ADD CONSTRAINT "prevention_risk_import_batches_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_risk_import_batches" ADD CONSTRAINT "prevention_risk_import_batches_activated_matrix_id_prevention_risk_matrices_id_fk" FOREIGN KEY ("activated_matrix_id") REFERENCES "public"."prevention_risk_matrices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_risk_import_batches" ADD CONSTRAINT "prevention_risk_import_batches_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_risk_import_batches" ADD CONSTRAINT "prevention_risk_import_batches_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_risk_import_batches" ADD CONSTRAINT "prevention_risk_import_batches_activated_by_user_id_users_id_fk" FOREIGN KEY ("activated_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_risk_import_rows" ADD CONSTRAINT "prevention_risk_import_rows_batch_id_prevention_risk_import_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."prevention_risk_import_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_risk_import_rows" ADD CONSTRAINT "prevention_risk_import_rows_resolved_by_user_id_users_id_fk" FOREIGN KEY ("resolved_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_risk_import_rows" ADD CONSTRAINT "prevention_risk_import_rows_risk_entry_id_prevention_risk_entries_id_fk" FOREIGN KEY ("risk_entry_id") REFERENCES "public"."prevention_risk_entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_risk_legal_history" ADD CONSTRAINT "prevention_risk_legal_history_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_risk_legal_history" ADD CONSTRAINT "prevention_risk_legal_history_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_risk_matrices" ADD CONSTRAINT "prevention_risk_matrices_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_risk_matrices" ADD CONSTRAINT "prevention_risk_matrices_methodology_id_prevention_risk_methodologies_id_fk" FOREIGN KEY ("methodology_id") REFERENCES "public"."prevention_risk_methodologies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_risk_matrices" ADD CONSTRAINT "prevention_risk_matrices_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_risk_matrices" ADD CONSTRAINT "prevention_risk_matrices_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_risk_matrices" ADD CONSTRAINT "prevention_risk_matrices_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_risk_matrices" ADD CONSTRAINT "prevention_risk_matrices_published_by_user_id_users_id_fk" FOREIGN KEY ("published_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_risk_methodologies" ADD CONSTRAINT "prevention_risk_methodologies_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_risk_positions" ADD CONSTRAINT "prevention_risk_positions_task_id_prevention_risk_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."prevention_risk_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_risk_processes" ADD CONSTRAINT "prevention_risk_processes_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_risk_review_triggers" ADD CONSTRAINT "prevention_risk_review_triggers_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_risk_review_triggers" ADD CONSTRAINT "prevention_risk_review_triggers_matrix_id_prevention_risk_matrices_id_fk" FOREIGN KEY ("matrix_id") REFERENCES "public"."prevention_risk_matrices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_risk_review_triggers" ADD CONSTRAINT "prevention_risk_review_triggers_assigned_to_user_id_users_id_fk" FOREIGN KEY ("assigned_to_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_risk_review_triggers" ADD CONSTRAINT "prevention_risk_review_triggers_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_risk_review_triggers" ADD CONSTRAINT "prevention_risk_review_triggers_resolved_by_user_id_users_id_fk" FOREIGN KEY ("resolved_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_risk_tasks" ADD CONSTRAINT "prevention_risk_tasks_process_id_prevention_risk_processes_id_fk" FOREIGN KEY ("process_id") REFERENCES "public"."prevention_risk_processes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "prevention_legal_applicabilities_requirement_scope_unique" ON "prevention_legal_applicabilities" USING btree ("requirement_id","worksite_id","process_id");--> statement-breakpoint
CREATE INDEX "prevention_legal_applicabilities_scope_status_idx" ON "prevention_legal_applicabilities" USING btree ("worksite_id","applicability_status","compliance_status");--> statement-breakpoint
CREATE INDEX "prevention_legal_assessments_applicability_date_idx" ON "prevention_legal_assessments" USING btree ("applicability_id","assessed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "prevention_legal_requirements_code_version_unique" ON "prevention_legal_requirements" USING btree ("code","requirement_version");--> statement-breakpoint
CREATE INDEX "prevention_legal_requirements_status_topic_idx" ON "prevention_legal_requirements" USING btree ("status","topic");--> statement-breakpoint
CREATE UNIQUE INDEX "prevention_pdtp_source_links_active_unique" ON "prevention_pdtp_source_links" USING btree ("activity_id","worksite_id","source_type","source_id") WHERE "prevention_pdtp_source_links"."is_active" = true;--> statement-breakpoint
CREATE INDEX "prevention_pdtp_source_links_source_idx" ON "prevention_pdtp_source_links" USING btree ("source_type","source_id");--> statement-breakpoint
CREATE INDEX "prevention_pdtp_update_obligations_scope_status_due_idx" ON "prevention_pdtp_update_obligations" USING btree ("worksite_id","status","due_at");--> statement-breakpoint
CREATE INDEX "prevention_risk_controls_entry_idx" ON "prevention_risk_controls" USING btree ("risk_entry_id");--> statement-breakpoint
CREATE UNIQUE INDEX "prevention_risk_entries_matrix_identity_unique" ON "prevention_risk_entries" USING btree ("matrix_id","process_id","task_id","position_id","hazard_code");--> statement-breakpoint
CREATE INDEX "prevention_risk_entries_matrix_level_idx" ON "prevention_risk_entries" USING btree ("matrix_id","residual_level");--> statement-breakpoint
CREATE UNIQUE INDEX "prevention_risk_import_batches_scope_checksum_unique" ON "prevention_risk_import_batches" USING btree ("worksite_id","source_checksum_sha256");--> statement-breakpoint
CREATE UNIQUE INDEX "prevention_risk_import_rows_batch_row_unique" ON "prevention_risk_import_rows" USING btree ("batch_id","row_number");--> statement-breakpoint
CREATE INDEX "prevention_risk_legal_history_entity_idx" ON "prevention_risk_legal_history" USING btree ("domain","entity_type","entity_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "prevention_risk_matrices_scope_version_unique" ON "prevention_risk_matrices" USING btree ("worksite_id","matrix_version");--> statement-breakpoint
CREATE INDEX "prevention_risk_matrices_scope_status_idx" ON "prevention_risk_matrices" USING btree ("worksite_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "prevention_risk_matrices_one_published_scope_unique" ON "prevention_risk_matrices" USING btree ("worksite_id") WHERE "prevention_risk_matrices"."status" = 'published';--> statement-breakpoint
CREATE UNIQUE INDEX "prevention_risk_methodologies_code_version_unique" ON "prevention_risk_methodologies" USING btree ("code","version_label");--> statement-breakpoint
CREATE UNIQUE INDEX "prevention_risk_positions_task_code_unique" ON "prevention_risk_positions" USING btree ("task_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "prevention_risk_processes_scope_code_unique" ON "prevention_risk_processes" USING btree ("worksite_id","code");--> statement-breakpoint
CREATE INDEX "prevention_risk_processes_scope_active_idx" ON "prevention_risk_processes" USING btree ("worksite_id","is_active");--> statement-breakpoint
CREATE INDEX "prevention_risk_review_triggers_scope_status_due_idx" ON "prevention_risk_review_triggers" USING btree ("worksite_id","status","due_at");--> statement-breakpoint
CREATE UNIQUE INDEX "prevention_risk_tasks_process_code_unique" ON "prevention_risk_tasks" USING btree ("process_id","code");