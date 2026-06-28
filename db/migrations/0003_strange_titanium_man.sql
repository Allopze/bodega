ALTER TABLE "fuel_loads" DROP CONSTRAINT "fuel_loads_cost_center_id_cost_centers_id_fk";
--> statement-breakpoint
DROP INDEX "fuel_loads_cost_center_idx";--> statement-breakpoint
ALTER TABLE "fuel_loads" DROP COLUMN "cost_center_id";