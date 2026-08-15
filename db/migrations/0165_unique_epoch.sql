DROP TABLE "sst_action_plan" CASCADE;--> statement-breakpoint
DROP TABLE "ppa_corrective_actions" CASCADE;--> statement-breakpoint
CREATE UNIQUE INDEX "prevention_capa_sst_evaluation_n_unique" ON "prevention_capa_actions" USING btree ("source_id",(("legacy_snapshot"->>'n')::int)) WHERE "prevention_capa_actions"."source_type" = 'sst_evaluation';
