-- GDI-003 (auditoría 2026-09-14), patrón P6: el motivo de anulación de una guía
-- exigía 5 caracteres mientras anular una entrega —el mismo acto sobre otro
-- documento— exigía 10. Se unifica en 10, el umbral que ya usaba la mayoría.
--
-- `NOT VALID` a propósito: las guías ya anuladas con un motivo de 5 a 9
-- caracteres son historia y no se pueden reescribir sin inventar texto. La
-- restricción rige para toda escritura nueva, que es lo que se quiere; validarla
-- hacia atrás sólo habría obligado a falsear registros pasados.
ALTER TABLE "dispatch_guides"
  DROP CONSTRAINT IF EXISTS "dispatch_guides_cancellation_stamp_valid";
--> statement-breakpoint
ALTER TABLE "dispatch_guides"
  ADD CONSTRAINT "dispatch_guides_cancellation_stamp_valid" CHECK (
    ("status" = 'cancelled'
      AND "cancelled_at" IS NOT NULL
      AND "cancelled_by" IS NOT NULL
      AND char_length(trim("cancellation_reason")) >= 10)
    OR ("status" <> 'cancelled'
      AND "cancelled_at" IS NULL
      AND "cancelled_by" IS NULL
      AND "cancellation_reason" IS NULL)
  ) NOT VALID;
