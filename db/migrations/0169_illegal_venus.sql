CREATE TABLE "prevention_external_engagement_history" (
	"id" text PRIMARY KEY NOT NULL,
	"engagement_id" text NOT NULL,
	"worksite_id" text NOT NULL,
	"change_type" text NOT NULL,
	"reason" text,
	"before_state" jsonb,
	"after_state" jsonb,
	"actor_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prevention_external_engagements" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"worksite_id" text NOT NULL,
	"kind" text NOT NULL,
	"direction" text DEFAULT 'received' NOT NULL,
	"counterparty_type" text NOT NULL,
	"counterparty_name" text NOT NULL,
	"counterparty_rut" text,
	"occurred_on" text NOT NULL,
	"subject" text NOT NULL,
	"summary" text,
	"outcome" text,
	"official_reference" text,
	"info_types" jsonb,
	"closed_at" timestamp with time zone,
	"closed_by_user_id" text,
	"created_by_user_id" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prevention_external_engagements_code_unique" UNIQUE("code"),
	CONSTRAINT "prevention_external_engagement_kind_valid" CHECK ("prevention_external_engagements"."kind" IN ('coordinacion', 'fiscalizacion', 'organismo_administrador')),
	CONSTRAINT "prevention_external_engagement_direction_valid" CHECK ("prevention_external_engagements"."direction" IN ('received', 'delivered')),
	CONSTRAINT "prevention_external_engagement_direction_consistent" CHECK ("prevention_external_engagements"."kind" = 'coordinacion' OR "prevention_external_engagements"."direction" = 'received'),
	CONSTRAINT "prevention_external_engagement_counterparty_valid" CHECK ("prevention_external_engagements"."counterparty_type" IN ('mandante', 'contratista', 'subcontratista', 'otra_empresa_faena', 'direccion_trabajo', 'seremi_salud', 'organismo_administrador', 'otro')),
	CONSTRAINT "prevention_external_engagement_reference_required" CHECK ("prevention_external_engagements"."kind" = 'coordinacion' OR length(trim(COALESCE("prevention_external_engagements"."official_reference", ''))) >= 3),
	CONSTRAINT "prevention_external_engagement_closed_consistent" CHECK (("prevention_external_engagements"."closed_at" IS NULL AND "prevention_external_engagements"."closed_by_user_id" IS NULL) OR ("prevention_external_engagements"."closed_at" IS NOT NULL AND "prevention_external_engagements"."closed_by_user_id" IS NOT NULL)),
	CONSTRAINT "prevention_external_engagement_version_positive" CHECK ("prevention_external_engagements"."version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "sst_document_links" DROP CONSTRAINT "sst_document_links_entity_type_valid";--> statement-breakpoint
ALTER TABLE "prevention_capa_actions" DROP CONSTRAINT "prevention_capa_source_type_valid";--> statement-breakpoint
ALTER TABLE "prevention_external_engagement_history" ADD CONSTRAINT "prevention_external_engagement_history_engagement_id_prevention_external_engagements_id_fk" FOREIGN KEY ("engagement_id") REFERENCES "public"."prevention_external_engagements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_external_engagement_history" ADD CONSTRAINT "prevention_external_engagement_history_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_external_engagement_history" ADD CONSTRAINT "prevention_external_engagement_history_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_external_engagements" ADD CONSTRAINT "prevention_external_engagements_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_external_engagements" ADD CONSTRAINT "prevention_external_engagements_closed_by_user_id_users_id_fk" FOREIGN KEY ("closed_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_external_engagements" ADD CONSTRAINT "prevention_external_engagements_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "prevention_external_engagement_history_idx" ON "prevention_external_engagement_history" USING btree ("engagement_id","created_at");--> statement-breakpoint
CREATE INDEX "prevention_external_engagement_worksite_idx" ON "prevention_external_engagements" USING btree ("worksite_id","occurred_on");--> statement-breakpoint
CREATE INDEX "prevention_external_engagement_kind_idx" ON "prevention_external_engagements" USING btree ("kind","occurred_on");--> statement-breakpoint
ALTER TABLE "sst_document_links" ADD CONSTRAINT "sst_document_links_entity_type_valid" CHECK ("sst_document_links"."entity_type" IN ('worker', 'worksite', 'vehicle', 'equipment', 'incident', 'training', 'committee', 'epp_delivery', 'corrective_action', 'emergency_plan', 'pdtp_activity', 'pdtp_execution', 'pdtp_checklist', 'sst_evaluation', 'ppa', 'external_engagement'));--> statement-breakpoint
ALTER TABLE "prevention_capa_actions" ADD CONSTRAINT "prevention_capa_source_type_valid" CHECK ("prevention_capa_actions"."source_type" IN ('pdtp', 'sst_evaluation', 'ppa', 'incident', 'risk', 'legal_requirement', 'training', 'work_permit', 'inspection', 'cphs', 'emergency', 'change', 'epp', 'external_engagement', 'manual'));