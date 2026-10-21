-- Retira el binario legado de los anexos RE-20 (base64 en Postgres). Sólo es
-- seguro cuando todos los anexos ya viven en disco: si queda uno sin trasladar,
-- la migración se detiene antes de borrar nada.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "prevention_incident_re20_attachments" WHERE "sensitive_file_id" IS NULL) THEN
    RAISE EXCEPTION 'Hay anexos RE-20 sin trasladar a disco (sensitive_file_id NULL): no se borran las columnas legadas.';
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "prevention_incident_re20_attachments" DROP CONSTRAINT IF EXISTS "prevention_incident_re20_attachment_storage_valid";--> statement-breakpoint
ALTER TABLE "prevention_incident_re20_attachments" ALTER COLUMN "sensitive_file_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "prevention_incident_re20_attachments" DROP COLUMN IF EXISTS "encrypted_file";--> statement-breakpoint
ALTER TABLE "prevention_incident_re20_attachments" DROP COLUMN IF EXISTS "file_iv";--> statement-breakpoint
ALTER TABLE "prevention_incident_re20_attachments" DROP COLUMN IF EXISTS "file_auth_tag";--> statement-breakpoint
ALTER TABLE "prevention_incident_re20_attachments" DROP COLUMN IF EXISTS "file_key_version";