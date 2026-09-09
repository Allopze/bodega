ALTER TABLE "operational_integrity_case_events" DROP CONSTRAINT "operational_integrity_case_events_observation_id_operational_in";
--> statement-breakpoint
CREATE UNIQUE INDEX "operational_integrity_observations_case_id_key" ON "operational_integrity_observations" USING btree ("case_id","id");--> statement-breakpoint
ALTER TABLE "operational_integrity_case_events" ADD CONSTRAINT "operational_integrity_case_events_case_observation_fk" FOREIGN KEY ("case_id","observation_id") REFERENCES "public"."operational_integrity_observations"("case_id","id") ON DELETE cascade ON UPDATE no action;
