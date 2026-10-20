CREATE TABLE "prevention_incident_re20_attachments" (
	"id" text PRIMARY KEY NOT NULL,
	"incident_id" text NOT NULL,
	"client_attachment_id" text NOT NULL,
	"encrypted_file" text NOT NULL,
	"file_iv" text NOT NULL,
	"file_auth_tag" text NOT NULL,
	"file_key_version" text NOT NULL,
	"encrypted_metadata" text NOT NULL,
	"metadata_iv" text NOT NULL,
	"metadata_auth_tag" text NOT NULL,
	"metadata_key_version" text NOT NULL,
	"checksum_sha256" text NOT NULL,
	"file_size" integer NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "prevention_incident_re20_attachment_checksum_valid" CHECK (length("prevention_incident_re20_attachments"."checksum_sha256") = 64),
	CONSTRAINT "prevention_incident_re20_attachment_size_valid" CHECK ("prevention_incident_re20_attachments"."file_size" > 0 AND "prevention_incident_re20_attachments"."file_size" <= 10485760)
);
--> statement-breakpoint
ALTER TABLE "prevention_incident_re20_attachments" ADD CONSTRAINT "prevention_incident_re20_attachments_incident_id_prevention_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."prevention_incidents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_incident_re20_attachments" ADD CONSTRAINT "prevention_incident_re20_attachments_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "prevention_incident_re20_attachment_client_unique" ON "prevention_incident_re20_attachments" USING btree ("incident_id","client_attachment_id");