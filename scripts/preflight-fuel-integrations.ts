import postgres from "postgres"

export interface FuelIntegrationsPreflight {
  duplicateProviderIdentities: number
  providerTransactionsWithoutIdentity: number
  unknownProviderTransactions: number
  openProviderPendings: number
  openProviderRejections: number
  duplicateActiveBatches: number
  projectionPlateDuplicates: number
  batchDetailMismatches: number
  unmatchedReconciliationLinks: number
  dteReconciliationMismatches: number
}

/**
 * Diagnóstico previo a constraints/backfill de combustible. La garantía de no
 * mutar la base está en `sql.begin("read only", ...)`, no en una convención del
 * caller. No elige ganadores ni corrige datos.
 */
export async function readFuelIntegrationsPreflight(sql: postgres.Sql): Promise<FuelIntegrationsPreflight> {
  const [report] = await sql.begin("read only", async (tx) => tx<{
    duplicate_provider_identities: number
    provider_transactions_without_identity: number
    unknown_provider_transactions: number
    open_provider_pendings: number
    open_provider_rejections: number
    duplicate_active_batches: number
    projection_plate_duplicates: number
    batch_detail_mismatches: number
    unmatched_reconciliation_links: number
    dte_reconciliation_mismatches: number
  }[]>`
    WITH duplicate_provider_identities AS (
      SELECT provider, source_account, identity_key
      FROM fuel_provider_transactions
      GROUP BY provider, source_account, identity_key
      HAVING COUNT(*) > 1
    ),
    duplicate_active_batches AS (
      SELECT worksite_id, periodo_desde, periodo_hasta, fuente
      FROM fuel_import_batches
      WHERE estado <> 'revertido'
      GROUP BY worksite_id, periodo_desde, periodo_hasta, fuente
      HAVING COUNT(*) > 1
    ),
    projection_plate_duplicates AS (
      SELECT batch_id, regexp_replace(upper(trim(patente)), '[^A-Z0-9]', '', 'g') AS normalized_plate
      FROM fuel_consumption_records
      GROUP BY batch_id, regexp_replace(upper(trim(patente)), '[^A-Z0-9]', '', 'g')
      HAVING COUNT(*) > 1
    ),
    batch_detail_mismatches AS (
      SELECT b.id
      FROM fuel_import_batches b
      LEFT JOIN fuel_consumption_records r ON r.batch_id = b.id
      WHERE b.estado <> 'revertido'
      GROUP BY b.id, b.filas_validas, b.total_patentes, b.total_transacciones, b.total_cantidad, b.total_monto
      HAVING COUNT(r.id) <> b.filas_validas
         OR COUNT(DISTINCT r.patente) <> b.total_patentes
         OR COALESCE(SUM(r.numero_transacciones), 0) <> b.total_transacciones
         OR ABS(COALESCE(SUM(r.cantidad_unidad), 0) - b.total_cantidad) > 0.0001
         OR ABS(COALESCE(SUM(r.monto), 0) - b.total_monto) > 0.01
    ),
    dte_reconciliation_mismatches AS (
      SELECT d.id
      FROM dte_documents d
      JOIN fuel_reconciliation_links l
        ON l.dte_document_id = d.id
       AND l.link_type = 'dte'
       AND l.status = 'matched'
      JOIN fuel_provider_transactions t ON t.id = l.provider_transaction_id
      GROUP BY d.id, d.monto_total
      HAVING ABS(COALESCE(SUM(t.amount), 0) - d.monto_total) > 1
    )
    SELECT
      (SELECT COUNT(*)::int FROM duplicate_provider_identities) AS duplicate_provider_identities,
      (SELECT COUNT(*)::int FROM fuel_provider_transactions WHERE NULLIF(trim(identity_key), '') IS NULL) AS provider_transactions_without_identity,
      (SELECT COUNT(*)::int FROM fuel_provider_transactions WHERE provider NOT IN ('copec', 'aramco')) AS unknown_provider_transactions,
      (SELECT COUNT(*)::int FROM fuel_provider_transactions WHERE status = 'pending') AS open_provider_pendings,
      (SELECT COUNT(*)::int FROM fuel_provider_rejections WHERE status = 'open') AS open_provider_rejections,
      (SELECT COUNT(*)::int FROM duplicate_active_batches) AS duplicate_active_batches,
      (SELECT COUNT(*)::int FROM projection_plate_duplicates) AS projection_plate_duplicates,
      (SELECT COUNT(*)::int FROM batch_detail_mismatches) AS batch_detail_mismatches,
      (SELECT COUNT(*)::int FROM fuel_reconciliation_links WHERE status IN ('unmatched', 'ambiguous')) AS unmatched_reconciliation_links,
      (SELECT COUNT(*)::int FROM dte_reconciliation_mismatches) AS dte_reconciliation_mismatches
  `)

  return {
    duplicateProviderIdentities: Number(report?.duplicate_provider_identities ?? 0),
    providerTransactionsWithoutIdentity: Number(report?.provider_transactions_without_identity ?? 0),
    unknownProviderTransactions: Number(report?.unknown_provider_transactions ?? 0),
    openProviderPendings: Number(report?.open_provider_pendings ?? 0),
    openProviderRejections: Number(report?.open_provider_rejections ?? 0),
    duplicateActiveBatches: Number(report?.duplicate_active_batches ?? 0),
    projectionPlateDuplicates: Number(report?.projection_plate_duplicates ?? 0),
    batchDetailMismatches: Number(report?.batch_detail_mismatches ?? 0),
    unmatchedReconciliationLinks: Number(report?.unmatched_reconciliation_links ?? 0),
    dteReconciliationMismatches: Number(report?.dte_reconciliation_mismatches ?? 0),
  }
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL?.trim()
  if (!databaseUrl) throw new Error("DATABASE_URL es requerido. Este preflight sólo lee la base indicada.")
  const sql = postgres(databaseUrl, { max: 1 })
  try {
    console.log(JSON.stringify(await readFuelIntegrationsPreflight(sql), null, 2))
  } finally {
    await sql.end()
  }
}

if (process.argv[1]?.includes("preflight-fuel-integrations")) await main()
