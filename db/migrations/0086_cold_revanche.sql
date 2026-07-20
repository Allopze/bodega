ALTER TABLE "prevention_accreditation_items" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "prevention_accreditation_requirements" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "prevention_contractor_companies" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "prevention_contractor_contracts" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "prevention_contractor_history" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "prevention_contractor_workers" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "prevention_coordination_meetings" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "prevention_coordination_participants" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "prevention_accreditation_items" CASCADE;--> statement-breakpoint
DROP TABLE "prevention_accreditation_requirements" CASCADE;--> statement-breakpoint
DROP TABLE "prevention_contractor_companies" CASCADE;--> statement-breakpoint
DROP TABLE "prevention_contractor_contracts" CASCADE;--> statement-breakpoint
DROP TABLE "prevention_contractor_history" CASCADE;--> statement-breakpoint
DROP TABLE "prevention_contractor_workers" CASCADE;--> statement-breakpoint
DROP TABLE "prevention_coordination_meetings" CASCADE;--> statement-breakpoint
DROP TABLE "prevention_coordination_participants" CASCADE;--> statement-breakpoint
ALTER TABLE "prevention_capa_actions" DROP CONSTRAINT "prevention_capa_source_type_valid";--> statement-breakpoint
ALTER TABLE "prevention_permit_crew" DROP CONSTRAINT "prevention_permit_crew_one_identity";--> statement-breakpoint
-- SQL manual: `IF EXISTS` agregado sobre lo generado.
-- El `DROP TABLE "prevention_contractor_workers" CASCADE` de más arriba YA
-- eliminó esta llave foránea, así que el DROP explícito que genera drizzle
-- aborta la migración con «constraint does not exist». Verificado contra
-- PostgreSQL real: sin esto, 0086 falla a mitad de camino y revierte.
ALTER TABLE "prevention_permit_crew" DROP CONSTRAINT IF EXISTS "prevention_permit_crew_contractor_worker_id_prevention_contractor_workers_id_fk";
--> statement-breakpoint
DROP INDEX IF EXISTS "prevention_permit_crew_contractor_unique";--> statement-breakpoint
-- SQL manual: sin esto la migración aborta a mitad de camino.
-- `DROP TABLE ... CASCADE` elimina la FK pero NO las filas de cuadrilla cuya
-- única identidad era un trabajador de contratista; ésas quedan con
-- `worker_id` nulo y hacen fallar el `SET NOT NULL` siguiente. Sólo se borran
-- las que quedaron sin identidad posible: una fila con `worker_id` sobrevive.
DELETE FROM "prevention_permit_crew" WHERE "worker_id" IS NULL;--> statement-breakpoint
ALTER TABLE "prevention_permit_crew" ALTER COLUMN "worker_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "prevention_permit_crew" DROP COLUMN "contractor_worker_id";--> statement-breakpoint
ALTER TABLE "prevention_capa_actions" ADD CONSTRAINT "prevention_capa_source_type_valid" CHECK ("prevention_capa_actions"."source_type" IN ('pdtp', 'sst_evaluation', 'ppa', 'incident', 'risk', 'legal_requirement', 'training', 'work_permit', 'inspection', 'cphs', 'manual'));