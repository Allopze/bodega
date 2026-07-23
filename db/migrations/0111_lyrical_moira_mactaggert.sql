CREATE TABLE "prevention_campaign_attendance" (
	"id" text PRIMARY KEY NOT NULL,
	"campaign_id" text NOT NULL,
	"worker_id" text NOT NULL,
	"attended_at" timestamp with time zone DEFAULT now() NOT NULL,
	"evidence_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prevention_campaigns" (
	"id" text PRIMARY KEY NOT NULL,
	"worksite_id" text NOT NULL,
	"code" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"pdtp_activity_numbers" jsonb DEFAULT '[85]'::jsonb NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"evidence_url" text,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prevention_campaigns_code_unique" UNIQUE("code"),
	CONSTRAINT "prevention_campaign_status_check" CHECK ("prevention_campaigns"."status" IN ('draft', 'active', 'completed', 'cancelled'))
);
--> statement-breakpoint
ALTER TABLE "prevention_campaign_attendance" ADD CONSTRAINT "prevention_campaign_attendance_campaign_id_prevention_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."prevention_campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_campaign_attendance" ADD CONSTRAINT "prevention_campaign_attendance_worker_id_workers_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_campaigns" ADD CONSTRAINT "prevention_campaigns_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_campaigns" ADD CONSTRAINT "prevention_campaigns_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "prevention_campaign_attendance_unique" ON "prevention_campaign_attendance" USING btree ("campaign_id","worker_id");--> statement-breakpoint
CREATE INDEX "prevention_campaign_attendance_campaign_idx" ON "prevention_campaign_attendance" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "prevention_campaign_worksite_idx" ON "prevention_campaigns" USING btree ("worksite_id","status");