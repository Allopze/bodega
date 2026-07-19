CREATE TABLE "prevention_accreditation_items" (
	"id" text PRIMARY KEY NOT NULL,
	"requirement_id" text NOT NULL,
	"contract_id" text NOT NULL,
	"contractor_worker_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"document_reference" text,
	"checksum_sha256" text,
	"issued_on" text,
	"expires_on" text,
	"submitted_by_user_id" text,
	"submitted_at" timestamp with time zone,
	"reviewed_by_user_id" text,
	"reviewed_at" timestamp with time zone,
	"observation" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prevention_accreditation_item_status_valid" CHECK ("prevention_accreditation_items"."status" IN ('pending', 'submitted', 'observed', 'approved', 'expired')),
	CONSTRAINT "prevention_accreditation_item_checksum_valid" CHECK ("prevention_accreditation_items"."checksum_sha256" IS NULL OR length("prevention_accreditation_items"."checksum_sha256") = 64),
	CONSTRAINT "prevention_accreditation_item_observed_has_comment" CHECK ("prevention_accreditation_items"."status" <> 'observed' OR length("prevention_accreditation_items"."observation") >= 5),
	CONSTRAINT "prevention_accreditation_item_submitted_has_reference" CHECK ("prevention_accreditation_items"."status" IN ('pending') OR length("prevention_accreditation_items"."document_reference") >= 3),
	CONSTRAINT "prevention_accreditation_item_expiry_after_issue" CHECK ("prevention_accreditation_items"."expires_on" IS NULL OR "prevention_accreditation_items"."issued_on" IS NULL OR "prevention_accreditation_items"."expires_on" >= "prevention_accreditation_items"."issued_on"),
	CONSTRAINT "prevention_accreditation_item_version_positive" CHECK ("prevention_accreditation_items"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "prevention_accreditation_requirements" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"applies_to" text NOT NULL,
	"worksite_id" text,
	"relationship" text,
	"enforcement" text DEFAULT 'blocking' NOT NULL,
	"requires_expiry" boolean DEFAULT true NOT NULL,
	"legal_basis" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prevention_accreditation_requirements_code_unique" UNIQUE("code"),
	CONSTRAINT "prevention_accreditation_requirement_applies_valid" CHECK ("prevention_accreditation_requirements"."applies_to" IN ('company', 'contract', 'worker')),
	CONSTRAINT "prevention_accreditation_requirement_enforcement_valid" CHECK ("prevention_accreditation_requirements"."enforcement" IN ('blocking', 'warning')),
	CONSTRAINT "prevention_accreditation_requirement_relationship_valid" CHECK ("prevention_accreditation_requirements"."relationship" IS NULL OR "prevention_accreditation_requirements"."relationship" IN ('contractor', 'subcontractor', 'service_provider')),
	CONSTRAINT "prevention_accreditation_requirement_basis_valid" CHECK (length("prevention_accreditation_requirements"."legal_basis") >= 5)
);
--> statement-breakpoint
CREATE TABLE "prevention_contractor_companies" (
	"id" text PRIMARY KEY NOT NULL,
	"rut" text NOT NULL,
	"legal_name" text NOT NULL,
	"trade_name" text,
	"business_activity" text,
	"insurance_administrator" text,
	"contact_name" text,
	"contact_email" text,
	"contact_phone" text,
	"parent_company_id" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prevention_contractor_companies_rut_unique" UNIQUE("rut"),
	CONSTRAINT "prevention_contractor_company_rut_valid" CHECK (length("prevention_contractor_companies"."rut") >= 8),
	CONSTRAINT "prevention_contractor_company_not_self_parent" CHECK ("prevention_contractor_companies"."parent_company_id" IS NULL OR "prevention_contractor_companies"."parent_company_id" <> "prevention_contractor_companies"."id")
);
--> statement-breakpoint
CREATE TABLE "prevention_contractor_contracts" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"company_id" text NOT NULL,
	"worksite_id" text NOT NULL,
	"relationship" text NOT NULL,
	"scope" text NOT NULL,
	"starts_on" text NOT NULL,
	"ends_on" text,
	"planned_headcount" integer,
	"status" text DEFAULT 'draft' NOT NULL,
	"access_blocked" boolean DEFAULT true NOT NULL,
	"access_block_reason" text,
	"access_released_by_user_id" text,
	"access_released_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prevention_contractor_contracts_code_unique" UNIQUE("code"),
	CONSTRAINT "prevention_contractor_contract_relationship_valid" CHECK ("prevention_contractor_contracts"."relationship" IN ('contractor', 'subcontractor', 'service_provider')),
	CONSTRAINT "prevention_contractor_contract_status_valid" CHECK ("prevention_contractor_contracts"."status" IN ('draft', 'active', 'suspended', 'finished')),
	CONSTRAINT "prevention_contractor_contract_dates_valid" CHECK ("prevention_contractor_contracts"."ends_on" IS NULL OR "prevention_contractor_contracts"."ends_on" >= "prevention_contractor_contracts"."starts_on"),
	CONSTRAINT "prevention_contractor_contract_headcount_valid" CHECK ("prevention_contractor_contracts"."planned_headcount" IS NULL OR "prevention_contractor_contracts"."planned_headcount" > 0),
	CONSTRAINT "prevention_contractor_contract_version_positive" CHECK ("prevention_contractor_contracts"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "prevention_contractor_history" (
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
CREATE TABLE "prevention_contractor_workers" (
	"id" text PRIMARY KEY NOT NULL,
	"contract_id" text NOT NULL,
	"rut" text NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"position" text,
	"shift" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"access_blocked" boolean DEFAULT true NOT NULL,
	"starts_on" text,
	"ends_on" text,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prevention_contractor_worker_status_valid" CHECK ("prevention_contractor_workers"."status" IN ('pending', 'accredited', 'rejected', 'withdrawn')),
	CONSTRAINT "prevention_contractor_worker_rut_valid" CHECK (length("prevention_contractor_workers"."rut") >= 8)
);
--> statement-breakpoint
CREATE TABLE "prevention_coordination_meetings" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"worksite_id" text NOT NULL,
	"held_at" timestamp with time zone NOT NULL,
	"subject" text NOT NULL,
	"agenda" text NOT NULL,
	"attendees" jsonb NOT NULL,
	"minutes" text,
	"risk_exchange_summary" text,
	"status" text DEFAULT 'planned' NOT NULL,
	"closed_by_user_id" text,
	"closed_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prevention_coordination_meetings_code_unique" UNIQUE("code"),
	CONSTRAINT "prevention_coordination_meeting_status_valid" CHECK ("prevention_coordination_meetings"."status" IN ('planned', 'held', 'closed', 'cancelled')),
	CONSTRAINT "prevention_coordination_meeting_closed_has_minutes" CHECK ("prevention_coordination_meetings"."status" <> 'closed' OR length("prevention_coordination_meetings"."minutes") >= 10),
	CONSTRAINT "prevention_coordination_meeting_version_positive" CHECK ("prevention_coordination_meetings"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "prevention_coordination_participants" (
	"id" text PRIMARY KEY NOT NULL,
	"meeting_id" text NOT NULL,
	"contract_id" text NOT NULL,
	"attended" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "prevention_capa_actions" DROP CONSTRAINT "prevention_capa_source_type_valid";--> statement-breakpoint
ALTER TABLE "prevention_accreditation_items" ADD CONSTRAINT "prevention_accreditation_items_requirement_id_prevention_accreditation_requirements_id_fk" FOREIGN KEY ("requirement_id") REFERENCES "public"."prevention_accreditation_requirements"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_accreditation_items" ADD CONSTRAINT "prevention_accreditation_items_contract_id_prevention_contractor_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."prevention_contractor_contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_accreditation_items" ADD CONSTRAINT "prevention_accreditation_items_contractor_worker_id_prevention_contractor_workers_id_fk" FOREIGN KEY ("contractor_worker_id") REFERENCES "public"."prevention_contractor_workers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_accreditation_items" ADD CONSTRAINT "prevention_accreditation_items_submitted_by_user_id_users_id_fk" FOREIGN KEY ("submitted_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_accreditation_items" ADD CONSTRAINT "prevention_accreditation_items_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_accreditation_requirements" ADD CONSTRAINT "prevention_accreditation_requirements_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_accreditation_requirements" ADD CONSTRAINT "prevention_accreditation_requirements_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_contractor_companies" ADD CONSTRAINT "prevention_contractor_companies_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_contractor_contracts" ADD CONSTRAINT "prevention_contractor_contracts_company_id_prevention_contractor_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."prevention_contractor_companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_contractor_contracts" ADD CONSTRAINT "prevention_contractor_contracts_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_contractor_contracts" ADD CONSTRAINT "prevention_contractor_contracts_access_released_by_user_id_users_id_fk" FOREIGN KEY ("access_released_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_contractor_contracts" ADD CONSTRAINT "prevention_contractor_contracts_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_contractor_history" ADD CONSTRAINT "prevention_contractor_history_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_contractor_history" ADD CONSTRAINT "prevention_contractor_history_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_contractor_workers" ADD CONSTRAINT "prevention_contractor_workers_contract_id_prevention_contractor_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."prevention_contractor_contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_contractor_workers" ADD CONSTRAINT "prevention_contractor_workers_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_coordination_meetings" ADD CONSTRAINT "prevention_coordination_meetings_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_coordination_meetings" ADD CONSTRAINT "prevention_coordination_meetings_closed_by_user_id_users_id_fk" FOREIGN KEY ("closed_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_coordination_meetings" ADD CONSTRAINT "prevention_coordination_meetings_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_coordination_participants" ADD CONSTRAINT "prevention_coordination_participants_meeting_id_prevention_coordination_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."prevention_coordination_meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_coordination_participants" ADD CONSTRAINT "prevention_coordination_participants_contract_id_prevention_contractor_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."prevention_contractor_contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "prevention_accreditation_item_unique" ON "prevention_accreditation_items" USING btree ("requirement_id","contract_id","contractor_worker_id");--> statement-breakpoint
CREATE INDEX "prevention_accreditation_item_contract_idx" ON "prevention_accreditation_items" USING btree ("contract_id","status");--> statement-breakpoint
CREATE INDEX "prevention_accreditation_item_expiry_idx" ON "prevention_accreditation_items" USING btree ("expires_on","status");--> statement-breakpoint
CREATE INDEX "prevention_accreditation_requirement_scope_idx" ON "prevention_accreditation_requirements" USING btree ("applies_to","is_active");--> statement-breakpoint
CREATE INDEX "prevention_contractor_company_active_idx" ON "prevention_contractor_companies" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "prevention_contractor_contract_worksite_idx" ON "prevention_contractor_contracts" USING btree ("worksite_id","status");--> statement-breakpoint
CREATE INDEX "prevention_contractor_contract_company_idx" ON "prevention_contractor_contracts" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "prevention_contractor_history_entity_idx" ON "prevention_contractor_history" USING btree ("entity_type","entity_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "prevention_contractor_worker_unique" ON "prevention_contractor_workers" USING btree ("contract_id","rut");--> statement-breakpoint
CREATE INDEX "prevention_contractor_worker_status_idx" ON "prevention_contractor_workers" USING btree ("contract_id","status");--> statement-breakpoint
CREATE INDEX "prevention_coordination_meeting_worksite_idx" ON "prevention_coordination_meetings" USING btree ("worksite_id","held_at");--> statement-breakpoint
CREATE UNIQUE INDEX "prevention_coordination_participant_unique" ON "prevention_coordination_participants" USING btree ("meeting_id","contract_id");--> statement-breakpoint
ALTER TABLE "prevention_capa_actions" ADD CONSTRAINT "prevention_capa_source_type_valid" CHECK ("prevention_capa_actions"."source_type" IN ('pdtp', 'sst_evaluation', 'ppa', 'incident', 'risk', 'legal_requirement', 'training', 'contractor', 'manual'));