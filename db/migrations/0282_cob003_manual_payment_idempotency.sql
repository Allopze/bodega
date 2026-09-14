-- COB-003 — La defensa contra el pago manual duplicado dura dos minutos.
--
-- El índice único `(invoice_id, bank_transaction_id)` no cubre los pagos
-- manuales, cuyo `bank_transaction_id` es NULL: la acción compensaba con un
-- bloqueo de fila y una búsqueda de "gemelo reciente" (mismo importe, misma
-- fecha, misma factura, confirmado, creado hace menos de dos minutos). Pasada
-- esa ventana el mismo pago se registraba otra vez sin ninguna advertencia.
--
-- Una ventana en memoria no es una defensa: la duradera es una clave de
-- idempotencia persistida, el mismo patrón que ya usan `ppa_submissions` y
-- `fuel_tae_submissions` con su `client_submission_id`. El formulario genera
-- una clave por apertura y la reenvía en cada reintento, de modo que el doble
-- clic, la doble pestaña y el reenvío por red colapsan sobre la MISMA fila.
--
-- Nullable a propósito: los pagos históricos y los que nacen de la cartola no
-- tienen clave, y el índice único parcial sólo cubre las filas que sí la traen.
ALTER TABLE "billing_invoice_payments" ADD COLUMN IF NOT EXISTS "client_request_id" text;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "billing_invoice_payments_client_request_unique"
  ON "billing_invoice_payments" ("client_request_id")
  WHERE "client_request_id" IS NOT NULL;
