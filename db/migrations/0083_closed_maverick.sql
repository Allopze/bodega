CREATE TABLE "backup_log" (
	"id" text PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"backup_date" text NOT NULL,
	"pg_size_bytes" bigint,
	"pg_sha256" text,
	"storage_size_bytes" bigint,
	"storage_sha256" text,
	"config_size_bytes" bigint,
	"config_sha256" text,
	"manifest_sha256" text,
	"drive_path" text,
	"drive_uploaded" boolean DEFAULT false,
	"app_version" text,
	"hostname" text,
	"total_size_bytes" bigint,
	"error_message" text,
	"error_code" text,
	"trigger" text DEFAULT 'cron',
	"triggered_by_user_id" text
);
--> statement-breakpoint
CREATE TABLE "prevention_committee_agreements" (
	"id" text PRIMARY KEY NOT NULL,
	"meeting_id" text NOT NULL,
	"description" text NOT NULL,
	"capa_action_id" text,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prevention_committee_agreement_status_valid" CHECK ("prevention_committee_agreements"."status" IN ('open', 'capa_linked', 'closed'))
);
--> statement-breakpoint
CREATE TABLE "prevention_committee_attendance" (
	"id" text PRIMARY KEY NOT NULL,
	"meeting_id" text NOT NULL,
	"member_id" text NOT NULL,
	"attended" boolean DEFAULT false NOT NULL,
	"excuse_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prevention_committee_meetings" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"committee_id" text NOT NULL,
	"meeting_type" text DEFAULT 'ordinary' NOT NULL,
	"scheduled_for" timestamp with time zone NOT NULL,
	"held_at" timestamp with time zone,
	"agenda" text NOT NULL,
	"minutes" text,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"quorum_reached" boolean DEFAULT false NOT NULL,
	"closed_by_user_id" text,
	"closed_at" timestamp with time zone,
	"cancellation_reason" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prevention_committee_meetings_code_unique" UNIQUE("code"),
	CONSTRAINT "prevention_committee_meeting_type_valid" CHECK ("prevention_committee_meetings"."meeting_type" IN ('ordinary', 'extraordinary')),
	CONSTRAINT "prevention_committee_meeting_status_valid" CHECK ("prevention_committee_meetings"."status" IN ('scheduled', 'held', 'closed', 'cancelled')),
	CONSTRAINT "prevention_committee_meeting_closed_has_minutes" CHECK ("prevention_committee_meetings"."status" <> 'closed' OR length("prevention_committee_meetings"."minutes") >= 20),
	CONSTRAINT "prevention_committee_meeting_cancel_consistent" CHECK ("prevention_committee_meetings"."status" <> 'cancelled' OR length("prevention_committee_meetings"."cancellation_reason") >= 10),
	CONSTRAINT "prevention_committee_meeting_version_positive" CHECK ("prevention_committee_meetings"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "prevention_committee_members" (
	"id" text PRIMARY KEY NOT NULL,
	"committee_id" text NOT NULL,
	"worker_id" text NOT NULL,
	"representation" text NOT NULL,
	"seat" text NOT NULL,
	"role" text,
	"elected_on" text,
	"term_ends_on" text,
	"has_fuero" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"replaced_by_member_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prevention_committee_member_representation_valid" CHECK ("prevention_committee_members"."representation" IN ('company', 'workers')),
	CONSTRAINT "prevention_committee_member_seat_valid" CHECK ("prevention_committee_members"."seat" IN ('titular', 'suplente')),
	CONSTRAINT "prevention_committee_member_role_valid" CHECK ("prevention_committee_members"."role" IS NULL OR "prevention_committee_members"."role" IN ('presidente', 'secretario', 'integrante')),
	CONSTRAINT "prevention_committee_member_status_valid" CHECK ("prevention_committee_members"."status" IN ('active', 'replaced', 'resigned'))
);
--> statement-breakpoint
CREATE TABLE "prevention_committees" (
	"id" text PRIMARY KEY NOT NULL,
	"worksite_id" text NOT NULL,
	"name" text NOT NULL,
	"constituted_on" text NOT NULL,
	"mandate_ends_on" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"meeting_day_of_month" integer,
	"dissolved_reason" text,
	"dissolved_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prevention_committee_status_valid" CHECK ("prevention_committees"."status" IN ('active', 'dissolved', 'expired')),
	CONSTRAINT "prevention_committee_mandate_valid" CHECK ("prevention_committees"."mandate_ends_on" > "prevention_committees"."constituted_on"),
	CONSTRAINT "prevention_committee_meeting_day_valid" CHECK ("prevention_committees"."meeting_day_of_month" IS NULL OR "prevention_committees"."meeting_day_of_month" BETWEEN 1 AND 28),
	CONSTRAINT "prevention_committee_dissolve_consistent" CHECK (("prevention_committees"."dissolved_at" IS NULL AND "prevention_committees"."dissolved_reason" IS NULL) OR ("prevention_committees"."dissolved_at" IS NOT NULL AND length("prevention_committees"."dissolved_reason") >= 10)),
	CONSTRAINT "prevention_committee_version_positive" CHECK ("prevention_committees"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "prevention_governance_history" (
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
CREATE TABLE "prevention_management_reviews" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"worksite_id" text,
	"period_label" text NOT NULL,
	"held_at" timestamp with time zone NOT NULL,
	"inputs" jsonb NOT NULL,
	"conclusions" text,
	"resource_decisions" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"closed_by_user_id" text,
	"closed_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prevention_management_reviews_code_unique" UNIQUE("code"),
	CONSTRAINT "prevention_management_review_status_valid" CHECK ("prevention_management_reviews"."status" IN ('draft', 'closed')),
	CONSTRAINT "prevention_management_review_closed_consistent" CHECK ("prevention_management_reviews"."status" <> 'closed' OR (length("prevention_management_reviews"."conclusions") >= 20 AND "prevention_management_reviews"."closed_by_user_id" IS NOT NULL AND "prevention_management_reviews"."closed_at" IS NOT NULL)),
	CONSTRAINT "prevention_management_review_version_positive" CHECK ("prevention_management_reviews"."version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "prevention_capa_actions" DROP CONSTRAINT "prevention_capa_source_type_valid";--> statement-breakpoint
ALTER TABLE "prevention_committee_agreements" ADD CONSTRAINT "prevention_committee_agreements_meeting_id_prevention_committee_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."prevention_committee_meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_committee_agreements" ADD CONSTRAINT "prevention_committee_agreements_capa_action_id_prevention_capa_actions_id_fk" FOREIGN KEY ("capa_action_id") REFERENCES "public"."prevention_capa_actions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_committee_attendance" ADD CONSTRAINT "prevention_committee_attendance_meeting_id_prevention_committee_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."prevention_committee_meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_committee_attendance" ADD CONSTRAINT "prevention_committee_attendance_member_id_prevention_committee_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."prevention_committee_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_committee_meetings" ADD CONSTRAINT "prevention_committee_meetings_committee_id_prevention_committees_id_fk" FOREIGN KEY ("committee_id") REFERENCES "public"."prevention_committees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_committee_meetings" ADD CONSTRAINT "prevention_committee_meetings_closed_by_user_id_users_id_fk" FOREIGN KEY ("closed_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_committee_meetings" ADD CONSTRAINT "prevention_committee_meetings_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_committee_members" ADD CONSTRAINT "prevention_committee_members_committee_id_prevention_committees_id_fk" FOREIGN KEY ("committee_id") REFERENCES "public"."prevention_committees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_committee_members" ADD CONSTRAINT "prevention_committee_members_worker_id_workers_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_committees" ADD CONSTRAINT "prevention_committees_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_committees" ADD CONSTRAINT "prevention_committees_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_governance_history" ADD CONSTRAINT "prevention_governance_history_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_governance_history" ADD CONSTRAINT "prevention_governance_history_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_management_reviews" ADD CONSTRAINT "prevention_management_reviews_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_management_reviews" ADD CONSTRAINT "prevention_management_reviews_closed_by_user_id_users_id_fk" FOREIGN KEY ("closed_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_management_reviews" ADD CONSTRAINT "prevention_management_reviews_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "backup_log_date_idx" ON "backup_log" USING btree ("backup_date");--> statement-breakpoint
CREATE INDEX "backup_log_status_idx" ON "backup_log" USING btree ("status");--> statement-breakpoint
CREATE INDEX "backup_log_started_idx" ON "backup_log" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "prevention_committee_agreement_meeting_idx" ON "prevention_committee_agreements" USING btree ("meeting_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "prevention_committee_attendance_unique" ON "prevention_committee_attendance" USING btree ("meeting_id","member_id");--> statement-breakpoint
CREATE INDEX "prevention_committee_meeting_committee_idx" ON "prevention_committee_meetings" USING btree ("committee_id","scheduled_for");--> statement-breakpoint
CREATE UNIQUE INDEX "prevention_committee_member_unique" ON "prevention_committee_members" USING btree ("committee_id","worker_id") WHERE "prevention_committee_members"."status" = 'active';--> statement-breakpoint
CREATE INDEX "prevention_committee_member_committee_idx" ON "prevention_committee_members" USING btree ("committee_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "prevention_committee_active_worksite_unique" ON "prevention_committees" USING btree ("worksite_id") WHERE "prevention_committees"."status" = 'active';--> statement-breakpoint
CREATE INDEX "prevention_governance_history_entity_idx" ON "prevention_governance_history" USING btree ("entity_type","entity_id","created_at");--> statement-breakpoint
CREATE INDEX "prevention_management_review_period_idx" ON "prevention_management_reviews" USING btree ("period_label","held_at");--> statement-breakpoint
ALTER TABLE "prevention_capa_actions" ADD CONSTRAINT "prevention_capa_source_type_valid" CHECK ("prevention_capa_actions"."source_type" IN ('pdtp', 'sst_evaluation', 'ppa', 'incident', 'risk', 'legal_requirement', 'training', 'contractor', 'work_permit', 'inspection', 'cphs', 'manual'));