CREATE TABLE "prevention_evidence_uploads" (
	"path" text PRIMARY KEY NOT NULL,
	"domain" text NOT NULL,
	"uploaded_by_user_id" text,
	"worksite_id" text,
	"sha256" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"mime_type" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"claimed_at" timestamp with time zone,
	CONSTRAINT "prevention_evidence_uploads_domain_check" CHECK ("prevention_evidence_uploads"."domain" IN ('campaign', 'cgrd', 'hygiene', 'capa')),
	CONSTRAINT "prevention_evidence_uploads_sha256_check" CHECK ("prevention_evidence_uploads"."sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "prevention_evidence_uploads_size_check" CHECK ("prevention_evidence_uploads"."size_bytes" > 0),
	CONSTRAINT "prevention_evidence_uploads_claim_check" CHECK (("prevention_evidence_uploads"."worksite_id" IS NULL) = ("prevention_evidence_uploads"."claimed_at" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "pdtp_fulfillment_events" ADD COLUMN "actor_user_id" text;--> statement-breakpoint
ALTER TABLE "prevention_evidence_uploads" ADD CONSTRAINT "prevention_evidence_uploads_uploaded_by_user_id_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_evidence_uploads" ADD CONSTRAINT "prevention_evidence_uploads_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "prevention_evidence_uploads_worksite_idx" ON "prevention_evidence_uploads" USING btree ("worksite_id");--> statement-breakpoint
ALTER TABLE "pdtp_fulfillment_events" ADD CONSTRAINT "pdtp_fulfillment_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;