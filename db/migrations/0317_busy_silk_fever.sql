CREATE TABLE "prevention_hygiene_measurement_evidence" (
	"id" text PRIMARY KEY NOT NULL,
	"measurement_id" text NOT NULL,
	"file_name" text NOT NULL,
	"storage_path" text NOT NULL,
	"mime_type" text NOT NULL,
	"file_size_bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"state" text DEFAULT 'active' NOT NULL,
	"uploaded_by_user_id" text,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"annulled_by_user_id" text,
	"annulled_at" timestamp with time zone,
	"annulled_reason" text,
	CONSTRAINT "prevention_hygiene_measurement_evidence_storage_path_unique" UNIQUE("storage_path"),
	CONSTRAINT "prevention_hygiene_meas_ev_name_check" CHECK (length("prevention_hygiene_measurement_evidence"."file_name") BETWEEN 1 AND 255),
	CONSTRAINT "prevention_hygiene_meas_ev_size_check" CHECK ("prevention_hygiene_measurement_evidence"."file_size_bytes" > 0),
	CONSTRAINT "prevention_hygiene_meas_ev_sha_check" CHECK ("prevention_hygiene_measurement_evidence"."sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "prevention_hygiene_meas_ev_state_check" CHECK ("prevention_hygiene_measurement_evidence"."state" IN ('active', 'replaced', 'annulled')),
	CONSTRAINT "prevention_hygiene_meas_ev_annul_check" CHECK (("prevention_hygiene_measurement_evidence"."state" IN ('active', 'replaced') AND "prevention_hygiene_measurement_evidence"."annulled_at" IS NULL AND "prevention_hygiene_measurement_evidence"."annulled_by_user_id" IS NULL AND "prevention_hygiene_measurement_evidence"."annulled_reason" IS NULL) OR ("prevention_hygiene_measurement_evidence"."state" = 'annulled' AND "prevention_hygiene_measurement_evidence"."annulled_at" IS NOT NULL AND "prevention_hygiene_measurement_evidence"."annulled_by_user_id" IS NOT NULL AND length("prevention_hygiene_measurement_evidence"."annulled_reason") >= 5))
);
--> statement-breakpoint
ALTER TABLE "prevention_hygiene_measurement_evidence" ADD CONSTRAINT "hygiene_measurement_evidence_fk" FOREIGN KEY ("measurement_id") REFERENCES "public"."prevention_exposure_measurements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_hygiene_measurement_evidence" ADD CONSTRAINT "hygiene_measurement_ev_uploader_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_hygiene_measurement_evidence" ADD CONSTRAINT "hygiene_measurement_ev_annuller_fk" FOREIGN KEY ("annulled_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "prevention_hygiene_measurement_evidence_idx" ON "prevention_hygiene_measurement_evidence" USING btree ("measurement_id","state","uploaded_at");