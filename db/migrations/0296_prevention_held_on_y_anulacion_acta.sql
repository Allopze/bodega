ALTER TABLE "prevention_campaigns" DROP CONSTRAINT IF EXISTS "prevention_campaign_done_consistent";--> statement-breakpoint
ALTER TABLE "prevention_campaigns" ADD COLUMN "held_on" text;--> statement-breakpoint
-- Backfill de las campañas ya marcadas hechas: no sabemos cuándo se hicieron
-- —ese dato no existía—, y lo único que consta es cuándo se registraron. Se
-- usa la fecha civil de `completed_at` en Chile, que es exactamente la
-- aproximación que el modelo anterior asumía al acreditar con `now()`. No se
-- inventa nada: queda igual de preciso que antes, y de aquí en adelante la
-- fecha la declara quien marca la campaña.
UPDATE "prevention_campaigns"
SET "held_on" = to_char("completed_at" AT TIME ZONE 'America/Santiago', 'YYYY-MM-DD')
WHERE "status" = 'done' AND "held_on" IS NULL AND "completed_at" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "prevention_grd_meetings" ADD COLUMN "annulled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "prevention_grd_meetings" ADD COLUMN "annulled_by_user_id" text;--> statement-breakpoint
ALTER TABLE "prevention_grd_meetings" ADD COLUMN "annulled_reason" text;--> statement-breakpoint
ALTER TABLE "prevention_grd_meetings" ADD CONSTRAINT "prevention_grd_meetings_annulled_by_user_id_users_id_fk" FOREIGN KEY ("annulled_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_campaigns" ADD CONSTRAINT "prevention_campaign_done_consistent" CHECK (
    ("prevention_campaigns"."status" = 'pending' AND "prevention_campaigns"."completed_at" IS NULL AND "prevention_campaigns"."completed_by_user_id" IS NULL AND "prevention_campaigns"."evidence_url" IS NULL AND "prevention_campaigns"."held_on" IS NULL)
    OR ("prevention_campaigns"."status" = 'done' AND "prevention_campaigns"."completed_at" IS NOT NULL AND "prevention_campaigns"."completed_by_user_id" IS NOT NULL AND "prevention_campaigns"."evidence_url" IS NOT NULL AND "prevention_campaigns"."held_on" IS NOT NULL)
  );--> statement-breakpoint
ALTER TABLE "prevention_grd_meetings" ADD CONSTRAINT "prevention_grd_meeting_annulled_consistent" CHECK (
    ("prevention_grd_meetings"."annulled_at" IS NULL AND "prevention_grd_meetings"."annulled_by_user_id" IS NULL AND "prevention_grd_meetings"."annulled_reason" IS NULL)
    OR ("prevention_grd_meetings"."annulled_at" IS NOT NULL AND "prevention_grd_meetings"."annulled_by_user_id" IS NOT NULL AND length("prevention_grd_meetings"."annulled_reason") >= 10)
  );