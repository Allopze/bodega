CREATE TABLE "prevention_incident_shift_diffusions" (
	"id" text PRIMARY KEY NOT NULL,
	"incident_id" text NOT NULL,
	"kind" text NOT NULL,
	"summary" text NOT NULL,
	"evidence_ref" text,
	"status" text DEFAULT 'pending_confirmation' NOT NULL,
	"marked_by_user_id" text NOT NULL,
	"marked_at" timestamp with time zone NOT NULL,
	"confirmed_by_user_id" text,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prevention_incident_shift_diffusion_kind_valid" CHECK ("prevention_incident_shift_diffusions"."kind" IN ('shift', 'corrective_measures')),
	CONSTRAINT "prevention_incident_shift_diffusion_status_valid" CHECK ("prevention_incident_shift_diffusions"."status" IN ('pending_confirmation', 'confirmed'))
);
--> statement-breakpoint
ALTER TABLE "prevention_incident_shift_diffusions" ADD CONSTRAINT "prevention_incident_shift_diffusions_incident_id_prevention_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."prevention_incidents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_incident_shift_diffusions" ADD CONSTRAINT "prevention_incident_shift_diffusions_marked_by_user_id_users_id_fk" FOREIGN KEY ("marked_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_incident_shift_diffusions" ADD CONSTRAINT "prevention_incident_shift_diffusions_confirmed_by_user_id_users_id_fk" FOREIGN KEY ("confirmed_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "prevention_incident_shift_diffusions_incident_idx" ON "prevention_incident_shift_diffusions" USING btree ("incident_id");