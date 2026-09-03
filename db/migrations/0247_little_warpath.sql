CREATE TABLE "prevention_grd_agreements" (
	"id" text PRIMARY KEY NOT NULL,
	"meeting_id" text NOT NULL,
	"description" text NOT NULL,
	"capa_action_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prevention_grd_agreement_description_valid" CHECK (length("prevention_grd_agreements"."description") >= 5)
);
--> statement-breakpoint
ALTER TABLE "prevention_capa_actions" DROP CONSTRAINT "prevention_capa_source_type_valid";--> statement-breakpoint
ALTER TABLE "prevention_grd_agreements" ADD CONSTRAINT "prevention_grd_agreements_meeting_id_prevention_grd_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."prevention_grd_meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_grd_agreements" ADD CONSTRAINT "prevention_grd_agreements_capa_action_id_prevention_capa_actions_id_fk" FOREIGN KEY ("capa_action_id") REFERENCES "public"."prevention_capa_actions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "prevention_grd_agreement_meeting_idx" ON "prevention_grd_agreements" USING btree ("meeting_id");--> statement-breakpoint
ALTER TABLE "prevention_capa_actions" ADD CONSTRAINT "prevention_capa_source_type_valid" CHECK ("prevention_capa_actions"."source_type" IN ('pdtp', 'sst_evaluation', 'ppa', 'incident', 'risk', 'legal_requirement', 'training', 'work_permit', 'inspection', 'cphs', 'emergency', 'change', 'epp', 'external_engagement', 'cgrd', 'manual'));