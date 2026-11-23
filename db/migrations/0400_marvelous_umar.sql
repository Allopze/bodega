CREATE TABLE "pwa_devices" (
	"app" text NOT NULL,
	"device_id" text NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"version" text NOT NULL,
	"built_at" timestamp with time zone,
	"installed" boolean NOT NULL,
	"platform" text NOT NULL,
	"pending_count" integer DEFAULT 0 NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"oldest_pending_at" timestamp with time zone,
	"last_attempt_at" timestamp with time zone,
	"last_error" text,
	"last_error_at" timestamp with time zone,
	"user_id" text,
	"worksite_id" text,
	"tae_link_id" text,
	CONSTRAINT "pwa_devices_app_device_id_pk" PRIMARY KEY("app","device_id"),
	CONSTRAINT "pwa_devices_app_valid" CHECK ("pwa_devices"."app" IN ('ppa', 'mantencion', 'tae')),
	CONSTRAINT "pwa_devices_counts_valid" CHECK ("pwa_devices"."pending_count" >= 0 AND "pwa_devices"."failed_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "pwa_devices" ADD CONSTRAINT "pwa_devices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pwa_devices" ADD CONSTRAINT "pwa_devices_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pwa_devices" ADD CONSTRAINT "pwa_devices_tae_link_id_fuel_tae_public_links_id_fk" FOREIGN KEY ("tae_link_id") REFERENCES "public"."fuel_tae_public_links"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pwa_devices_app_last_seen_idx" ON "pwa_devices" USING btree ("app","last_seen_at");