ALTER TABLE "prevention_campaigns" DROP CONSTRAINT IF EXISTS "prevention_campaign_done_consistent";--> statement-breakpoint
ALTER TABLE "prevention_campaigns" ADD COLUMN "completed_by_user_id" text;--> statement-breakpoint
-- Respaldo defensivo: si alguna campaña quedó `done` desde la migración
-- anterior (la conversión de `completed`) sin quien la cerró, se atribuye a
-- quien la creó en vez de dejar una fila que ninguna constraint puede
-- aceptar. No se observó ningún caso así en bodega_dev al escribir esta
-- migración (0 filas `completed`), pero la migración no debe asumirlo de
-- otros ambientes.
UPDATE "prevention_campaigns" SET "completed_by_user_id" = "created_by_user_id" WHERE "status" = 'done' AND "completed_by_user_id" IS NULL;--> statement-breakpoint
ALTER TABLE "prevention_campaigns" ADD CONSTRAINT "prevention_campaigns_completed_by_user_id_users_id_fk" FOREIGN KEY ("completed_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_campaigns" ADD CONSTRAINT "prevention_campaign_done_consistent" CHECK (
    ("prevention_campaigns"."status" = 'pending' AND "prevention_campaigns"."completed_at" IS NULL AND "prevention_campaigns"."completed_by_user_id" IS NULL AND "prevention_campaigns"."evidence_url" IS NULL)
    OR ("prevention_campaigns"."status" = 'done' AND "prevention_campaigns"."completed_at" IS NOT NULL AND "prevention_campaigns"."completed_by_user_id" IS NOT NULL AND "prevention_campaigns"."evidence_url" IS NOT NULL)
  );