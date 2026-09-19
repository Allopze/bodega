ALTER TABLE "pdtp_trigger_events" DROP CONSTRAINT IF EXISTS "pdtp_trigger_events_worksite_id_worksites_id_fk";
--> statement-breakpoint
ALTER TABLE "pdtp_trigger_events" ADD CONSTRAINT "pdtp_trigger_events_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE cascade ON UPDATE no action;
