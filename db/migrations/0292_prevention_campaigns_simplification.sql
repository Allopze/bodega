ALTER TABLE "prevention_campaign_attendance" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE IF EXISTS "prevention_campaign_attendance" CASCADE;--> statement-breakpoint
ALTER TABLE "prevention_campaigns" DROP CONSTRAINT IF EXISTS "prevention_campaign_status_check";--> statement-breakpoint
-- Colapsa el ciclo de vida de 4 estados al nuevo de 2. `draft`/`active` no
-- tenían evidencia ni fecha de cierre, así que caen directo a `pending`.
-- `completed` cae a `done` (ya trae completed_at/evidence_url). `cancelled`
-- no tiene equivalente en el nuevo modelo —no hay registro real en ningún
-- ambiente al momento de esta migración— y cae a `pending`: una campaña
-- cancelada vuelve a ser trabajo por hacer o por descartar a mano, en vez de
-- inventar un tercer estado para un caso sin datos.
UPDATE "prevention_campaigns" SET "status" = 'pending' WHERE "status" IN ('draft', 'active', 'cancelled');--> statement-breakpoint
UPDATE "prevention_campaigns" SET "status" = 'done' WHERE "status" = 'completed';--> statement-breakpoint
ALTER TABLE "prevention_campaigns" ALTER COLUMN "status" SET DEFAULT 'pending';--> statement-breakpoint
ALTER TABLE "prevention_campaigns" DROP COLUMN IF EXISTS "started_at";--> statement-breakpoint
ALTER TABLE "prevention_campaigns" ADD CONSTRAINT "prevention_campaign_done_consistent" CHECK (
    ("prevention_campaigns"."status" = 'pending' AND "prevention_campaigns"."completed_at" IS NULL AND "prevention_campaigns"."evidence_url" IS NULL)
    OR ("prevention_campaigns"."status" = 'done' AND "prevention_campaigns"."completed_at" IS NOT NULL AND "prevention_campaigns"."evidence_url" IS NOT NULL)
  );--> statement-breakpoint
ALTER TABLE "prevention_campaigns" ADD CONSTRAINT "prevention_campaign_status_check" CHECK ("prevention_campaigns"."status" IN ('pending', 'done'));