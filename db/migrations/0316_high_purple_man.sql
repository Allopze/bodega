CREATE TABLE "prevention_alcotest_slot_evidence" (
	"id" text PRIMARY KEY NOT NULL,
	"slot_id" text NOT NULL,
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
	CONSTRAINT "prevention_alcotest_slot_evidence_storage_path_unique" UNIQUE("storage_path"),
	CONSTRAINT "prevention_alcotest_evidence_name_check" CHECK (length("prevention_alcotest_slot_evidence"."file_name") BETWEEN 1 AND 255),
	CONSTRAINT "prevention_alcotest_evidence_size_check" CHECK ("prevention_alcotest_slot_evidence"."file_size_bytes" > 0),
	CONSTRAINT "prevention_alcotest_evidence_sha_check" CHECK ("prevention_alcotest_slot_evidence"."sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "prevention_alcotest_evidence_state_check" CHECK ("prevention_alcotest_slot_evidence"."state" IN ('active', 'replaced', 'annulled')),
	CONSTRAINT "prevention_alcotest_evidence_annul_check" CHECK (("prevention_alcotest_slot_evidence"."state" IN ('active', 'replaced') AND "prevention_alcotest_slot_evidence"."annulled_at" IS NULL AND "prevention_alcotest_slot_evidence"."annulled_by_user_id" IS NULL AND "prevention_alcotest_slot_evidence"."annulled_reason" IS NULL) OR ("prevention_alcotest_slot_evidence"."state" = 'annulled' AND "prevention_alcotest_slot_evidence"."annulled_at" IS NOT NULL AND "prevention_alcotest_slot_evidence"."annulled_by_user_id" IS NOT NULL AND length("prevention_alcotest_slot_evidence"."annulled_reason") >= 5))
);
--> statement-breakpoint
CREATE TABLE "prevention_alcotest_slots" (
	"id" text PRIMARY KEY NOT NULL,
	"worksite_id" text NOT NULL,
	"year" integer NOT NULL,
	"kind" text NOT NULL,
	"slot_key" text NOT NULL,
	"scheduled_month" integer NOT NULL,
	"scheduled_week" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"test_id" text,
	"dispatch_id" text,
	"completed_at" timestamp with time zone,
	"completed_by_user_id" text,
	"not_applicable_at" timestamp with time zone,
	"not_applicable_by_user_id" text,
	"not_applicable_reason" text,
	"observation" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prevention_alcotest_slot_year_check" CHECK ("prevention_alcotest_slots"."year" BETWEEN 2020 AND 2100),
	CONSTRAINT "prevention_alcotest_slot_kind_check" CHECK ("prevention_alcotest_slots"."kind" IN ('control', 'envio')),
	CONSTRAINT "prevention_alcotest_slot_status_check" CHECK ("prevention_alcotest_slots"."status" IN ('pending', 'completed', 'not_completed', 'not_applicable')),
	CONSTRAINT "prevention_alcotest_slot_period_check" CHECK ("prevention_alcotest_slots"."scheduled_month" BETWEEN 1 AND 12 AND "prevention_alcotest_slots"."scheduled_week" BETWEEN 1 AND 4),
	CONSTRAINT "prevention_alcotest_slot_kind_ref_check" CHECK (("prevention_alcotest_slots"."kind" = 'control' AND "prevention_alcotest_slots"."dispatch_id" IS NULL) OR ("prevention_alcotest_slots"."kind" = 'envio' AND "prevention_alcotest_slots"."test_id" IS NULL)),
	CONSTRAINT "prevention_alcotest_slot_done_check" CHECK (("prevention_alcotest_slots"."status" = 'completed' AND COALESCE("prevention_alcotest_slots"."test_id", "prevention_alcotest_slots"."dispatch_id") IS NOT NULL AND "prevention_alcotest_slots"."completed_at" IS NOT NULL AND "prevention_alcotest_slots"."completed_by_user_id" IS NOT NULL) OR ("prevention_alcotest_slots"."status" <> 'completed' AND "prevention_alcotest_slots"."completed_at" IS NULL AND "prevention_alcotest_slots"."completed_by_user_id" IS NULL)),
	CONSTRAINT "prevention_alcotest_slot_na_check" CHECK (("prevention_alcotest_slots"."status" = 'not_applicable' AND "prevention_alcotest_slots"."not_applicable_at" IS NOT NULL AND "prevention_alcotest_slots"."not_applicable_by_user_id" IS NOT NULL AND length(trim(COALESCE("prevention_alcotest_slots"."not_applicable_reason", ''))) >= 10) OR ("prevention_alcotest_slots"."status" <> 'not_applicable' AND "prevention_alcotest_slots"."not_applicable_at" IS NULL AND "prevention_alcotest_slots"."not_applicable_by_user_id" IS NULL AND "prevention_alcotest_slots"."not_applicable_reason" IS NULL)),
	CONSTRAINT "prevention_alcotest_slot_version_check" CHECK ("prevention_alcotest_slots"."version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "prevention_alcotest_slot_evidence" ADD CONSTRAINT "alcotest_evidence_slot_fk" FOREIGN KEY ("slot_id") REFERENCES "public"."prevention_alcotest_slots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_alcotest_slot_evidence" ADD CONSTRAINT "alcotest_evidence_uploader_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_alcotest_slot_evidence" ADD CONSTRAINT "alcotest_evidence_annuller_fk" FOREIGN KEY ("annulled_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_alcotest_slots" ADD CONSTRAINT "alcotest_slot_worksite_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_alcotest_slots" ADD CONSTRAINT "alcotest_slot_test_fk" FOREIGN KEY ("test_id") REFERENCES "public"."alcohol_tests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_alcotest_slots" ADD CONSTRAINT "alcotest_slot_dispatch_fk" FOREIGN KEY ("dispatch_id") REFERENCES "public"."alcohol_test_dispatches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_alcotest_slots" ADD CONSTRAINT "alcotest_slot_completer_fk" FOREIGN KEY ("completed_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_alcotest_slots" ADD CONSTRAINT "alcotest_slot_na_actor_fk" FOREIGN KEY ("not_applicable_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "prevention_alcotest_slot_evidence_idx" ON "prevention_alcotest_slot_evidence" USING btree ("slot_id","state","uploaded_at");--> statement-breakpoint
CREATE UNIQUE INDEX "prevention_alcotest_slot_unique" ON "prevention_alcotest_slots" USING btree ("worksite_id","year","kind","slot_key");--> statement-breakpoint
CREATE INDEX "prevention_alcotest_slot_period_idx" ON "prevention_alcotest_slots" USING btree ("worksite_id","year","status");