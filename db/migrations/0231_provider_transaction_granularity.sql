-- Granularidad de la evidencia externa.
--
-- `decideFuelLoadMatch` compara una transacción del proveedor contra una carga
-- interna exigiendo misma fecha y litros/monto dentro de tolerancia. Eso sólo
-- tiene sentido si la fila del ledger ES una transacción. El informe TCT de
-- Copec, en cambio, es un AGREGADO MENSUAL por patente: su fila se fecha al día
-- 1 del mes y suma todas las cargas, así que el matcher no podía dar `matched`
-- jamás y llenaba `fuel_reconciliation_links` de `unmatched` que no significan
-- descuadre, sino "esto no era comparable". Con la columna, la conciliación
-- salta esas filas en vez de inventarles un veredicto.
ALTER TABLE "fuel_provider_transactions"
  ADD COLUMN "granularity" text NOT NULL DEFAULT 'transaction';
--> statement-breakpoint
UPDATE "fuel_provider_transactions"
SET "granularity" = 'period_aggregate'
WHERE "provider" = 'copec' AND "source_account" LIKE 'tct:%';
--> statement-breakpoint
ALTER TABLE "fuel_provider_transactions"
  ADD CONSTRAINT "fuel_provider_transactions_granularity_valid"
  CHECK ("granularity" IN ('transaction', 'period_aggregate'));
--> statement-breakpoint
-- Vínculos que la conciliación produjo cruzando evidencia agregada contra
-- cargas individuales: son `unmatched` por construcción, no por descuadre.
-- Se borran para que `unmatched_reconciliation_links` del preflight vuelva a
-- medir descuadres reales; la conciliación ya no los vuelve a crear.
DELETE FROM "fuel_reconciliation_links" l
USING "fuel_provider_transactions" t
WHERE t."id" = l."provider_transaction_id"
  AND t."granularity" = 'period_aggregate';
