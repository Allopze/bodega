CREATE TABLE "prevention_grd_committees" (
	"id" text PRIMARY KEY NOT NULL,
	"worksite_id" text NOT NULL,
	"name" text NOT NULL,
	"constituted_on" text NOT NULL,
	"mandate_ends_on" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prevention_grd_committee_status_valid" CHECK ("prevention_grd_committees"."status" IN ('active', 'dissolved', 'expired')),
	CONSTRAINT "prevention_grd_committee_mandate_valid" CHECK ("prevention_grd_committees"."mandate_ends_on" > "prevention_grd_committees"."constituted_on"),
	CONSTRAINT "prevention_grd_committee_version_positive" CHECK ("prevention_grd_committees"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "prevention_grd_matrices" (
	"id" text PRIMARY KEY NOT NULL,
	"worksite_id" text NOT NULL,
	"matrix_version" integer NOT NULL,
	"title" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"revision_reason" text NOT NULL,
	"published_hash_sha256" text,
	"created_by_user_id" text NOT NULL,
	"reviewed_by_user_id" text,
	"reviewed_at" timestamp with time zone,
	"approved_by_user_id" text,
	"approved_at" timestamp with time zone,
	"published_by_user_id" text,
	"published_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prevention_grd_matrices_status_valid" CHECK ("prevention_grd_matrices"."status" IN ('draft', 'in_review', 'reviewed', 'approved', 'published', 'superseded')),
	CONSTRAINT "prevention_grd_matrices_version_positive" CHECK ("prevention_grd_matrices"."matrix_version" > 0 AND "prevention_grd_matrices"."version" > 0),
	CONSTRAINT "prevention_grd_matrices_publish_evidence" CHECK ("prevention_grd_matrices"."status" NOT IN ('approved', 'published', 'superseded') OR ("prevention_grd_matrices"."reviewed_by_user_id" IS NOT NULL AND "prevention_grd_matrices"."approved_by_user_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "prevention_grd_meetings" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"committee_id" text NOT NULL,
	"scheduled_for" timestamp with time zone NOT NULL,
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
	CONSTRAINT "prevention_grd_meetings_code_unique" UNIQUE("code"),
	CONSTRAINT "prevention_grd_meeting_status_valid" CHECK ("prevention_grd_meetings"."status" IN ('scheduled', 'closed', 'cancelled')),
	CONSTRAINT "prevention_grd_meeting_closed_has_minutes" CHECK ("prevention_grd_meetings"."status" <> 'closed' OR length("prevention_grd_meetings"."minutes") >= 20),
	CONSTRAINT "prevention_grd_meeting_cancel_consistent" CHECK ("prevention_grd_meetings"."status" <> 'cancelled' OR length("prevention_grd_meetings"."cancellation_reason") >= 10),
	CONSTRAINT "prevention_grd_meeting_version_positive" CHECK ("prevention_grd_meetings"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "prevention_grd_members" (
	"id" text PRIMARY KEY NOT NULL,
	"committee_id" text NOT NULL,
	"worker_id" text NOT NULL,
	"role" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prevention_grd_member_role_valid" CHECK ("prevention_grd_members"."role" IS NULL OR "prevention_grd_members"."role" IN ('presidente', 'secretario', 'integrante')),
	CONSTRAINT "prevention_grd_member_status_valid" CHECK ("prevention_grd_members"."status" IN ('active', 'replaced', 'resigned'))
);
--> statement-breakpoint
CREATE TABLE "prevention_grd_threats" (
	"id" text PRIMARY KEY NOT NULL,
	"matrix_id" text NOT NULL,
	"name" text NOT NULL,
	"origin" text NOT NULL,
	"historical_analysis" text NOT NULL,
	"legal_requirement" text NOT NULL,
	"work_plan" text NOT NULL,
	"emergency_scenario_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prevention_grd_threat_origin_valid" CHECK ("prevention_grd_threats"."origin" IN ('obligatoria', 'detectada')),
	CONSTRAINT "prevention_grd_threat_name_valid" CHECK (length("prevention_grd_threats"."name") >= 3),
	CONSTRAINT "prevention_grd_threat_historical_analysis_valid" CHECK (length("prevention_grd_threats"."historical_analysis") >= 10),
	CONSTRAINT "prevention_grd_threat_legal_requirement_valid" CHECK (length("prevention_grd_threats"."legal_requirement") >= 10),
	CONSTRAINT "prevention_grd_threat_work_plan_valid" CHECK (length("prevention_grd_threats"."work_plan") >= 10)
);
--> statement-breakpoint
ALTER TABLE "sst_document_links" DROP CONSTRAINT "sst_document_links_entity_type_valid";--> statement-breakpoint
ALTER TABLE "prevention_pdtp_source_links" DROP CONSTRAINT "prevention_pdtp_source_links_type_valid";--> statement-breakpoint
ALTER TABLE "prevention_grd_committees" ADD CONSTRAINT "prevention_grd_committees_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_grd_committees" ADD CONSTRAINT "prevention_grd_committees_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_grd_matrices" ADD CONSTRAINT "prevention_grd_matrices_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_grd_matrices" ADD CONSTRAINT "prevention_grd_matrices_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_grd_matrices" ADD CONSTRAINT "prevention_grd_matrices_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_grd_matrices" ADD CONSTRAINT "prevention_grd_matrices_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_grd_matrices" ADD CONSTRAINT "prevention_grd_matrices_published_by_user_id_users_id_fk" FOREIGN KEY ("published_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_grd_meetings" ADD CONSTRAINT "prevention_grd_meetings_committee_id_prevention_grd_committees_id_fk" FOREIGN KEY ("committee_id") REFERENCES "public"."prevention_grd_committees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_grd_meetings" ADD CONSTRAINT "prevention_grd_meetings_closed_by_user_id_users_id_fk" FOREIGN KEY ("closed_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_grd_meetings" ADD CONSTRAINT "prevention_grd_meetings_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_grd_members" ADD CONSTRAINT "prevention_grd_members_committee_id_prevention_grd_committees_id_fk" FOREIGN KEY ("committee_id") REFERENCES "public"."prevention_grd_committees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_grd_members" ADD CONSTRAINT "prevention_grd_members_worker_id_workers_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_grd_threats" ADD CONSTRAINT "prevention_grd_threats_matrix_id_prevention_grd_matrices_id_fk" FOREIGN KEY ("matrix_id") REFERENCES "public"."prevention_grd_matrices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_grd_threats" ADD CONSTRAINT "prevention_grd_threats_emergency_scenario_id_prevention_emergency_scenarios_id_fk" FOREIGN KEY ("emergency_scenario_id") REFERENCES "public"."prevention_emergency_scenarios"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "prevention_grd_committee_active_worksite_unique" ON "prevention_grd_committees" USING btree ("worksite_id") WHERE "prevention_grd_committees"."status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "prevention_grd_matrices_scope_version_unique" ON "prevention_grd_matrices" USING btree ("worksite_id","matrix_version");--> statement-breakpoint
CREATE INDEX "prevention_grd_matrices_scope_status_idx" ON "prevention_grd_matrices" USING btree ("worksite_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "prevention_grd_matrices_one_published_scope_unique" ON "prevention_grd_matrices" USING btree ("worksite_id") WHERE "prevention_grd_matrices"."status" = 'published';--> statement-breakpoint
CREATE INDEX "prevention_grd_meeting_committee_idx" ON "prevention_grd_meetings" USING btree ("committee_id","scheduled_for");--> statement-breakpoint
CREATE UNIQUE INDEX "prevention_grd_member_unique" ON "prevention_grd_members" USING btree ("committee_id","worker_id") WHERE "prevention_grd_members"."status" = 'active';--> statement-breakpoint
CREATE INDEX "prevention_grd_member_committee_idx" ON "prevention_grd_members" USING btree ("committee_id","status");--> statement-breakpoint
CREATE INDEX "prevention_grd_threat_matrix_idx" ON "prevention_grd_threats" USING btree ("matrix_id");--> statement-breakpoint
ALTER TABLE "sst_document_links" ADD CONSTRAINT "sst_document_links_entity_type_valid" CHECK ("sst_document_links"."entity_type" IN ('worker', 'worksite', 'vehicle', 'equipment', 'incident', 'training', 'committee', 'epp_delivery', 'corrective_action', 'emergency_plan', 'pdtp_activity', 'pdtp_execution', 'pdtp_checklist', 'sst_evaluation', 'ppa', 'external_engagement', 'grd_committee', 'grd_matrix', 'grd_meeting'));--> statement-breakpoint
ALTER TABLE "prevention_pdtp_source_links" ADD CONSTRAINT "prevention_pdtp_source_links_type_valid" CHECK ("prevention_pdtp_source_links"."source_type" IN ('risk_control', 'legal_requirement', 'incident_capa', 'audit', 'contractual_obligation', 'capacitacion', 'inspeccion', 'cphs', 'epp', 'emergencia', 'campana', 'protocolo_minsal', 'cgrd'));