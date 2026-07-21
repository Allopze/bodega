CREATE TABLE "prevention_competency_requirements" (
	"id" text PRIMARY KEY NOT NULL,
	"course_id" text NOT NULL,
	"scope_type" text NOT NULL,
	"scope_value" text,
	"worksite_id" text,
	"enforcement" text DEFAULT 'warning' NOT NULL,
	"reason" text NOT NULL,
	"legal_requirement_id" text,
	"risk_entry_id" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prevention_competency_requirement_scope_valid" CHECK ("prevention_competency_requirements"."scope_type" IN ('global', 'worksite', 'position', 'task')),
	CONSTRAINT "prevention_competency_requirement_enforcement_valid" CHECK ("prevention_competency_requirements"."enforcement" IN ('blocking', 'warning')),
	CONSTRAINT "prevention_competency_requirement_reason_valid" CHECK (length("prevention_competency_requirements"."reason") >= 10),
	CONSTRAINT "prevention_competency_requirement_scope_value_present" CHECK ("prevention_competency_requirements"."scope_type" IN ('global', 'worksite') OR length("prevention_competency_requirements"."scope_value") >= 1)
);
--> statement-breakpoint
CREATE TABLE "prevention_training_attendance" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"worker_id" text NOT NULL,
	"status" text DEFAULT 'convened' NOT NULL,
	"attendance_minutes" integer,
	"assessment_score" integer,
	"assessment_attempts" integer DEFAULT 0 NOT NULL,
	"assessment_result" text DEFAULT 'pending' NOT NULL,
	"excuse_reason" text,
	"evidence_reference" text,
	"acknowledgement_sha256" text,
	"acknowledged_at" timestamp with time zone,
	"acknowledgement_method" text,
	"acknowledgement_ip" text,
	"acknowledgement_user_agent" text,
	"recorded_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prevention_training_attendance_status_valid" CHECK ("prevention_training_attendance"."status" IN ('convened', 'attended', 'absent', 'excused')),
	CONSTRAINT "prevention_training_attendance_result_valid" CHECK ("prevention_training_attendance"."assessment_result" IN ('pending', 'approved', 'failed', 'not_required')),
	CONSTRAINT "prevention_training_attendance_score_valid" CHECK ("prevention_training_attendance"."assessment_score" IS NULL OR "prevention_training_attendance"."assessment_score" BETWEEN 0 AND 100),
	CONSTRAINT "prevention_training_attendance_attempts_valid" CHECK ("prevention_training_attendance"."assessment_attempts" >= 0),
	CONSTRAINT "prevention_training_attendance_minutes_valid" CHECK ("prevention_training_attendance"."attendance_minutes" IS NULL OR "prevention_training_attendance"."attendance_minutes" >= 0),
	CONSTRAINT "prevention_training_attendance_excuse_consistent" CHECK ("prevention_training_attendance"."status" <> 'excused' OR length("prevention_training_attendance"."excuse_reason") >= 5),
	CONSTRAINT "prevention_training_attendance_ack_consistent" CHECK (("prevention_training_attendance"."acknowledged_at" IS NULL AND "prevention_training_attendance"."acknowledgement_sha256" IS NULL) OR ("prevention_training_attendance"."acknowledged_at" IS NOT NULL AND length("prevention_training_attendance"."acknowledgement_sha256") = 64 AND "prevention_training_attendance"."acknowledgement_method" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "prevention_training_course_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"course_id" text NOT NULL,
	"version_label" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"content_outline" jsonb NOT NULL,
	"duration_minutes" integer NOT NULL,
	"modality" text NOT NULL,
	"assessment_type" text DEFAULT 'theoretical' NOT NULL,
	"passing_score" integer DEFAULT 70 NOT NULL,
	"content_hash" text NOT NULL,
	"effective_from" text,
	"author_user_id" text NOT NULL,
	"reviewed_by_user_id" text,
	"reviewed_at" timestamp with time zone,
	"approved_by_user_id" text,
	"approved_at" timestamp with time zone,
	"published_by_user_id" text,
	"published_at" timestamp with time zone,
	"superseded_at" timestamp with time zone,
	"superseded_by_version_id" text,
	"observation_comment" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prevention_training_version_status_valid" CHECK ("prevention_training_course_versions"."status" IN ('draft', 'in_review', 'observed', 'approved', 'published', 'superseded')),
	CONSTRAINT "prevention_training_version_modality_valid" CHECK ("prevention_training_course_versions"."modality" IN ('presencial', 'elearning', 'mixta', 'practica')),
	CONSTRAINT "prevention_training_version_assessment_valid" CHECK ("prevention_training_course_versions"."assessment_type" IN ('none', 'theoretical', 'practical', 'both')),
	CONSTRAINT "prevention_training_version_duration_positive" CHECK ("prevention_training_course_versions"."duration_minutes" > 0),
	CONSTRAINT "prevention_training_version_score_valid" CHECK ("prevention_training_course_versions"."passing_score" BETWEEN 0 AND 100),
	CONSTRAINT "prevention_training_version_hash_valid" CHECK (length("prevention_training_course_versions"."content_hash") = 64),
	CONSTRAINT "prevention_training_version_observed_has_comment" CHECK ("prevention_training_course_versions"."status" <> 'observed' OR length("prevention_training_course_versions"."observation_comment") >= 10),
	CONSTRAINT "prevention_training_version_version_positive" CHECK ("prevention_training_course_versions"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "prevention_training_courses" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"description" text,
	"minimum_duration_minutes" integer DEFAULT 480 NOT NULL,
	"validity_months" integer,
	"requires_assessment" boolean DEFAULT true NOT NULL,
	"passing_score" integer DEFAULT 70 NOT NULL,
	"legal_requirement_id" text,
	"risk_entry_id" text,
	"legal_basis" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prevention_training_courses_code_unique" UNIQUE("code"),
	CONSTRAINT "prevention_training_course_kind_valid" CHECK ("prevention_training_courses"."kind" IN ('induction_corporate', 'induction_worksite', 'odi', 'legal_mandatory', 'operational_talk', 'practical_training', 'certification', 'retraining')),
	CONSTRAINT "prevention_training_course_duration_positive" CHECK ("prevention_training_courses"."minimum_duration_minutes" > 0),
	CONSTRAINT "prevention_training_course_validity_positive" CHECK ("prevention_training_courses"."validity_months" IS NULL OR "prevention_training_courses"."validity_months" > 0),
	CONSTRAINT "prevention_training_course_score_valid" CHECK ("prevention_training_courses"."passing_score" BETWEEN 0 AND 100)
);
--> statement-breakpoint
CREATE TABLE "prevention_training_history" (
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
CREATE TABLE "prevention_training_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"course_version_id" text NOT NULL,
	"worksite_id" text NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"duration_minutes" integer,
	"modality" text NOT NULL,
	"location" text,
	"instructor_user_id" text,
	"instructor_external_name" text,
	"instructor_competency_evidence" text NOT NULL,
	"status" text DEFAULT 'planned' NOT NULL,
	"cancellation_reason" text,
	"cancelled_by_user_id" text,
	"cancelled_at" timestamp with time zone,
	"closed_by_user_id" text,
	"closed_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prevention_training_sessions_code_unique" UNIQUE("code"),
	CONSTRAINT "prevention_training_session_status_valid" CHECK ("prevention_training_sessions"."status" IN ('planned', 'in_progress', 'completed', 'cancelled')),
	CONSTRAINT "prevention_training_session_modality_valid" CHECK ("prevention_training_sessions"."modality" IN ('presencial', 'elearning', 'mixta', 'practica')),
	CONSTRAINT "prevention_training_session_instructor_present" CHECK ("prevention_training_sessions"."instructor_user_id" IS NOT NULL OR length("prevention_training_sessions"."instructor_external_name") >= 3),
	CONSTRAINT "prevention_training_session_instructor_evidence" CHECK (length("prevention_training_sessions"."instructor_competency_evidence") >= 5),
	CONSTRAINT "prevention_training_session_duration_positive" CHECK ("prevention_training_sessions"."duration_minutes" IS NULL OR "prevention_training_sessions"."duration_minutes" > 0),
	CONSTRAINT "prevention_training_session_cancel_consistent" CHECK (("prevention_training_sessions"."cancelled_at" IS NULL AND "prevention_training_sessions"."cancelled_by_user_id" IS NULL AND "prevention_training_sessions"."cancellation_reason" IS NULL) OR ("prevention_training_sessions"."cancelled_at" IS NOT NULL AND "prevention_training_sessions"."cancelled_by_user_id" IS NOT NULL AND length("prevention_training_sessions"."cancellation_reason") >= 5)),
	CONSTRAINT "prevention_training_session_version_positive" CHECK ("prevention_training_sessions"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "prevention_worker_competencies" (
	"id" text PRIMARY KEY NOT NULL,
	"worker_id" text NOT NULL,
	"course_id" text NOT NULL,
	"source_type" text NOT NULL,
	"source_session_id" text,
	"source_attendance_id" text,
	"granted_at" text NOT NULL,
	"expires_at" text,
	"status" text DEFAULT 'valid' NOT NULL,
	"evidence_reference" text,
	"external_issuer" text,
	"external_certificate_number" text,
	"convalidation_justification" text,
	"convalidation_approved_by_user_id" text,
	"convalidation_approved_at" timestamp with time zone,
	"revoked_by_user_id" text,
	"revoked_at" timestamp with time zone,
	"revocation_reason" text,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prevention_worker_competency_source_valid" CHECK ("prevention_worker_competencies"."source_type" IN ('session', 'convalidation', 'external_certificate')),
	CONSTRAINT "prevention_worker_competency_status_valid" CHECK ("prevention_worker_competencies"."status" IN ('valid', 'expired', 'revoked', 'superseded')),
	CONSTRAINT "prevention_worker_competency_convalidation_consistent" CHECK ("prevention_worker_competencies"."source_type" <> 'convalidation' OR (length("prevention_worker_competencies"."convalidation_justification") >= 10 AND "prevention_worker_competencies"."convalidation_approved_by_user_id" IS NOT NULL AND "prevention_worker_competencies"."convalidation_approved_at" IS NOT NULL)),
	CONSTRAINT "prevention_worker_competency_external_consistent" CHECK ("prevention_worker_competencies"."source_type" <> 'external_certificate' OR (length("prevention_worker_competencies"."external_issuer") >= 2 AND length("prevention_worker_competencies"."evidence_reference") >= 3)),
	CONSTRAINT "prevention_worker_competency_revoke_consistent" CHECK (("prevention_worker_competencies"."revoked_at" IS NULL AND "prevention_worker_competencies"."revoked_by_user_id" IS NULL AND "prevention_worker_competencies"."revocation_reason" IS NULL) OR ("prevention_worker_competencies"."revoked_at" IS NOT NULL AND "prevention_worker_competencies"."revoked_by_user_id" IS NOT NULL AND length("prevention_worker_competencies"."revocation_reason") >= 5))
);
--> statement-breakpoint
ALTER TABLE "prevention_capa_actions" DROP CONSTRAINT "prevention_capa_source_type_valid";--> statement-breakpoint
ALTER TABLE "prevention_competency_requirements" ADD CONSTRAINT "prevention_competency_requirements_course_id_prevention_training_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."prevention_training_courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_competency_requirements" ADD CONSTRAINT "prevention_competency_requirements_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_competency_requirements" ADD CONSTRAINT "prevention_competency_requirements_legal_requirement_id_prevention_legal_requirements_id_fk" FOREIGN KEY ("legal_requirement_id") REFERENCES "public"."prevention_legal_requirements"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_competency_requirements" ADD CONSTRAINT "prevention_competency_requirements_risk_entry_id_prevention_risk_entries_id_fk" FOREIGN KEY ("risk_entry_id") REFERENCES "public"."prevention_risk_entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_competency_requirements" ADD CONSTRAINT "prevention_competency_requirements_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_training_attendance" ADD CONSTRAINT "prevention_training_attendance_session_id_prevention_training_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."prevention_training_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_training_attendance" ADD CONSTRAINT "prevention_training_attendance_worker_id_workers_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_training_attendance" ADD CONSTRAINT "prevention_training_attendance_recorded_by_user_id_users_id_fk" FOREIGN KEY ("recorded_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_training_course_versions" ADD CONSTRAINT "prevention_training_course_versions_course_id_prevention_training_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."prevention_training_courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_training_course_versions" ADD CONSTRAINT "prevention_training_course_versions_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_training_course_versions" ADD CONSTRAINT "prevention_training_course_versions_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_training_course_versions" ADD CONSTRAINT "prevention_training_course_versions_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_training_course_versions" ADD CONSTRAINT "prevention_training_course_versions_published_by_user_id_users_id_fk" FOREIGN KEY ("published_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_training_courses" ADD CONSTRAINT "prevention_training_courses_legal_requirement_id_prevention_legal_requirements_id_fk" FOREIGN KEY ("legal_requirement_id") REFERENCES "public"."prevention_legal_requirements"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_training_courses" ADD CONSTRAINT "prevention_training_courses_risk_entry_id_prevention_risk_entries_id_fk" FOREIGN KEY ("risk_entry_id") REFERENCES "public"."prevention_risk_entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_training_courses" ADD CONSTRAINT "prevention_training_courses_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_training_history" ADD CONSTRAINT "prevention_training_history_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_training_history" ADD CONSTRAINT "prevention_training_history_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_training_sessions" ADD CONSTRAINT "prevention_training_sessions_course_version_id_prevention_training_course_versions_id_fk" FOREIGN KEY ("course_version_id") REFERENCES "public"."prevention_training_course_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_training_sessions" ADD CONSTRAINT "prevention_training_sessions_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_training_sessions" ADD CONSTRAINT "prevention_training_sessions_instructor_user_id_users_id_fk" FOREIGN KEY ("instructor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_training_sessions" ADD CONSTRAINT "prevention_training_sessions_cancelled_by_user_id_users_id_fk" FOREIGN KEY ("cancelled_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_training_sessions" ADD CONSTRAINT "prevention_training_sessions_closed_by_user_id_users_id_fk" FOREIGN KEY ("closed_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_training_sessions" ADD CONSTRAINT "prevention_training_sessions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_worker_competencies" ADD CONSTRAINT "prevention_worker_competencies_worker_id_workers_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_worker_competencies" ADD CONSTRAINT "prevention_worker_competencies_course_id_prevention_training_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."prevention_training_courses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_worker_competencies" ADD CONSTRAINT "prevention_worker_competencies_source_session_id_prevention_training_sessions_id_fk" FOREIGN KEY ("source_session_id") REFERENCES "public"."prevention_training_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_worker_competencies" ADD CONSTRAINT "prevention_worker_competencies_source_attendance_id_prevention_training_attendance_id_fk" FOREIGN KEY ("source_attendance_id") REFERENCES "public"."prevention_training_attendance"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_worker_competencies" ADD CONSTRAINT "prevention_worker_competencies_convalidation_approved_by_user_id_users_id_fk" FOREIGN KEY ("convalidation_approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_worker_competencies" ADD CONSTRAINT "prevention_worker_competencies_revoked_by_user_id_users_id_fk" FOREIGN KEY ("revoked_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_worker_competencies" ADD CONSTRAINT "prevention_worker_competencies_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "prevention_competency_requirement_scope_idx" ON "prevention_competency_requirements" USING btree ("scope_type","is_active");--> statement-breakpoint
CREATE INDEX "prevention_competency_requirement_worksite_idx" ON "prevention_competency_requirements" USING btree ("worksite_id","is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "prevention_training_attendance_unique" ON "prevention_training_attendance" USING btree ("session_id","worker_id");--> statement-breakpoint
CREATE INDEX "prevention_training_attendance_worker_idx" ON "prevention_training_attendance" USING btree ("worker_id");--> statement-breakpoint
CREATE UNIQUE INDEX "prevention_training_version_label_unique" ON "prevention_training_course_versions" USING btree ("course_id","version_label");--> statement-breakpoint
CREATE INDEX "prevention_training_version_status_idx" ON "prevention_training_course_versions" USING btree ("course_id","status");--> statement-breakpoint
CREATE INDEX "prevention_training_course_kind_idx" ON "prevention_training_courses" USING btree ("kind","is_active");--> statement-breakpoint
CREATE INDEX "prevention_training_history_entity_idx" ON "prevention_training_history" USING btree ("entity_type","entity_id","created_at");--> statement-breakpoint
CREATE INDEX "prevention_training_session_worksite_idx" ON "prevention_training_sessions" USING btree ("worksite_id","status");--> statement-breakpoint
CREATE INDEX "prevention_training_session_schedule_idx" ON "prevention_training_sessions" USING btree ("scheduled_at");--> statement-breakpoint
CREATE INDEX "prevention_worker_competency_lookup_idx" ON "prevention_worker_competencies" USING btree ("worker_id","course_id","status");--> statement-breakpoint
CREATE INDEX "prevention_worker_competency_expiry_idx" ON "prevention_worker_competencies" USING btree ("expires_at","status");--> statement-breakpoint
CREATE UNIQUE INDEX "prevention_worker_competency_attendance_unique" ON "prevention_worker_competencies" USING btree ("source_attendance_id");--> statement-breakpoint
ALTER TABLE "prevention_capa_actions" ADD CONSTRAINT "prevention_capa_source_type_valid" CHECK ("prevention_capa_actions"."source_type" IN ('pdtp', 'sst_evaluation', 'ppa', 'incident', 'risk', 'legal_requirement', 'training', 'manual'));