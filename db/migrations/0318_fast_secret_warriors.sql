DROP INDEX IF EXISTS "audit_log_entity_idx";--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "worksite_id" text;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_worksite_idx" ON "audit_log" USING btree ("worksite_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_log_entity_idx" ON "audit_log" USING btree ("entity_type","entity_id","created_at");