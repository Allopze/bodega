ALTER TABLE "fuel_anomaly_executions" ADD COLUMN "truncated" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "fuel_anomaly_executions" ADD COLUMN "cases_failed" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "fuel_anomaly_rules" ADD COLUMN "cursor" text;