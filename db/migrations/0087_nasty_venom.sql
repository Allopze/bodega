CREATE TABLE "backup_settings" (
	"id" text PRIMARY KEY DEFAULT 'default' NOT NULL,
	"backup_hour" integer DEFAULT 3 NOT NULL,
	"retention_days" integer DEFAULT 30 NOT NULL,
	"max_age_hours" integer DEFAULT 36 NOT NULL,
	"manual_timeout_minutes" integer DEFAULT 30 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
