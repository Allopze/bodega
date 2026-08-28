CREATE TABLE "fleet_gps_alert_types" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text DEFAULT 'onway' NOT NULL,
	"alert_type" text NOT NULL,
	"latest_title" text NOT NULL,
	"first_seen_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fleet_gps_alert_types_provider_valid" CHECK ("fleet_gps_alert_types"."provider" IN ('onway'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "fleet_gps_alert_types_external_unique" ON "fleet_gps_alert_types" USING btree ("provider","alert_type");