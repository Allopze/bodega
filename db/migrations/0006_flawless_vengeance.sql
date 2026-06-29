DELETE FROM "sst_action_plan" AS duplicate
USING "sst_action_plan" AS keeper
WHERE duplicate."evaluation_id" = keeper."evaluation_id"
  AND duplicate."n" = keeper."n"
  AND duplicate."id" > keeper."id";--> statement-breakpoint
DELETE FROM "sst_responses" AS duplicate
USING "sst_responses" AS keeper
WHERE duplicate."evaluation_id" = keeper."evaluation_id"
  AND duplicate."seccion_id" = keeper."seccion_id"
  AND duplicate."item_id" = keeper."item_id"
  AND duplicate."id" > keeper."id";--> statement-breakpoint
CREATE UNIQUE INDEX "sst_action_plan_evaluation_n_unique" ON "sst_action_plan" USING btree ("evaluation_id","n");--> statement-breakpoint
CREATE UNIQUE INDEX "sst_responses_evaluation_section_item_unique" ON "sst_responses" USING btree ("evaluation_id","seccion_id","item_id");
