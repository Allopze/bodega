CREATE TABLE "prevention_hygiene_measurement_slots" (
	"id" text PRIMARY KEY NOT NULL,
	"worksite_id" text NOT NULL,
	"year" integer NOT NULL,
	"slot_key" text NOT NULL,
	"scheduled_month" integer NOT NULL,
	"scheduled_week" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"measurement_id" text,
	"completed_at" timestamp with time zone,
	"completed_by_user_id" text,
	"not_applicable_at" timestamp with time zone,
	"not_applicable_by_user_id" text,
	"not_applicable_reason" text,
	"observation" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prevention_hygiene_measurement_slot_year_check" CHECK ("prevention_hygiene_measurement_slots"."year" BETWEEN 2020 AND 2100),
	CONSTRAINT "prevention_hygiene_measurement_slot_status_check" CHECK ("prevention_hygiene_measurement_slots"."status" IN ('pending', 'completed', 'not_completed', 'not_applicable')),
	CONSTRAINT "prevention_hygiene_measurement_slot_period_check" CHECK ("prevention_hygiene_measurement_slots"."scheduled_month" BETWEEN 1 AND 12 AND "prevention_hygiene_measurement_slots"."scheduled_week" BETWEEN 1 AND 4),
	CONSTRAINT "prevention_hygiene_measurement_slot_done_check" CHECK (("prevention_hygiene_measurement_slots"."status" = 'completed' AND "prevention_hygiene_measurement_slots"."measurement_id" IS NOT NULL AND "prevention_hygiene_measurement_slots"."completed_at" IS NOT NULL AND "prevention_hygiene_measurement_slots"."completed_by_user_id" IS NOT NULL) OR ("prevention_hygiene_measurement_slots"."status" <> 'completed' AND "prevention_hygiene_measurement_slots"."completed_at" IS NULL AND "prevention_hygiene_measurement_slots"."completed_by_user_id" IS NULL)),
	CONSTRAINT "prevention_hygiene_measurement_slot_na_check" CHECK (("prevention_hygiene_measurement_slots"."status" = 'not_applicable' AND "prevention_hygiene_measurement_slots"."not_applicable_at" IS NOT NULL AND "prevention_hygiene_measurement_slots"."not_applicable_by_user_id" IS NOT NULL AND length(trim(COALESCE("prevention_hygiene_measurement_slots"."not_applicable_reason", ''))) >= 10) OR ("prevention_hygiene_measurement_slots"."status" <> 'not_applicable' AND "prevention_hygiene_measurement_slots"."not_applicable_at" IS NULL AND "prevention_hygiene_measurement_slots"."not_applicable_by_user_id" IS NULL AND "prevention_hygiene_measurement_slots"."not_applicable_reason" IS NULL)),
	CONSTRAINT "prevention_hygiene_measurement_slot_version_check" CHECK ("prevention_hygiene_measurement_slots"."version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "prevention_surveillance_enrollments" ADD COLUMN "renewed_from_enrollment_id" text;--> statement-breakpoint
ALTER TABLE "prevention_hygiene_measurement_slots" ADD CONSTRAINT "hygiene_meas_slot_worksite_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_hygiene_measurement_slots" ADD CONSTRAINT "hygiene_meas_slot_measurement_fk" FOREIGN KEY ("measurement_id") REFERENCES "public"."prevention_exposure_measurements"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_hygiene_measurement_slots" ADD CONSTRAINT "hygiene_meas_slot_completer_fk" FOREIGN KEY ("completed_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_hygiene_measurement_slots" ADD CONSTRAINT "hygiene_meas_slot_na_actor_fk" FOREIGN KEY ("not_applicable_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "prevention_hygiene_measurement_slot_unique" ON "prevention_hygiene_measurement_slots" USING btree ("worksite_id","year","slot_key");--> statement-breakpoint
CREATE INDEX "prevention_hygiene_measurement_slot_period_idx" ON "prevention_hygiene_measurement_slots" USING btree ("worksite_id","year","status");--> statement-breakpoint
ALTER TABLE "prevention_surveillance_enrollments" ADD CONSTRAINT "surveillance_enrollment_renewed_from_fk" FOREIGN KEY ("renewed_from_enrollment_id") REFERENCES "public"."prevention_surveillance_enrollments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "prevention_surveillance_enrollment_renewed_from_idx" ON "prevention_surveillance_enrollments" USING btree ("renewed_from_enrollment_id");--> statement-breakpoint
-- N°50: la exención de un control de vigilancia pasa a exigir motivo (≥10, el
-- umbral de `lib/validation/reason-thresholds.ts`); el CHECK llega en la
-- migración siguiente. Hasta hoy `recordSurveillanceOutcome` forzaba el motivo
-- a NULL al eximir, así que toda exención previa quedó sin él y el CHECK
-- rechazaría la migración. No hay a quién preguntarle el motivo: se marcan con
-- su procedencia en vez de inventarles uno, igual que CAPA-002 (0284).
-- Idempotente: sólo toca las exenciones que siguen sin un motivo válido.
UPDATE "prevention_surveillance_enrollments"
   SET "absence_reason" = 'Exención registrada antes de exigir motivo: no consta por qué se eximió.'
 WHERE "status" = 'exempt'
   AND length(trim(COALESCE("absence_reason", ''))) < 10;
