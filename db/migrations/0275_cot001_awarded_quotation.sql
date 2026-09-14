-- COT-001 (auditoría 2026-09-14): la oferta adjudicada no dejaba importe ni
-- vínculo documental al crear la OC. Se persiste la referencia de la
-- adjudicación —qué oferta ganó y por cuánto en total— en la línea de solicitud,
-- que es de donde Nueva OC toma sus datos.
ALTER TABLE "purchase_request_items"
  ADD COLUMN IF NOT EXISTS "awarded_quotation_id" text,
  ADD COLUMN IF NOT EXISTS "awarded_quotation_total" numeric(12, 2);
