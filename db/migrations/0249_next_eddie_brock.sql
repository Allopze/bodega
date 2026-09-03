CREATE TABLE "prevention_grd_coordinators" (
	"id" text PRIMARY KEY NOT NULL,
	"worksite_id" text NOT NULL,
	"worker_id" text NOT NULL,
	"designated_on" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"ended_reason" text,
	"ended_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prevention_grd_coordinator_status_valid" CHECK ("prevention_grd_coordinators"."status" IN ('active', 'ended')),
	CONSTRAINT "prevention_grd_coordinator_end_consistent" CHECK (("prevention_grd_coordinators"."ended_at" IS NULL AND "prevention_grd_coordinators"."ended_reason" IS NULL) OR ("prevention_grd_coordinators"."ended_at" IS NOT NULL AND length("prevention_grd_coordinators"."ended_reason") >= 10)),
	CONSTRAINT "prevention_grd_coordinator_version_positive" CHECK ("prevention_grd_coordinators"."version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "prevention_grd_coordinators" ADD CONSTRAINT "prevention_grd_coordinators_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_grd_coordinators" ADD CONSTRAINT "prevention_grd_coordinators_worker_id_workers_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_grd_coordinators" ADD CONSTRAINT "prevention_grd_coordinators_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "prevention_grd_coordinator_active_unique" ON "prevention_grd_coordinators" USING btree ("worksite_id") WHERE "prevention_grd_coordinators"."status" = 'active';