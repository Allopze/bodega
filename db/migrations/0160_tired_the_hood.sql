CREATE TABLE "prevention_committee_program_activities" (
	"id" text PRIMARY KEY NOT NULL,
	"program_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"planned_month" integer NOT NULL,
	"due_on" text,
	"responsible_member_id" text,
	"commission_label" text,
	"risk_topic" text,
	"status" text DEFAULT 'planned' NOT NULL,
	"completed_at" timestamp with time zone,
	"completion_note" text,
	"evidence_reference" text,
	"evidence_checksum_sha256" text,
	"reviewed_in_meeting_id" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prevention_committee_program_activity_title_valid" CHECK (length("prevention_committee_program_activities"."title") >= 5),
	CONSTRAINT "prevention_committee_program_activity_month_valid" CHECK ("prevention_committee_program_activities"."planned_month" BETWEEN 1 AND 12),
	CONSTRAINT "prevention_committee_program_activity_status_valid" CHECK ("prevention_committee_program_activities"."status" IN ('planned', 'done', 'cancelled')),
	CONSTRAINT "prevention_committee_program_activity_risk_topic_valid" CHECK ("prevention_committee_program_activities"."risk_topic" IS NULL OR "prevention_committee_program_activities"."risk_topic" IN ('vial', 'higiene', 'ergonomia', 'psicosocial', 'silice', 'otro')),
	CONSTRAINT "prevention_committee_program_activity_done_consistent" CHECK ("prevention_committee_program_activities"."status" <> 'done' OR "prevention_committee_program_activities"."completed_at" IS NOT NULL),
	CONSTRAINT "prevention_committee_program_activity_cancel_consistent" CHECK ("prevention_committee_program_activities"."status" <> 'cancelled' OR length("prevention_committee_program_activities"."completion_note") >= 10),
	CONSTRAINT "prevention_committee_program_activity_checksum_valid" CHECK ("prevention_committee_program_activities"."evidence_checksum_sha256" IS NULL OR length("prevention_committee_program_activities"."evidence_checksum_sha256") = 64),
	CONSTRAINT "prevention_committee_program_activity_version_positive" CHECK ("prevention_committee_program_activities"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "prevention_committee_programs" (
	"id" text PRIMARY KEY NOT NULL,
	"committee_id" text NOT NULL,
	"year" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"approved_by_user_id" text,
	"approved_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prevention_committee_program_status_valid" CHECK ("prevention_committee_programs"."status" IN ('draft', 'active', 'closed')),
	CONSTRAINT "prevention_committee_program_year_valid" CHECK ("prevention_committee_programs"."year" BETWEEN 2020 AND 2100),
	CONSTRAINT "prevention_committee_program_approval_consistent" CHECK ("prevention_committee_programs"."status" = 'draft' OR ("prevention_committee_programs"."approved_by_user_id" IS NOT NULL AND "prevention_committee_programs"."approved_at" IS NOT NULL)),
	CONSTRAINT "prevention_committee_program_version_positive" CHECK ("prevention_committee_programs"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "prevention_worksite_delegates" (
	"id" text PRIMARY KEY NOT NULL,
	"worksite_id" text NOT NULL,
	"worker_id" text NOT NULL,
	"designated_on" text NOT NULL,
	"term_ends_on" text,
	"status" text DEFAULT 'active' NOT NULL,
	"ended_reason" text,
	"ended_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prevention_worksite_delegate_status_valid" CHECK ("prevention_worksite_delegates"."status" IN ('active', 'ended')),
	CONSTRAINT "prevention_worksite_delegate_term_valid" CHECK ("prevention_worksite_delegates"."term_ends_on" IS NULL OR "prevention_worksite_delegates"."term_ends_on" > "prevention_worksite_delegates"."designated_on"),
	CONSTRAINT "prevention_worksite_delegate_end_consistent" CHECK (("prevention_worksite_delegates"."ended_at" IS NULL AND "prevention_worksite_delegates"."ended_reason" IS NULL) OR ("prevention_worksite_delegates"."ended_at" IS NOT NULL AND length("prevention_worksite_delegates"."ended_reason") >= 10)),
	CONSTRAINT "prevention_worksite_delegate_version_positive" CHECK ("prevention_worksite_delegates"."version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "prevention_committees" ADD COLUMN "dt_registered_on" text;--> statement-breakpoint
ALTER TABLE "prevention_committees" ADD COLUMN "dt_registration_reference" text;--> statement-breakpoint
ALTER TABLE "prevention_committee_program_activities" ADD CONSTRAINT "prevention_committee_program_activities_program_id_prevention_committee_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."prevention_committee_programs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_committee_program_activities" ADD CONSTRAINT "prevention_committee_program_activities_responsible_member_id_prevention_committee_members_id_fk" FOREIGN KEY ("responsible_member_id") REFERENCES "public"."prevention_committee_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_committee_program_activities" ADD CONSTRAINT "prevention_committee_program_activities_reviewed_in_meeting_id_prevention_committee_meetings_id_fk" FOREIGN KEY ("reviewed_in_meeting_id") REFERENCES "public"."prevention_committee_meetings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_committee_program_activities" ADD CONSTRAINT "prevention_committee_program_activities_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_committee_programs" ADD CONSTRAINT "prevention_committee_programs_committee_id_prevention_committees_id_fk" FOREIGN KEY ("committee_id") REFERENCES "public"."prevention_committees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_committee_programs" ADD CONSTRAINT "prevention_committee_programs_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_committee_programs" ADD CONSTRAINT "prevention_committee_programs_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_worksite_delegates" ADD CONSTRAINT "prevention_worksite_delegates_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_worksite_delegates" ADD CONSTRAINT "prevention_worksite_delegates_worker_id_workers_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_worksite_delegates" ADD CONSTRAINT "prevention_worksite_delegates_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "prevention_committee_program_activity_idx" ON "prevention_committee_program_activities" USING btree ("program_id","planned_month");--> statement-breakpoint
CREATE UNIQUE INDEX "prevention_committee_program_unique" ON "prevention_committee_programs" USING btree ("committee_id","year");--> statement-breakpoint
CREATE UNIQUE INDEX "prevention_worksite_delegate_active_unique" ON "prevention_worksite_delegates" USING btree ("worksite_id") WHERE "prevention_worksite_delegates"."status" = 'active';--> statement-breakpoint
ALTER TABLE "prevention_committees" ADD CONSTRAINT "prevention_committee_dt_registration_consistent" CHECK ("prevention_committees"."dt_registered_on" IS NULL OR length("prevention_committees"."dt_registration_reference") >= 3);