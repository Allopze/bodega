CREATE TABLE "prevention_document_relocations" (
	"id" text PRIMARY KEY NOT NULL,
	"source_document_id" text NOT NULL,
	"source_version_id" text NOT NULL,
	"sensitive_file_id" text,
	"target_domain" text NOT NULL,
	"target_entity_id" text NOT NULL,
	"status" text DEFAULT 'copying' NOT NULL,
	"reason" text NOT NULL,
	"source_checksum" text NOT NULL,
	"target_checksum" text,
	"initiated_by_user_id" text NOT NULL,
	"initiated_at" timestamp with time zone NOT NULL,
	"completed_by_user_id" text,
	"completed_at" timestamp with time zone,
	"failure_reason" text,
	CONSTRAINT "prevention_document_relocation_target_valid" CHECK ("prevention_document_relocations"."target_domain" IN ('health', 'reserved_case')),
	CONSTRAINT "prevention_document_relocation_status_valid" CHECK ("prevention_document_relocations"."status" IN ('copying', 'source_restricted', 'failed', 'cancelled')),
	CONSTRAINT "prevention_document_relocation_checksum_valid" CHECK (length("prevention_document_relocations"."source_checksum") = 64 AND ("prevention_document_relocations"."target_checksum" IS NULL OR length("prevention_document_relocations"."target_checksum") = 64))
);
--> statement-breakpoint
CREATE TABLE "prevention_privacy_request_executions" (
	"id" text PRIMARY KEY NOT NULL,
	"request_id" text NOT NULL,
	"domain" text NOT NULL,
	"entity_id" text NOT NULL,
	"operation" text NOT NULL,
	"outcome" text NOT NULL,
	"before_hash" text NOT NULL,
	"after_hash" text NOT NULL,
	"reason" text NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"actor_user_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "prevention_privacy_execution_domain_valid" CHECK ("prevention_privacy_request_executions"."domain" IN ('health_record', 'reserved_case', 'ppa', 'document', 'processing_restriction')),
	CONSTRAINT "prevention_privacy_execution_operation_valid" CHECK ("prevention_privacy_request_executions"."operation" IN ('rectification', 'deletion', 'opposition', 'restriction')),
	CONSTRAINT "prevention_privacy_execution_outcome_valid" CHECK ("prevention_privacy_request_executions"."outcome" IN ('applied', 'partially_applied', 'blocked_retention', 'rejected')),
	CONSTRAINT "prevention_privacy_execution_hashes_valid" CHECK (length("prevention_privacy_request_executions"."before_hash") = 64 AND length("prevention_privacy_request_executions"."after_hash") = 64)
);
--> statement-breakpoint
CREATE TABLE "prevention_reserved_case_subjects" (
	"id" text PRIMARY KEY NOT NULL,
	"case_id" text NOT NULL,
	"worker_id" text NOT NULL,
	"relationship" text NOT NULL,
	"linkage_purpose" text NOT NULL,
	"linked_by_user_id" text NOT NULL,
	"linked_at" timestamp with time zone NOT NULL,
	"removed_by_user_id" text,
	"removed_at" timestamp with time zone,
	"removal_reason" text,
	CONSTRAINT "prevention_reserved_case_subject_relationship_valid" CHECK ("prevention_reserved_case_subjects"."relationship" IN ('titular', 'afectado', 'denunciante', 'denunciado', 'testigo')),
	CONSTRAINT "prevention_reserved_case_subject_removal_valid" CHECK (
    ("prevention_reserved_case_subjects"."removed_at" IS NULL AND "prevention_reserved_case_subjects"."removed_by_user_id" IS NULL AND "prevention_reserved_case_subjects"."removal_reason" IS NULL)
    OR ("prevention_reserved_case_subjects"."removed_at" IS NOT NULL AND "prevention_reserved_case_subjects"."removed_by_user_id" IS NOT NULL AND length("prevention_reserved_case_subjects"."removal_reason") >= 5)
  )
);
--> statement-breakpoint
CREATE TABLE "prevention_sensitive_files" (
	"id" text PRIMARY KEY NOT NULL,
	"domain" text NOT NULL,
	"entity_id" text NOT NULL,
	"subject_worker_id" text,
	"worksite_id" text NOT NULL,
	"file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"file_size" integer NOT NULL,
	"encrypted_file_path" text NOT NULL,
	"source_checksum" text NOT NULL,
	"encrypted_checksum" text NOT NULL,
	"iv" text NOT NULL,
	"auth_tag" text NOT NULL,
	"key_version" text NOT NULL,
	"source_document_id" text,
	"source_version_id" text,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "prevention_sensitive_file_domain_valid" CHECK ("prevention_sensitive_files"."domain" IN ('health', 'reserved_case')),
	CONSTRAINT "prevention_sensitive_file_size_valid" CHECK ("prevention_sensitive_files"."file_size" > 0),
	CONSTRAINT "prevention_sensitive_file_checksums_valid" CHECK (length("prevention_sensitive_files"."source_checksum") = 64 AND length("prevention_sensitive_files"."encrypted_checksum") = 64)
);
--> statement-breakpoint
CREATE TABLE "prevention_subject_processing_restrictions" (
	"id" text PRIMARY KEY NOT NULL,
	"subject_worker_id" text NOT NULL,
	"request_id" text NOT NULL,
	"domain" text NOT NULL,
	"entity_id" text,
	"restriction_type" text NOT NULL,
	"purpose_scope" text NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"applied_by_user_id" text NOT NULL,
	"applied_at" timestamp with time zone NOT NULL,
	"revoked_by_user_id" text,
	"revoked_at" timestamp with time zone,
	"revocation_reason" text,
	CONSTRAINT "prevention_subject_restriction_domain_valid" CHECK ("prevention_subject_processing_restrictions"."domain" IN ('health', 'reserved_case', 'ppa', 'documents', 'all')),
	CONSTRAINT "prevention_subject_restriction_type_valid" CHECK ("prevention_subject_processing_restrictions"."restriction_type" IN ('opposition', 'restriction')),
	CONSTRAINT "prevention_subject_restriction_status_valid" CHECK ("prevention_subject_processing_restrictions"."status" IN ('active', 'revoked')),
	CONSTRAINT "prevention_subject_restriction_revoke_valid" CHECK (
    ("prevention_subject_processing_restrictions"."status" = 'active' AND "prevention_subject_processing_restrictions"."revoked_at" IS NULL AND "prevention_subject_processing_restrictions"."revoked_by_user_id" IS NULL AND "prevention_subject_processing_restrictions"."revocation_reason" IS NULL)
    OR ("prevention_subject_processing_restrictions"."status" = 'revoked' AND "prevention_subject_processing_restrictions"."revoked_at" IS NOT NULL AND "prevention_subject_processing_restrictions"."revoked_by_user_id" IS NOT NULL AND length("prevention_subject_processing_restrictions"."revocation_reason") >= 5)
  )
);
--> statement-breakpoint
DROP INDEX "sst_document_links_doc_entity_unique";--> statement-breakpoint
ALTER TABLE "prevention_document_relocations" ADD CONSTRAINT "prevention_document_relocations_source_document_id_sst_documents_id_fk" FOREIGN KEY ("source_document_id") REFERENCES "public"."sst_documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_document_relocations" ADD CONSTRAINT "prevention_document_relocations_source_version_id_sst_document_versions_id_fk" FOREIGN KEY ("source_version_id") REFERENCES "public"."sst_document_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_document_relocations" ADD CONSTRAINT "prevention_document_relocations_sensitive_file_id_prevention_sensitive_files_id_fk" FOREIGN KEY ("sensitive_file_id") REFERENCES "public"."prevention_sensitive_files"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_document_relocations" ADD CONSTRAINT "prevention_document_relocations_initiated_by_user_id_users_id_fk" FOREIGN KEY ("initiated_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_document_relocations" ADD CONSTRAINT "prevention_document_relocations_completed_by_user_id_users_id_fk" FOREIGN KEY ("completed_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_privacy_request_executions" ADD CONSTRAINT "prevention_privacy_request_executions_request_id_prevention_privacy_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."prevention_privacy_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_privacy_request_executions" ADD CONSTRAINT "prevention_privacy_request_executions_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_reserved_case_subjects" ADD CONSTRAINT "prevention_reserved_case_subjects_case_id_prevention_reserved_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."prevention_reserved_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_reserved_case_subjects" ADD CONSTRAINT "prevention_reserved_case_subjects_worker_id_workers_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_reserved_case_subjects" ADD CONSTRAINT "prevention_reserved_case_subjects_linked_by_user_id_users_id_fk" FOREIGN KEY ("linked_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_reserved_case_subjects" ADD CONSTRAINT "prevention_reserved_case_subjects_removed_by_user_id_users_id_fk" FOREIGN KEY ("removed_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_sensitive_files" ADD CONSTRAINT "prevention_sensitive_files_subject_worker_id_workers_id_fk" FOREIGN KEY ("subject_worker_id") REFERENCES "public"."workers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_sensitive_files" ADD CONSTRAINT "prevention_sensitive_files_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_sensitive_files" ADD CONSTRAINT "prevention_sensitive_files_source_document_id_sst_documents_id_fk" FOREIGN KEY ("source_document_id") REFERENCES "public"."sst_documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_sensitive_files" ADD CONSTRAINT "prevention_sensitive_files_source_version_id_sst_document_versions_id_fk" FOREIGN KEY ("source_version_id") REFERENCES "public"."sst_document_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_sensitive_files" ADD CONSTRAINT "prevention_sensitive_files_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_subject_processing_restrictions" ADD CONSTRAINT "prevention_subject_processing_restrictions_subject_worker_id_workers_id_fk" FOREIGN KEY ("subject_worker_id") REFERENCES "public"."workers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_subject_processing_restrictions" ADD CONSTRAINT "prevention_subject_processing_restrictions_request_id_prevention_privacy_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."prevention_privacy_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_subject_processing_restrictions" ADD CONSTRAINT "prevention_subject_processing_restrictions_applied_by_user_id_users_id_fk" FOREIGN KEY ("applied_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_subject_processing_restrictions" ADD CONSTRAINT "prevention_subject_processing_restrictions_revoked_by_user_id_users_id_fk" FOREIGN KEY ("revoked_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "prevention_document_relocation_source_idx" ON "prevention_document_relocations" USING btree ("source_document_id","initiated_at");--> statement-breakpoint
CREATE INDEX "prevention_document_relocation_target_idx" ON "prevention_document_relocations" USING btree ("target_domain","target_entity_id","initiated_at");--> statement-breakpoint
CREATE INDEX "prevention_privacy_execution_request_idx" ON "prevention_privacy_request_executions" USING btree ("request_id","created_at");--> statement-breakpoint
CREATE INDEX "prevention_privacy_execution_entity_idx" ON "prevention_privacy_request_executions" USING btree ("domain","entity_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "prevention_reserved_case_subject_active_unique" ON "prevention_reserved_case_subjects" USING btree ("case_id","worker_id","relationship") WHERE "prevention_reserved_case_subjects"."removed_at" IS NULL;--> statement-breakpoint
CREATE INDEX "prevention_reserved_case_subject_worker_idx" ON "prevention_reserved_case_subjects" USING btree ("worker_id","linked_at");--> statement-breakpoint
CREATE INDEX "prevention_sensitive_file_entity_idx" ON "prevention_sensitive_files" USING btree ("domain","entity_id","created_at");--> statement-breakpoint
CREATE INDEX "prevention_sensitive_file_subject_idx" ON "prevention_sensitive_files" USING btree ("subject_worker_id","created_at");--> statement-breakpoint
CREATE INDEX "prevention_subject_restriction_subject_idx" ON "prevention_subject_processing_restrictions" USING btree ("subject_worker_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "prevention_subject_restriction_active_unique" ON "prevention_subject_processing_restrictions" USING btree ("request_id","domain","entity_id","restriction_type") WHERE "prevention_subject_processing_restrictions"."status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "sst_document_links_doc_entity_unique" ON "sst_document_links" USING btree ("document_id","entity_type","entity_id") WHERE "sst_document_links"."removed_at" IS NULL;