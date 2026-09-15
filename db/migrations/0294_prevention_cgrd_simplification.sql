ALTER TABLE "prevention_grd_matrices" DROP CONSTRAINT IF EXISTS "prevention_grd_matrices_status_valid";--> statement-breakpoint
ALTER TABLE "prevention_grd_matrices" DROP CONSTRAINT IF EXISTS "prevention_grd_matrices_publish_evidence";--> statement-breakpoint
ALTER TABLE "prevention_grd_meetings" DROP CONSTRAINT IF EXISTS "prevention_grd_meeting_status_valid";--> statement-breakpoint
ALTER TABLE "prevention_grd_meetings" DROP CONSTRAINT IF EXISTS "prevention_grd_meeting_closed_has_minutes";--> statement-breakpoint
ALTER TABLE "prevention_grd_meetings" DROP CONSTRAINT IF EXISTS "prevention_grd_meeting_cancel_consistent";--> statement-breakpoint
ALTER TABLE "prevention_grd_meetings" DROP CONSTRAINT IF EXISTS "prevention_grd_meeting_version_positive";--> statement-breakpoint
ALTER TABLE "prevention_grd_matrices" DROP CONSTRAINT IF EXISTS "prevention_grd_matrices_reviewed_by_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "prevention_grd_matrices" DROP CONSTRAINT IF EXISTS "prevention_grd_matrices_approved_by_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "prevention_grd_meetings" DROP CONSTRAINT IF EXISTS "prevention_grd_meetings_closed_by_user_id_users_id_fk";
--> statement-breakpoint
DROP INDEX IF EXISTS "prevention_grd_meeting_committee_idx";--> statement-breakpoint
CREATE INDEX "prevention_grd_meeting_committee_idx" ON "prevention_grd_meetings" USING btree ("committee_id");--> statement-breakpoint
ALTER TABLE "prevention_grd_matrices" DROP COLUMN IF EXISTS "published_hash_sha256";--> statement-breakpoint
ALTER TABLE "prevention_grd_matrices" DROP COLUMN IF EXISTS "reviewed_by_user_id";--> statement-breakpoint
ALTER TABLE "prevention_grd_matrices" DROP COLUMN IF EXISTS "reviewed_at";--> statement-breakpoint
ALTER TABLE "prevention_grd_matrices" DROP COLUMN IF EXISTS "approved_by_user_id";--> statement-breakpoint
ALTER TABLE "prevention_grd_matrices" DROP COLUMN IF EXISTS "approved_at";--> statement-breakpoint
ALTER TABLE "prevention_grd_meetings" DROP COLUMN IF EXISTS "scheduled_for";--> statement-breakpoint
ALTER TABLE "prevention_grd_meetings" DROP COLUMN IF EXISTS "status";--> statement-breakpoint
ALTER TABLE "prevention_grd_meetings" DROP COLUMN IF EXISTS "closed_by_user_id";--> statement-breakpoint
ALTER TABLE "prevention_grd_meetings" DROP COLUMN IF EXISTS "closed_at";--> statement-breakpoint
ALTER TABLE "prevention_grd_meetings" DROP COLUMN IF EXISTS "cancellation_reason";--> statement-breakpoint
ALTER TABLE "prevention_grd_meetings" DROP COLUMN IF EXISTS "version";--> statement-breakpoint
ALTER TABLE "prevention_grd_meetings" DROP COLUMN IF EXISTS "updated_at";--> statement-breakpoint
-- Colapsa el ciclo de 6 estados al nuevo de 3. `in_review`/`reviewed`/
-- `approved` no tienen equivalente en el modelo simplificado —no hay
-- registro real en ningún ambiente al momento de esta migración— y caen a
-- `draft`: una matriz a medio revisar vuelve a ser trabajo por completar y
-- publicar en un solo paso, en vez de inventar un estado intermedio para un
-- caso sin datos.
UPDATE "prevention_grd_matrices" SET "status" = 'draft' WHERE "status" NOT IN ('draft', 'published', 'superseded');--> statement-breakpoint
ALTER TABLE "prevention_grd_matrices" ADD CONSTRAINT "prevention_grd_matrices_status_valid" CHECK ("prevention_grd_matrices"."status" IN ('draft', 'published', 'superseded'));--> statement-breakpoint
ALTER TABLE "prevention_grd_matrices" ADD CONSTRAINT "prevention_grd_matrices_publish_evidence" CHECK ("prevention_grd_matrices"."status" = 'draft' OR ("prevention_grd_matrices"."published_by_user_id" IS NOT NULL AND "prevention_grd_matrices"."published_at" IS NOT NULL));