CREATE TABLE "worker_driver_licenses" (
	"worker_id" text PRIMARY KEY NOT NULL,
	"classes" text[] NOT NULL,
	"expires_at" text,
	"notes" text,
	"updated_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "worker_driver_licenses_classes_valid" CHECK (cardinality("worker_driver_licenses"."classes") >= 1 AND "worker_driver_licenses"."classes" <@ ARRAY['A1','A2','A3','A4','A5','A1_ANTIGUA','A2_ANTIGUA','B','C','D','E','F']::text[]),
	CONSTRAINT "worker_driver_licenses_expires_valid" CHECK ("worker_driver_licenses"."expires_at" IS NULL OR "worker_driver_licenses"."expires_at" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
	CONSTRAINT "worker_driver_licenses_notes_valid" CHECK ("worker_driver_licenses"."notes" IS NULL OR length("worker_driver_licenses"."notes") <= 300)
);
--> statement-breakpoint
ALTER TABLE "worker_positions" ADD COLUMN "required_license_classes" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "worker_driver_licenses" ADD CONSTRAINT "worker_driver_licenses_worker_id_workers_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "worker_driver_licenses_expires_idx" ON "worker_driver_licenses" USING btree ("expires_at");--> statement-breakpoint
ALTER TABLE "worker_positions" ADD CONSTRAINT "worker_positions_required_license_classes_valid" CHECK ("worker_positions"."required_license_classes" <@ ARRAY['A1','A2','A3','A4','A5','A1_ANTIGUA','A2_ANTIGUA','B','C','D','E','F']::text[]);