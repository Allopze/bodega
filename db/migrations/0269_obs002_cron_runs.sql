-- OBS-002 (auditoría 2026-09-14): bitácora transversal de corridas de cron.
-- Diecinueve de los veintiséis crones no dejaban rastro de haber corrido, y
-- varios son el único mecanismo que hace visible un vencimiento.
CREATE TABLE IF NOT EXISTS "cron_runs" (
  "id"          text PRIMARY KEY NOT NULL,
  "job_name"    text NOT NULL,
  "started_at"  timestamp with time zone DEFAULT now() NOT NULL,
  "finished_at" timestamp with time zone,
  "outcome"     text DEFAULT 'running' NOT NULL,
  "duration_ms" integer,
  "detail"      text,
  CONSTRAINT "cron_runs_outcome_valid"
    CHECK ("outcome" IN ('running', 'success', 'skipped', 'failed'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cron_runs_job_started_idx" ON "cron_runs" ("job_name","started_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cron_runs_started_idx" ON "cron_runs" ("started_at");
