ALTER TABLE "billing_invoice_payments" DROP CONSTRAINT "billing_invoice_payments_status_valid";--> statement-breakpoint

-- El índice único parcial de abajo no puede crearse si ya hay dos corridas
-- `running` del mismo (empresa, período) — precisamente la carrera que viene a
-- cerrar. Se conserva la más reciente y las anteriores se marcan `failed`: son
-- corridas de procesos que ya no existen (nadie las cerró) y dejarlas
-- `running` bloquearía el período igual que una colgada.
UPDATE "dte_sync_runs" d SET
  "status" = 'failed',
  "error" = coalesce(d."error", 'Corrida colgada: cerrada al introducir el índice de corrida única (migración 0140).'),
  "finished_at" = coalesce(d."finished_at", now())
WHERE d."status" = 'running'
  AND EXISTS (
    SELECT 1 FROM "dte_sync_runs" mas_reciente
    WHERE mas_reciente."status" = 'running'
      AND mas_reciente."cod_emp" = d."cod_emp"
      AND mas_reciente."periodo" = d."periodo"
      AND (mas_reciente."started_at", mas_reciente."id") > (d."started_at", d."id")
  );--> statement-breakpoint

CREATE UNIQUE INDEX "dte_sync_runs_single_active_unique" ON "dte_sync_runs" USING btree ("cod_emp","periodo") WHERE "dte_sync_runs"."status" = 'running';--> statement-breakpoint
ALTER TABLE "billing_invoice_payments" ADD CONSTRAINT "billing_invoice_payments_status_valid" CHECK ("billing_invoice_payments"."verification_status" IN ('suggested', 'confirmed', 'rejected', 'reverted'));