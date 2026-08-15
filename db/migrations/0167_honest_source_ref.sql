ALTER TABLE "prevention_capa_actions" RENAME COLUMN "source_legacy_action_id" TO "source_item_id";--> statement-breakpoint
ALTER TABLE "prevention_capa_actions" RENAME COLUMN "legacy_snapshot" TO "source_ref";--> statement-breakpoint
ALTER INDEX "prevention_capa_legacy_source_unique" RENAME TO "prevention_capa_source_item_unique";--> statement-breakpoint
DROP INDEX "prevention_capa_sst_evaluation_n_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "prevention_capa_sst_evaluation_n_unique" ON "prevention_capa_actions" USING btree ("source_id",(("source_ref"->>'n')::int)) WHERE "prevention_capa_actions"."source_type" = 'sst_evaluation';
