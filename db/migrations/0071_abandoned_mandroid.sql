CREATE TABLE "prevention_incident_evidence" (
	"id" text PRIMARY KEY NOT NULL,
	"incident_id" text NOT NULL,
	"investigation_id" text,
	"kind" text NOT NULL,
	"reference" text NOT NULL,
	"description" text,
	"checksum_sha256" text,
	"is_sensitive" boolean DEFAULT false NOT NULL,
	"captured_at" timestamp with time zone,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "prevention_incident_evidence_kind_valid" CHECK ("prevention_incident_evidence"."kind" IN ('document', 'photo', 'video', 'interview', 'diagram', 'external_reference', 'note')),
	CONSTRAINT "prevention_incident_evidence_checksum_valid" CHECK ("prevention_incident_evidence"."checksum_sha256" IS NULL OR length("prevention_incident_evidence"."checksum_sha256") = 64)
);
--> statement-breakpoint
CREATE TABLE "prevention_incident_history" (
	"id" text PRIMARY KEY NOT NULL,
	"incident_id" text NOT NULL,
	"change_type" text NOT NULL,
	"from_status" text,
	"to_status" text,
	"reason" text,
	"change_set" jsonb,
	"actor_user_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "prevention_incident_history_type_valid" CHECK ("prevention_incident_history"."change_type" IN ('reported', 'status', 'triage', 'immediate_measures', 'person', 'notification', 'investigation', 'evidence', 'capa', 'restart', 'closure', 'import', 'correction'))
);
--> statement-breakpoint
CREATE TABLE "prevention_incident_import_batches" (
	"id" text PRIMARY KEY NOT NULL,
	"source_system" text DEFAULT 'SFTI' NOT NULL,
	"source_file_name" text NOT NULL,
	"source_checksum_sha256" text NOT NULL,
	"source_encrypted_path" text NOT NULL,
	"source_ciphertext_checksum_sha256" text NOT NULL,
	"source_iv" text NOT NULL,
	"source_auth_tag" text NOT NULL,
	"source_key_version" text NOT NULL,
	"status" text DEFAULT 'staging' NOT NULL,
	"total_rows" integer DEFAULT 0 NOT NULL,
	"ready_rows" integer DEFAULT 0 NOT NULL,
	"duplicate_rows" integer DEFAULT 0 NOT NULL,
	"review_rows" integer DEFAULT 0 NOT NULL,
	"error_rows" integer DEFAULT 0 NOT NULL,
	"activated_rows" integer DEFAULT 0 NOT NULL,
	"reconciliation" jsonb,
	"imported_by_user_id" text NOT NULL,
	"approved_by_user_id" text,
	"approved_at" timestamp with time zone,
	"activated_by_user_id" text,
	"activated_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "prevention_incident_import_batches_source_checksum_sha256_unique" UNIQUE("source_checksum_sha256"),
	CONSTRAINT "prevention_incident_import_status_valid" CHECK ("prevention_incident_import_batches"."status" IN ('staging', 'review', 'approved', 'activated', 'rejected')),
	CONSTRAINT "prevention_incident_import_counts_nonnegative" CHECK ("prevention_incident_import_batches"."total_rows" >= 0 AND "prevention_incident_import_batches"."ready_rows" >= 0 AND "prevention_incident_import_batches"."duplicate_rows" >= 0 AND "prevention_incident_import_batches"."review_rows" >= 0 AND "prevention_incident_import_batches"."error_rows" >= 0 AND "prevention_incident_import_batches"."activated_rows" >= 0)
);
--> statement-breakpoint
CREATE TABLE "prevention_incident_import_rows" (
	"id" text PRIMARY KEY NOT NULL,
	"batch_id" text NOT NULL,
	"row_number" integer NOT NULL,
	"row_fingerprint" text NOT NULL,
	"source_external_id" text,
	"original_encrypted" text NOT NULL,
	"original_iv" text NOT NULL,
	"original_auth_tag" text NOT NULL,
	"original_key_version" text NOT NULL,
	"normalized" jsonb NOT NULL,
	"resolution_status" text NOT NULL,
	"worksite_id" text,
	"worker_id" text,
	"issues" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"incident_id" text,
	"reviewed_by_user_id" text,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "prevention_incident_import_row_number_positive" CHECK ("prevention_incident_import_rows"."row_number" >= 1),
	CONSTRAINT "prevention_incident_import_row_resolution_valid" CHECK ("prevention_incident_import_rows"."resolution_status" IN ('ready', 'duplicate', 'needs_review', 'approved', 'activated', 'error'))
);
--> statement-breakpoint
CREATE TABLE "prevention_incident_investigations" (
	"id" text PRIMARY KEY NOT NULL,
	"incident_id" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"methodology" text NOT NULL,
	"team" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"evidence_summary" text,
	"immediate_causes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"basic_causes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"organizational_causes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"failed_controls" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"conclusions" text,
	"interviews_encrypted" text,
	"interviews_iv" text,
	"interviews_auth_tag" text,
	"interviews_key_version" text,
	"miper_update_required" boolean DEFAULT false NOT NULL,
	"miper_updated_at" timestamp with time zone,
	"procedure_update_required" boolean DEFAULT false NOT NULL,
	"procedure_updated_at" timestamp with time zone,
	"training_required" boolean DEFAULT false NOT NULL,
	"training_completed_at" timestamp with time zone,
	"started_by_user_id" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"completed_by_user_id" text,
	"completed_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "prevention_incident_investigations_incident_id_unique" UNIQUE("incident_id"),
	CONSTRAINT "prevention_incident_investigation_status_valid" CHECK ("prevention_incident_investigations"."status" IN ('draft', 'in_progress', 'completed', 'reopened')),
	CONSTRAINT "prevention_incident_investigation_version_positive" CHECK ("prevention_incident_investigations"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "prevention_incident_notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"incident_id" text NOT NULL,
	"notification_type" text NOT NULL,
	"deadline_at" timestamp with time zone,
	"status" text DEFAULT 'pending' NOT NULL,
	"administrator_name" text,
	"responsible_user_id" text,
	"sent_at" timestamp with time zone,
	"evidence_reference" text,
	"evidence_checksum_sha256" text,
	"observations" text,
	"escalated_at" timestamp with time zone,
	"restart_authorized_at" timestamp with time zone,
	"restart_authorized_by_user_id" text,
	"restart_authorization_reason" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "prevention_incident_notification_type_valid" CHECK ("prevention_incident_notifications"."notification_type" IN ('diat', 'diep', 'fatal_dt', 'fatal_seremi', 'restart_authorization')),
	CONSTRAINT "prevention_incident_notification_status_valid" CHECK ("prevention_incident_notifications"."status" IN ('pending', 'sent', 'acknowledged', 'not_required', 'overdue', 'authorized')),
	CONSTRAINT "prevention_incident_notification_checksum_valid" CHECK ("prevention_incident_notifications"."evidence_checksum_sha256" IS NULL OR length("prevention_incident_notifications"."evidence_checksum_sha256") = 64)
);
--> statement-breakpoint
CREATE TABLE "prevention_incident_people" (
	"id" text PRIMARY KEY NOT NULL,
	"incident_id" text NOT NULL,
	"worker_id" text,
	"display_label" text NOT NULL,
	"employer_name" text NOT NULL,
	"sex" text,
	"relationship_type" text NOT NULL,
	"absence_at_least_normal_shift" boolean DEFAULT false NOT NULL,
	"absence_days" integer DEFAULT 0 NOT NULL,
	"charge_days" integer DEFAULT 0 NOT NULL,
	"administrator_qualification" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "prevention_incident_person_sex_valid" CHECK ("prevention_incident_people"."sex" IS NULL OR "prevention_incident_people"."sex" IN ('female', 'male', 'intersex', 'unspecified')),
	CONSTRAINT "prevention_incident_person_relationship_valid" CHECK ("prevention_incident_people"."relationship_type" IN ('employee', 'contractor', 'subcontractor', 'visitor', 'third_party')),
	CONSTRAINT "prevention_incident_person_days_nonnegative" CHECK ("prevention_incident_people"."absence_days" >= 0 AND "prevention_incident_people"."charge_days" >= 0)
);
--> statement-breakpoint
CREATE TABLE "prevention_incident_person_sensitive_payloads" (
	"id" text PRIMARY KEY NOT NULL,
	"person_id" text NOT NULL,
	"encrypted_payload" text NOT NULL,
	"iv" text NOT NULL,
	"auth_tag" text NOT NULL,
	"key_version" text NOT NULL,
	"created_by_user_id" text NOT NULL,
	"updated_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "prevention_incident_person_sensitive_payloads_person_id_unique" UNIQUE("person_id")
);
--> statement-breakpoint
CREATE TABLE "prevention_incidents" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"client_submission_id" text NOT NULL,
	"sfti_external_id" text,
	"worksite_id" text NOT NULL,
	"company_name" text NOT NULL,
	"company_tax_id" text,
	"event_type" text NOT NULL,
	"status" text DEFAULT 'reported' NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"known_at" timestamp with time zone NOT NULL,
	"location" text NOT NULL,
	"initial_narrative" text NOT NULL,
	"reported_by_user_id" text NOT NULL,
	"process_name" text,
	"task_name" text,
	"shift_name" text,
	"vehicle_reference" text,
	"equipment_reference" text,
	"waste_reference" text,
	"substance_reference" text,
	"actual_severity" text DEFAULT 'none' NOT NULL,
	"potential_severity" text DEFAULT 'low' NOT NULL,
	"immediate_measures" text,
	"operations_suspended" boolean DEFAULT false NOT NULL,
	"evacuated" boolean DEFAULT false NOT NULL,
	"is_fatal_or_serious" boolean DEFAULT false NOT NULL,
	"source" text DEFAULT 'platform' NOT NULL,
	"import_row_id" text,
	"version" integer DEFAULT 1 NOT NULL,
	"triaged_at" timestamp with time zone,
	"triaged_by_user_id" text,
	"closed_at" timestamp with time zone,
	"closed_by_user_id" text,
	"closure_reason" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "prevention_incidents_code_unique" UNIQUE("code"),
	CONSTRAINT "prevention_incidents_client_submission_id_unique" UNIQUE("client_submission_id"),
	CONSTRAINT "prevention_incident_type_valid" CHECK ("prevention_incidents"."event_type" IN ('dangerous_incident', 'work_accident', 'commute_accident', 'suspected_occupational_disease', 'material_damage', 'environmental_spill', 'vehicle_event', 'contractor_or_third_party')),
	CONSTRAINT "prevention_incident_status_valid" CHECK ("prevention_incidents"."status" IN ('reported', 'triage', 'immediate_measures', 'under_investigation', 'pending_capa', 'pending_verification', 'closed')),
	CONSTRAINT "prevention_incident_actual_severity_valid" CHECK ("prevention_incidents"."actual_severity" IN ('none', 'minor', 'medical_treatment', 'lost_time', 'serious', 'fatal')),
	CONSTRAINT "prevention_incident_potential_severity_valid" CHECK ("prevention_incidents"."potential_severity" IN ('low', 'medium', 'high', 'critical', 'fatal')),
	CONSTRAINT "prevention_incident_source_valid" CHECK ("prevention_incidents"."source" IN ('platform', 'offline_sync', 'sfti_import')),
	CONSTRAINT "prevention_incident_version_positive" CHECK ("prevention_incidents"."version" >= 1),
	CONSTRAINT "prevention_incident_times_consistent" CHECK ("prevention_incidents"."known_at" >= "prevention_incidents"."occurred_at"),
	CONSTRAINT "prevention_incident_fatal_serious_suspended" CHECK (NOT "prevention_incidents"."is_fatal_or_serious" OR "prevention_incidents"."operations_suspended")
);
--> statement-breakpoint
ALTER TABLE "prevention_incident_evidence" ADD CONSTRAINT "prevention_incident_evidence_incident_id_prevention_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."prevention_incidents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_incident_evidence" ADD CONSTRAINT "prevention_incident_evidence_investigation_id_prevention_incident_investigations_id_fk" FOREIGN KEY ("investigation_id") REFERENCES "public"."prevention_incident_investigations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_incident_evidence" ADD CONSTRAINT "prevention_incident_evidence_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_incident_history" ADD CONSTRAINT "prevention_incident_history_incident_id_prevention_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."prevention_incidents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_incident_history" ADD CONSTRAINT "prevention_incident_history_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_incident_import_batches" ADD CONSTRAINT "prevention_incident_import_batches_imported_by_user_id_users_id_fk" FOREIGN KEY ("imported_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_incident_import_batches" ADD CONSTRAINT "prevention_incident_import_batches_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_incident_import_batches" ADD CONSTRAINT "prevention_incident_import_batches_activated_by_user_id_users_id_fk" FOREIGN KEY ("activated_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_incident_import_rows" ADD CONSTRAINT "prevention_incident_import_rows_batch_id_prevention_incident_import_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."prevention_incident_import_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_incident_import_rows" ADD CONSTRAINT "prevention_incident_import_rows_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_incident_import_rows" ADD CONSTRAINT "prevention_incident_import_rows_worker_id_workers_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_incident_import_rows" ADD CONSTRAINT "prevention_incident_import_rows_incident_id_prevention_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."prevention_incidents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_incident_import_rows" ADD CONSTRAINT "prevention_incident_import_rows_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_incident_investigations" ADD CONSTRAINT "prevention_incident_investigations_incident_id_prevention_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."prevention_incidents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_incident_investigations" ADD CONSTRAINT "prevention_incident_investigations_started_by_user_id_users_id_fk" FOREIGN KEY ("started_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_incident_investigations" ADD CONSTRAINT "prevention_incident_investigations_completed_by_user_id_users_id_fk" FOREIGN KEY ("completed_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_incident_notifications" ADD CONSTRAINT "prevention_incident_notifications_incident_id_prevention_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."prevention_incidents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_incident_notifications" ADD CONSTRAINT "prevention_incident_notifications_responsible_user_id_users_id_fk" FOREIGN KEY ("responsible_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_incident_notifications" ADD CONSTRAINT "prevention_incident_notifications_restart_authorized_by_user_id_users_id_fk" FOREIGN KEY ("restart_authorized_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_incident_people" ADD CONSTRAINT "prevention_incident_people_incident_id_prevention_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."prevention_incidents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_incident_people" ADD CONSTRAINT "prevention_incident_people_worker_id_workers_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_incident_person_sensitive_payloads" ADD CONSTRAINT "prevention_incident_person_sensitive_payloads_person_id_prevention_incident_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."prevention_incident_people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_incident_person_sensitive_payloads" ADD CONSTRAINT "prevention_incident_person_sensitive_payloads_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_incident_person_sensitive_payloads" ADD CONSTRAINT "prevention_incident_person_sensitive_payloads_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_incidents" ADD CONSTRAINT "prevention_incidents_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_incidents" ADD CONSTRAINT "prevention_incidents_reported_by_user_id_users_id_fk" FOREIGN KEY ("reported_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_incidents" ADD CONSTRAINT "prevention_incidents_triaged_by_user_id_users_id_fk" FOREIGN KEY ("triaged_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_incidents" ADD CONSTRAINT "prevention_incidents_closed_by_user_id_users_id_fk" FOREIGN KEY ("closed_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "prevention_incident_evidence_incident_idx" ON "prevention_incident_evidence" USING btree ("incident_id","created_at");--> statement-breakpoint
CREATE INDEX "prevention_incident_history_incident_idx" ON "prevention_incident_history" USING btree ("incident_id","created_at");--> statement-breakpoint
CREATE INDEX "prevention_incident_import_status_idx" ON "prevention_incident_import_batches" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "prevention_incident_import_row_number_unique" ON "prevention_incident_import_rows" USING btree ("batch_id","row_number");--> statement-breakpoint
CREATE INDEX "prevention_incident_import_row_status_idx" ON "prevention_incident_import_rows" USING btree ("batch_id","resolution_status");--> statement-breakpoint
CREATE INDEX "prevention_incident_import_row_external_idx" ON "prevention_incident_import_rows" USING btree ("source_external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "prevention_incident_notification_type_unique" ON "prevention_incident_notifications" USING btree ("incident_id","notification_type");--> statement-breakpoint
CREATE INDEX "prevention_incident_notification_deadline_idx" ON "prevention_incident_notifications" USING btree ("deadline_at","status");--> statement-breakpoint
CREATE INDEX "prevention_incident_notification_responsible_idx" ON "prevention_incident_notifications" USING btree ("responsible_user_id","status");--> statement-breakpoint
CREATE INDEX "prevention_incident_people_incident_idx" ON "prevention_incident_people" USING btree ("incident_id");--> statement-breakpoint
CREATE INDEX "prevention_incident_people_worker_idx" ON "prevention_incident_people" USING btree ("worker_id");--> statement-breakpoint
CREATE UNIQUE INDEX "prevention_incidents_sfti_external_unique" ON "prevention_incidents" USING btree ("sfti_external_id") WHERE "prevention_incidents"."sfti_external_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "prevention_incidents_import_row_unique" ON "prevention_incidents" USING btree ("import_row_id") WHERE "prevention_incidents"."import_row_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "prevention_incidents_worksite_status_idx" ON "prevention_incidents" USING btree ("worksite_id","status");--> statement-breakpoint
CREATE INDEX "prevention_incidents_occurred_idx" ON "prevention_incidents" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "prevention_incidents_known_idx" ON "prevention_incidents" USING btree ("known_at");