ALTER TABLE "prevention_sensitive_files" DROP CONSTRAINT IF EXISTS "prevention_sensitive_file_domain_valid";--> statement-breakpoint
ALTER TABLE "prevention_incident_re20_attachments" ALTER COLUMN "encrypted_file" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "prevention_incident_re20_attachments" ALTER COLUMN "file_iv" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "prevention_incident_re20_attachments" ALTER COLUMN "file_auth_tag" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "prevention_incident_re20_attachments" ALTER COLUMN "file_key_version" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "prevention_incident_re20_attachments" ADD COLUMN "sensitive_file_id" text;--> statement-breakpoint
ALTER TABLE "prevention_incident_re20_attachments" ADD CONSTRAINT "prevention_incident_re20_attachments_sensitive_file_id_prevention_sensitive_files_id_fk" FOREIGN KEY ("sensitive_file_id") REFERENCES "public"."prevention_sensitive_files"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "prevention_incident_re20_attachment_file_unique" ON "prevention_incident_re20_attachments" USING btree ("sensitive_file_id");--> statement-breakpoint
ALTER TABLE "prevention_sensitive_files" ADD CONSTRAINT "prevention_sensitive_file_domain_valid" CHECK ("prevention_sensitive_files"."domain" IN ('health', 'reserved_case', 'incident_re20'));--> statement-breakpoint
ALTER TABLE "prevention_incident_re20_attachments" ADD CONSTRAINT "prevention_incident_re20_attachment_storage_valid" CHECK ("prevention_incident_re20_attachments"."sensitive_file_id" IS NOT NULL OR "prevention_incident_re20_attachments"."encrypted_file" IS NOT NULL);