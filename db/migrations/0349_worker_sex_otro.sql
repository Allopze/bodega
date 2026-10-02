ALTER TABLE "workers" DROP CONSTRAINT IF EXISTS "workers_sex_valid";--> statement-breakpoint
ALTER TABLE "prevention_incident_people" DROP CONSTRAINT IF EXISTS "prevention_incident_person_sex_valid";--> statement-breakpoint
-- Catálogo nuevo: hombre / mujer / otro. Los datos se convierten entre el DROP
-- y el ADD porque ninguno de los dos check admite a la vez el valor viejo y el
-- nuevo. `unspecified` («No informa») pasa a NULL y no a 'other': 'other' es
-- un sexo declarado, y esa persona no declaró ninguno.
UPDATE "workers" SET "sex" = 'other' WHERE "sex" = 'intersex';--> statement-breakpoint
UPDATE "workers" SET "sex" = NULL WHERE "sex" = 'unspecified';--> statement-breakpoint
UPDATE "prevention_incident_people" SET "sex" = 'other' WHERE "sex" = 'intersex';--> statement-breakpoint
UPDATE "prevention_incident_people" SET "sex" = NULL WHERE "sex" = 'unspecified';--> statement-breakpoint
ALTER TABLE "workers" ADD CONSTRAINT "workers_sex_valid" CHECK ("workers"."sex" IS NULL OR "workers"."sex" IN ('male', 'female', 'other'));--> statement-breakpoint
ALTER TABLE "prevention_incident_people" ADD CONSTRAINT "prevention_incident_person_sex_valid" CHECK ("prevention_incident_people"."sex" IS NULL OR "prevention_incident_people"."sex" IN ('male', 'female', 'other'));
