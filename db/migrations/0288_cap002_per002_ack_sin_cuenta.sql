-- CAP-002 / PER-002 (auditoría 2026-09-14): el acuse de una capacitación y el
-- del AST de un permiso exigían cuenta de usuario. Se habilita la vía sin
-- cuenta (enlace con token, el patrón de PPA/TAE) y se declara por qué canal
-- llegó cada acuse, para que un auditor pueda distinguirlos sin adivinar.
ALTER TABLE "prevention_training_attendance"
  ADD COLUMN IF NOT EXISTS "acknowledgement_channel" text;
--> statement-breakpoint
UPDATE "prevention_training_attendance"
   SET "acknowledgement_channel" = 'account'
 WHERE "acknowledged_at" IS NOT NULL AND "acknowledgement_channel" IS NULL;
--> statement-breakpoint
ALTER TABLE "prevention_training_attendance"
  ADD CONSTRAINT "prevention_training_attendance_ack_channel_valid"
  CHECK (
    ("acknowledged_at" IS NULL AND "acknowledgement_channel" IS NULL)
    OR ("acknowledged_at" IS NOT NULL AND "acknowledgement_channel" IN ('account', 'public_token'))
  );
--> statement-breakpoint
ALTER TABLE "prevention_permit_crew"
  ADD COLUMN IF NOT EXISTS "acknowledgement_channel" text;
--> statement-breakpoint
ALTER TABLE "prevention_permit_crew"
  ADD COLUMN IF NOT EXISTS "acknowledgement_ip" text;
--> statement-breakpoint
ALTER TABLE "prevention_permit_crew"
  ADD COLUMN IF NOT EXISTS "acknowledgement_user_agent" text;
--> statement-breakpoint
UPDATE "prevention_permit_crew"
   SET "acknowledgement_channel" = 'account'
 WHERE "acknowledged_at" IS NOT NULL AND "acknowledgement_channel" IS NULL;
--> statement-breakpoint
ALTER TABLE "prevention_permit_crew"
  ADD CONSTRAINT "prevention_permit_crew_ack_channel_valid"
  CHECK (
    ("acknowledged_at" IS NULL AND "acknowledgement_channel" IS NULL)
    OR ("acknowledged_at" IS NOT NULL AND "acknowledgement_channel" IN ('account', 'public_token'))
  );
