-- Las columnas NOT NULL sin default de abajo (evidence_url en comité,
-- coordinador y acta; held_on en acta) asumen que las tablas están vacías:
-- confirmado contra bodega_dev al escribir esta migración (0 filas en las 7
-- tablas de CGRD — módulo sin uso real, sin acceso desde el menú principal
-- antes de esta simplificación). Si algún otro ambiente tiene filas, esta
-- migración fallará explícitamente en vez de truncar datos en silencio.
ALTER TABLE "prevention_grd_matrices" DROP CONSTRAINT IF EXISTS "prevention_grd_matrices_publish_evidence";--> statement-breakpoint
DROP INDEX IF EXISTS "prevention_grd_meeting_committee_idx";--> statement-breakpoint
ALTER TABLE "prevention_grd_meetings" ALTER COLUMN "minutes" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "prevention_grd_committees" ADD COLUMN "evidence_url" text NOT NULL;--> statement-breakpoint
ALTER TABLE "prevention_grd_coordinators" ADD COLUMN "evidence_url" text NOT NULL;--> statement-breakpoint
ALTER TABLE "prevention_grd_matrices" ADD COLUMN "evidence_url" text;--> statement-breakpoint
ALTER TABLE "prevention_grd_meetings" ADD COLUMN "held_on" timestamp with time zone NOT NULL;--> statement-breakpoint
ALTER TABLE "prevention_grd_meetings" ADD COLUMN "evidence_url" text NOT NULL;--> statement-breakpoint
CREATE INDEX "prevention_grd_meeting_committee_idx" ON "prevention_grd_meetings" USING btree ("committee_id","held_on");--> statement-breakpoint
ALTER TABLE "prevention_grd_matrices" ADD CONSTRAINT "prevention_grd_matrices_publish_evidence" CHECK ("prevention_grd_matrices"."status" = 'draft' OR ("prevention_grd_matrices"."published_by_user_id" IS NOT NULL AND "prevention_grd_matrices"."published_at" IS NOT NULL AND "prevention_grd_matrices"."evidence_url" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "prevention_grd_meetings" ADD CONSTRAINT "prevention_grd_meeting_minutes_valid" CHECK (length("prevention_grd_meetings"."minutes") >= 20);