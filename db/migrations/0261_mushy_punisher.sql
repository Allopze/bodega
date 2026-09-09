ALTER TABLE "backup_log" ADD COLUMN "cloudreve_path" text;--> statement-breakpoint
ALTER TABLE "backup_log" ADD COLUMN "cloudreve_uploaded" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "backup_settings" ADD COLUMN "drive_backups_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "backup_settings" ADD COLUMN "cloudreve_backups_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "backup_settings" ADD COLUMN "cloudreve_backups_path" text DEFAULT 'backups/plataforma' NOT NULL;