ALTER TABLE "backup_log" DROP COLUMN IF EXISTS "drive_path";--> statement-breakpoint
ALTER TABLE "backup_log" DROP COLUMN IF EXISTS "drive_uploaded";--> statement-breakpoint
ALTER TABLE "backup_settings" DROP COLUMN IF EXISTS "drive_backups_enabled";