CREATE TABLE "prevention_health_clinical_payloads" (
	"id" text PRIMARY KEY NOT NULL,
	"health_record_id" text NOT NULL,
	"encrypted_payload" text NOT NULL,
	"iv" text NOT NULL,
	"auth_tag" text NOT NULL,
	"key_version" text NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prevention_health_records" (
	"id" text PRIMARY KEY NOT NULL,
	"worker_id" text NOT NULL,
	"worksite_id" text NOT NULL,
	"record_type" text NOT NULL,
	"status" text DEFAULT 'vigente' NOT NULL,
	"fitness_status" text DEFAULT 'pendiente' NOT NULL,
	"restrictions_summary" text,
	"valid_from" text,
	"valid_until" text,
	"issuer_name" text,
	"provider_name" text,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "prevention_health_record_type_valid" CHECK ("prevention_health_records"."record_type" IN ('aptitud', 'vigilancia', 'examen_ocupacional', 'evaluacion_exposicion')),
	CONSTRAINT "prevention_health_status_valid" CHECK ("prevention_health_records"."status" IN ('borrador', 'vigente', 'reemplazado', 'archivado')),
	CONSTRAINT "prevention_health_fitness_valid" CHECK ("prevention_health_records"."fitness_status" IN ('pendiente', 'apto', 'apto_con_restricciones', 'no_apto'))
);
--> statement-breakpoint
CREATE TABLE "prevention_privacy_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"subject_worker_id" text NOT NULL,
	"right_type" text NOT NULL,
	"status" text DEFAULT 'recibida' NOT NULL,
	"request_scope" text NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"due_at" timestamp with time zone,
	"handled_by_user_id" text,
	"completed_at" timestamp with time zone,
	"legal_hold" boolean DEFAULT false NOT NULL,
	"legal_hold_reason" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "prevention_privacy_request_right_valid" CHECK ("prevention_privacy_requests"."right_type" IN ('access', 'rectification', 'deletion', 'opposition', 'portability', 'restriction')),
	CONSTRAINT "prevention_privacy_request_status_valid" CHECK ("prevention_privacy_requests"."status" IN ('recibida', 'validando_identidad', 'en_proceso', 'suspendida_retencion', 'completada', 'rechazada')),
	CONSTRAINT "prevention_privacy_request_hold_valid" CHECK (("prevention_privacy_requests"."legal_hold" = false AND "prevention_privacy_requests"."legal_hold_reason" IS NULL) OR ("prevention_privacy_requests"."legal_hold" = true AND length("prevention_privacy_requests"."legal_hold_reason") >= 3))
);
--> statement-breakpoint
CREATE TABLE "prevention_reserved_case_members" (
	"case_id" text NOT NULL,
	"user_id" text NOT NULL,
	"member_role" text NOT NULL,
	"purpose" text NOT NULL,
	"assigned_by_user_id" text NOT NULL,
	"assigned_at" timestamp with time zone NOT NULL,
	CONSTRAINT "prevention_reserved_case_member_role_valid" CHECK ("prevention_reserved_case_members"."member_role" IN ('investigador', 'revisor', 'custodio'))
);
--> statement-breakpoint
CREATE TABLE "prevention_reserved_cases" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"worksite_id" text NOT NULL,
	"category" text NOT NULL,
	"status" text DEFAULT 'abierto' NOT NULL,
	"encrypted_payload" text NOT NULL,
	"iv" text NOT NULL,
	"auth_tag" text NOT NULL,
	"key_version" text NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "prevention_reserved_cases_code_unique" UNIQUE("code"),
	CONSTRAINT "prevention_reserved_case_category_valid" CHECK ("prevention_reserved_cases"."category" IN ('ley_karin', 'denuncia_reservada', 'investigacion_interna')),
	CONSTRAINT "prevention_reserved_case_status_valid" CHECK ("prevention_reserved_cases"."status" IN ('abierto', 'en_investigacion', 'cerrado', 'archivado'))
);
--> statement-breakpoint
CREATE TABLE "prevention_sensitive_access_audit" (
	"id" text PRIMARY KEY NOT NULL,
	"domain" text NOT NULL,
	"entity_id" text NOT NULL,
	"subject_worker_id" text,
	"worksite_id" text,
	"actor_user_id" text,
	"action" text NOT NULL,
	"purpose" text NOT NULL,
	"outcome" text NOT NULL,
	"reason_code" text,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "prevention_sensitive_audit_domain_valid" CHECK ("prevention_sensitive_access_audit"."domain" IN ('health', 'reserved_case', 'privacy_request')),
	CONSTRAINT "prevention_sensitive_audit_action_valid" CHECK ("prevention_sensitive_access_audit"."action" IN ('create', 'read_restrictions', 'read_clinical', 'read_reserved', 'update', 'export', 'archive', 'grant_access', 'revoke_access')),
	CONSTRAINT "prevention_sensitive_audit_outcome_valid" CHECK ("prevention_sensitive_access_audit"."outcome" IN ('granted', 'denied'))
);
--> statement-breakpoint
ALTER TABLE "sst_documents" ADD COLUMN "data_class" text DEFAULT 'operational' NOT NULL;--> statement-breakpoint
ALTER TABLE "prevention_health_clinical_payloads" ADD CONSTRAINT "prevention_health_clinical_payloads_health_record_id_prevention_health_records_id_fk" FOREIGN KEY ("health_record_id") REFERENCES "public"."prevention_health_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_health_clinical_payloads" ADD CONSTRAINT "prevention_health_clinical_payloads_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_health_records" ADD CONSTRAINT "prevention_health_records_worker_id_workers_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_health_records" ADD CONSTRAINT "prevention_health_records_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_health_records" ADD CONSTRAINT "prevention_health_records_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_privacy_requests" ADD CONSTRAINT "prevention_privacy_requests_subject_worker_id_workers_id_fk" FOREIGN KEY ("subject_worker_id") REFERENCES "public"."workers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_privacy_requests" ADD CONSTRAINT "prevention_privacy_requests_handled_by_user_id_users_id_fk" FOREIGN KEY ("handled_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_reserved_case_members" ADD CONSTRAINT "prevention_reserved_case_members_case_id_prevention_reserved_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."prevention_reserved_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_reserved_case_members" ADD CONSTRAINT "prevention_reserved_case_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_reserved_case_members" ADD CONSTRAINT "prevention_reserved_case_members_assigned_by_user_id_users_id_fk" FOREIGN KEY ("assigned_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_reserved_cases" ADD CONSTRAINT "prevention_reserved_cases_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_reserved_cases" ADD CONSTRAINT "prevention_reserved_cases_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_sensitive_access_audit" ADD CONSTRAINT "prevention_sensitive_access_audit_subject_worker_id_workers_id_fk" FOREIGN KEY ("subject_worker_id") REFERENCES "public"."workers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_sensitive_access_audit" ADD CONSTRAINT "prevention_sensitive_access_audit_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_sensitive_access_audit" ADD CONSTRAINT "prevention_sensitive_access_audit_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "prevention_health_clinical_record_unique" ON "prevention_health_clinical_payloads" USING btree ("health_record_id");--> statement-breakpoint
CREATE INDEX "prevention_health_worker_status_idx" ON "prevention_health_records" USING btree ("worker_id","status");--> statement-breakpoint
CREATE INDEX "prevention_health_worksite_status_idx" ON "prevention_health_records" USING btree ("worksite_id","status");--> statement-breakpoint
CREATE INDEX "prevention_health_valid_until_idx" ON "prevention_health_records" USING btree ("valid_until");--> statement-breakpoint
CREATE INDEX "prevention_privacy_request_subject_status_idx" ON "prevention_privacy_requests" USING btree ("subject_worker_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "prevention_reserved_case_member_unique" ON "prevention_reserved_case_members" USING btree ("case_id","user_id");--> statement-breakpoint
CREATE INDEX "prevention_reserved_case_member_user_idx" ON "prevention_reserved_case_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "prevention_reserved_case_worksite_status_idx" ON "prevention_reserved_cases" USING btree ("worksite_id","status");--> statement-breakpoint
CREATE INDEX "prevention_sensitive_audit_entity_idx" ON "prevention_sensitive_access_audit" USING btree ("domain","entity_id","created_at");--> statement-breakpoint
CREATE INDEX "prevention_sensitive_audit_actor_idx" ON "prevention_sensitive_access_audit" USING btree ("actor_user_id","created_at");--> statement-breakpoint
CREATE INDEX "prevention_sensitive_audit_subject_idx" ON "prevention_sensitive_access_audit" USING btree ("subject_worker_id","created_at");--> statement-breakpoint
ALTER TABLE "sst_documents" ADD CONSTRAINT "sst_documents_data_class_valid" CHECK ("sst_documents"."data_class" IN ('operational', 'personal', 'sensitive_preventive', 'client_secret'));