CREATE TABLE "sst_document_acks" (
	"id" text PRIMARY KEY NOT NULL,
	"version_id" text NOT NULL,
	"user_id" text NOT NULL,
	"method" text DEFAULT 'digital' NOT NULL,
	"signature" text NOT NULL,
	"ip" text,
	"user_agent" text,
	"acknowledged_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sst_document_audit" (
	"id" text PRIMARY KEY NOT NULL,
	"document_id" text NOT NULL,
	"version_id" text,
	"action" text NOT NULL,
	"user_id" text,
	"from_status" text,
	"to_status" text,
	"comment" text,
	"metadata" jsonb,
	"ip" text,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "sst_document_audit_action_valid" CHECK ("sst_document_audit"."action" IN ('create', 'upload', 'view', 'download', 'edit', 'status_change', 'approve', 'observe', 'replace', 'archive', 'ack', 'link', 'unlink', 'delete', 'permission_change'))
);
--> statement-breakpoint
CREATE TABLE "sst_document_categories" (
	"slug" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sst_document_links" (
	"id" text PRIMARY KEY NOT NULL,
	"document_id" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "sst_document_links_entity_type_valid" CHECK ("sst_document_links"."entity_type" IN ('worker', 'worksite', 'vehicle', 'equipment', 'incident', 'training', 'committee', 'epp_delivery', 'corrective_action', 'emergency_plan'))
);
--> statement-breakpoint
CREATE TABLE "sst_document_types" (
	"id" text PRIMARY KEY NOT NULL,
	"category_slug" text NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"default_confidentiality" text DEFAULT 'publico_interno' NOT NULL,
	"default_validity_months" integer,
	"requires_approval" boolean DEFAULT true NOT NULL,
	"requires_acknowledgment" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sst_document_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"document_id" text NOT NULL,
	"version" integer NOT NULL,
	"status" text DEFAULT 'borrador' NOT NULL,
	"file_name" text NOT NULL,
	"storage_name" text NOT NULL,
	"file_path" text NOT NULL,
	"mime_type" text NOT NULL,
	"file_size" integer NOT NULL,
	"checksum" text NOT NULL,
	"effective_from" text,
	"effective_to" text,
	"changelog" text,
	"uploaded_by" text NOT NULL,
	"reviewed_by" text,
	"approved_by" text,
	"approved_at" timestamp with time zone,
	"supersedes_id" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "sst_document_versions_status_valid" CHECK ("sst_document_versions"."status" IN ('borrador', 'en_revision', 'observado', 'aprobado', 'vigente', 'reemplazado', 'archivado')),
	CONSTRAINT "sst_document_versions_size_positive" CHECK ("sst_document_versions"."file_size" > 0)
);
--> statement-breakpoint
CREATE TABLE "sst_documents" (
	"id" text PRIMARY KEY NOT NULL,
	"category_slug" text NOT NULL,
	"type_id" text,
	"internal_code" text,
	"title" text NOT NULL,
	"description" text,
	"worksite_id" text,
	"status" text DEFAULT 'borrador' NOT NULL,
	"confidentiality" text DEFAULT 'publico_interno' NOT NULL,
	"current_version_id" text,
	"effective_from" text,
	"expires_at" text,
	"responsible_user_id" text,
	"uploaded_by" text NOT NULL,
	"reviewed_by" text,
	"approved_by" text,
	"approved_at" timestamp with time zone,
	"requires_acknowledgment" boolean DEFAULT false NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"extra_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"checksum" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "sst_documents_status_valid" CHECK ("sst_documents"."status" IN ('borrador', 'en_revision', 'observado', 'aprobado', 'vigente', 'vencido', 'reemplazado', 'archivado')),
	CONSTRAINT "sst_documents_confidentiality_valid" CHECK ("sst_documents"."confidentiality" IN ('publico_interno', 'restringido', 'sensible'))
);
--> statement-breakpoint
ALTER TABLE "sst_document_acks" ADD CONSTRAINT "sst_document_acks_version_id_sst_document_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."sst_document_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sst_document_acks" ADD CONSTRAINT "sst_document_acks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sst_document_audit" ADD CONSTRAINT "sst_document_audit_document_id_sst_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."sst_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sst_document_audit" ADD CONSTRAINT "sst_document_audit_version_id_sst_document_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."sst_document_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sst_document_audit" ADD CONSTRAINT "sst_document_audit_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sst_document_links" ADD CONSTRAINT "sst_document_links_document_id_sst_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."sst_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sst_document_types" ADD CONSTRAINT "sst_document_types_category_slug_sst_document_categories_slug_fk" FOREIGN KEY ("category_slug") REFERENCES "public"."sst_document_categories"("slug") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sst_document_versions" ADD CONSTRAINT "sst_document_versions_document_id_sst_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."sst_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sst_document_versions" ADD CONSTRAINT "sst_document_versions_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sst_document_versions" ADD CONSTRAINT "sst_document_versions_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sst_document_versions" ADD CONSTRAINT "sst_document_versions_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sst_documents" ADD CONSTRAINT "sst_documents_category_slug_sst_document_categories_slug_fk" FOREIGN KEY ("category_slug") REFERENCES "public"."sst_document_categories"("slug") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sst_documents" ADD CONSTRAINT "sst_documents_type_id_sst_document_types_id_fk" FOREIGN KEY ("type_id") REFERENCES "public"."sst_document_types"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sst_documents" ADD CONSTRAINT "sst_documents_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sst_documents" ADD CONSTRAINT "sst_documents_responsible_user_id_users_id_fk" FOREIGN KEY ("responsible_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sst_documents" ADD CONSTRAINT "sst_documents_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sst_documents" ADD CONSTRAINT "sst_documents_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sst_documents" ADD CONSTRAINT "sst_documents_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sst_document_acks_version_user_unique" ON "sst_document_acks" USING btree ("version_id","user_id");--> statement-breakpoint
CREATE INDEX "sst_document_acks_user_idx" ON "sst_document_acks" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sst_document_audit_doc_created_idx" ON "sst_document_audit" USING btree ("document_id","created_at");--> statement-breakpoint
CREATE INDEX "sst_document_audit_user_idx" ON "sst_document_audit" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sst_document_links_doc_entity_unique" ON "sst_document_links" USING btree ("document_id","entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "sst_document_links_entity_idx" ON "sst_document_links" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sst_document_types_category_code_unique" ON "sst_document_types" USING btree ("category_slug","code");--> statement-breakpoint
CREATE UNIQUE INDEX "sst_document_versions_doc_version_unique" ON "sst_document_versions" USING btree ("document_id","version");--> statement-breakpoint
CREATE INDEX "sst_document_versions_doc_status_idx" ON "sst_document_versions" USING btree ("document_id","status");--> statement-breakpoint
CREATE INDEX "sst_document_versions_checksum_idx" ON "sst_document_versions" USING btree ("checksum");--> statement-breakpoint
CREATE INDEX "sst_documents_category_status_idx" ON "sst_documents" USING btree ("category_slug","status");--> statement-breakpoint
CREATE INDEX "sst_documents_worksite_status_idx" ON "sst_documents" USING btree ("worksite_id","status");--> statement-breakpoint
CREATE INDEX "sst_documents_expires_idx" ON "sst_documents" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "sst_documents_responsible_idx" ON "sst_documents" USING btree ("responsible_user_id");