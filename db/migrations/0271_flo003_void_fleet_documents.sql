-- FLO-003 (auditoría 2026-09-14), patrón P5: eliminar un documento de flota
-- borraba la fila y el archivo. La póliza o la revisión técnica desaparecían,
-- justo lo que puede pedirse en una fiscalización. Se anula en vez de borrarse,
-- con el mismo contrato que la anulación de una entrega.
ALTER TABLE "fleet_vehicle_documents"
  ADD COLUMN IF NOT EXISTS "voided_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "voided_by" text REFERENCES "users"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "void_reason" text;
--> statement-breakpoint
ALTER TABLE "fleet_vehicle_documents"
  DROP CONSTRAINT IF EXISTS "fleet_vehicle_documents_status_valid";
--> statement-breakpoint
ALTER TABLE "fleet_vehicle_documents"
  ADD CONSTRAINT "fleet_vehicle_documents_status_valid"
  CHECK ("status" IN ('current', 'replaced', 'voided'));
--> statement-breakpoint
ALTER TABLE "fleet_vehicle_documents"
  ADD CONSTRAINT "fleet_vehicle_documents_void_complete" CHECK (
    ("voided_at" IS NULL AND "voided_by" IS NULL AND "void_reason" IS NULL
      AND "status" <> 'voided')
    OR ("voided_at" IS NOT NULL AND "voided_by" IS NOT NULL
      AND char_length(trim("void_reason")) >= 10
      AND "status" = 'voided')
  );
