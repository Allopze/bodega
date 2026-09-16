import postgres from "postgres"

export interface FuelIntegrationsPreflight {
  splitTctIdentities: number
  providerTransactionsWithoutIdentity: number
  unknownProviderTransactions: number
  openProviderPendings: number
  openProviderRejections: number
  duplicateActiveBatches: number
  projectionPlateDuplicates: number
  batchDetailMismatches: number
  unmatchedReconciliationLinks: number
  dteReconciliationMismatches: number
  /** Dimensiona el rescate del detalle por transacción, antes de escribir nada. */
  detailTransactions: number
  detailWithoutOdometer: number
  detailDuplicateKeys: number
  detailPlatesWithoutVehicle: number
  meterReadingsRegressive: number
  meterReadingsNoChange: number
  providerPerformanceZero: number
}

/**
 * Diagnóstico previo a constraints/backfill de combustible. La garantía de no
 * mutar la base está en `sql.begin("read only", ...)`, no en una convención del
 * caller. No elige ganadores ni corrige datos.
 */
export async function readFuelIntegrationsPreflight(sql: postgres.Sql): Promise<FuelIntegrationsPreflight> {
  const [report] = await sql.begin("read only", async (tx) => tx<{
    split_tct_identities: number
    provider_transactions_without_identity: number
    unknown_provider_transactions: number
    open_provider_pendings: number
    open_provider_rejections: number
    duplicate_active_batches: number
    projection_plate_duplicates: number
    batch_detail_mismatches: number
    unmatched_reconciliation_links: number
    dte_reconciliation_mismatches: number
    detail_transactions: number
    detail_without_odometer: number
    detail_duplicate_keys: number
    detail_plates_without_vehicle: number
    meter_readings_regressive: number
    meter_readings_no_change: number
    provider_performance_zero: number
  }[]>`
    WITH split_tct_identities AS (
      -- El informe TCT es un agregado mensual POR PATENTE, así que la misma
      -- cuenta, el mismo mes y la misma patente sólo pueden tener UNA
      -- transacción. Dos identidades distintas ahí significan que la fila se
      -- duplicó en el ledger, que es el síntoma de una identidad inestable.
      --
      -- Reemplaza a un chequeo que agrupaba por (provider, source_account,
      -- identity_key), o sea exactamente las columnas del índice único
      -- fuel_provider_transactions_identity_unique: daba cero por construcción
      -- y no podía encontrar nada.
      SELECT source_account, occurred_at, regexp_replace(upper(trim(coalesce(source_plate, ''))), '[^A-Z0-9]', '', 'g') AS normalized_plate
      FROM fuel_provider_transactions
      WHERE provider = 'copec' AND source_account LIKE 'tct:%' AND source_plate IS NOT NULL
      GROUP BY 1, 2, 3
      HAVING COUNT(DISTINCT identity_key) > 1
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
    -- El detalle por transacción ya está guardado en raw_row->'detalle': estas
    -- CTE lo miden SIN escribir nada, para dimensionar el rescate y saber cuánto
    -- del histórico va a quedar fuera por patente sin vehículo.
    provider_detail AS (
      SELECT r.id AS record_id,
             r.vehicle_id,
             r.fuente,
             regexp_replace(upper(trim(d->>'Patente')), '[^A-Z0-9]', '', 'g') AS plate_key,
             COALESCE(NULLIF(d->>'Guía de Despacho', ''), d->>'transactionId') AS source_ref,
             NULLIF(COALESCE(d->>'Odómetro (Kms.)', d->>'vehicleOdometer'), '')::numeric AS odometer,
             -- Fecha Y hora: Copec las entrega en columnas separadas y ordenar
             -- sólo por fecha desempata al azar las cargas del mismo día, que es
             -- justo donde aparecen los pares regresivos. Sin la hora el conteo
             -- no coincide con el que produce el detector.
             COALESCE(d->>'Fecha Transacción', d->>'transactionDate') || COALESCE(d->>'Hora Transacción', '') AS occurred_on,
             NULLIF(d->>'Rendimiento (Kms. por Litro)', '')::numeric AS provider_performance
      FROM fuel_consumption_records r,
           LATERAL jsonb_array_elements(COALESCE(r.raw_row->'detalle', '[]'::jsonb)) d
    ),
    detail_series AS (
      -- Particionado por equipo Y proveedor, igual que el detector: el odómetro
      -- que reporta cada portal arrastra su propio desfase.
      SELECT plate_key, odometer,
             LAG(odometer) OVER (PARTITION BY plate_key, fuente ORDER BY occurred_on) AS previous_odometer
      FROM provider_detail
      WHERE odometer IS NOT NULL AND odometer > 0
    ),
    detail_duplicate_keys AS (
      SELECT source_ref FROM provider_detail
      WHERE source_ref IS NOT NULL
      GROUP BY source_ref HAVING COUNT(*) > 1
    ),
    detail_plates_without_vehicle AS (
      SELECT DISTINCT d.plate_key
      FROM provider_detail d
      WHERE d.vehicle_id IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM fuel_vehicles v
          WHERE regexp_replace(upper(trim(v.plate)), '[^A-Z0-9]', '', 'g') = d.plate_key
        )
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
      (SELECT COUNT(*)::int FROM split_tct_identities) AS split_tct_identities,
      (SELECT COUNT(*)::int FROM fuel_provider_transactions WHERE NULLIF(trim(identity_key), '') IS NULL) AS provider_transactions_without_identity,
      (SELECT COUNT(*)::int FROM fuel_provider_transactions WHERE provider NOT IN ('copec', 'aramco')) AS unknown_provider_transactions,
      (SELECT COUNT(*)::int FROM fuel_provider_transactions WHERE status = 'pending') AS open_provider_pendings,
      (SELECT COUNT(*)::int FROM fuel_provider_rejections WHERE status = 'open') AS open_provider_rejections,
      (SELECT COUNT(*)::int FROM duplicate_active_batches) AS duplicate_active_batches,
      (SELECT COUNT(*)::int FROM projection_plate_duplicates) AS projection_plate_duplicates,
      (SELECT COUNT(*)::int FROM batch_detail_mismatches) AS batch_detail_mismatches,
      (SELECT COUNT(*)::int FROM fuel_reconciliation_links WHERE status IN ('unmatched', 'ambiguous')) AS unmatched_reconciliation_links,
      (SELECT COUNT(*)::int FROM dte_reconciliation_mismatches) AS dte_reconciliation_mismatches,
      (SELECT COUNT(*)::int FROM provider_detail) AS detail_transactions,
      (SELECT COUNT(*)::int FROM provider_detail WHERE odometer IS NULL OR odometer <= 0) AS detail_without_odometer,
      (SELECT COUNT(*)::int FROM detail_duplicate_keys) AS detail_duplicate_keys,
      (SELECT COUNT(*)::int FROM detail_plates_without_vehicle) AS detail_plates_without_vehicle,
      (SELECT COUNT(*)::int FROM detail_series WHERE previous_odometer IS NOT NULL AND odometer < previous_odometer) AS meter_readings_regressive,
      (SELECT COUNT(*)::int FROM detail_series WHERE previous_odometer IS NOT NULL AND odometer = previous_odometer) AS meter_readings_no_change,
      (SELECT COUNT(*)::int FROM provider_detail WHERE provider_performance = 0) AS provider_performance_zero
  `)

  return {
    splitTctIdentities: Number(report?.split_tct_identities ?? 0),
    providerTransactionsWithoutIdentity: Number(report?.provider_transactions_without_identity ?? 0),
    unknownProviderTransactions: Number(report?.unknown_provider_transactions ?? 0),
    openProviderPendings: Number(report?.open_provider_pendings ?? 0),
    openProviderRejections: Number(report?.open_provider_rejections ?? 0),
    duplicateActiveBatches: Number(report?.duplicate_active_batches ?? 0),
    projectionPlateDuplicates: Number(report?.projection_plate_duplicates ?? 0),
    batchDetailMismatches: Number(report?.batch_detail_mismatches ?? 0),
    unmatchedReconciliationLinks: Number(report?.unmatched_reconciliation_links ?? 0),
    dteReconciliationMismatches: Number(report?.dte_reconciliation_mismatches ?? 0),
    detailTransactions: Number(report?.detail_transactions ?? 0),
    detailWithoutOdometer: Number(report?.detail_without_odometer ?? 0),
    detailDuplicateKeys: Number(report?.detail_duplicate_keys ?? 0),
    detailPlatesWithoutVehicle: Number(report?.detail_plates_without_vehicle ?? 0),
    meterReadingsRegressive: Number(report?.meter_readings_regressive ?? 0),
    meterReadingsNoChange: Number(report?.meter_readings_no_change ?? 0),
    providerPerformanceZero: Number(report?.provider_performance_zero ?? 0),
  }
}

/**
 * Contadores que describen una invariante, no una deuda: si alguno deja de ser
 * cero, el dato contradice algo que el código ya da por cierto (una identidad
 * estable por transacción, un proveedor conocido, un lote activo por cuenta,
 * una clave única en el detalle). Desplegar sobre eso es pedirle a una
 * migración o a un backfill que rompa a mitad de camino, así que el deploy se
 * detiene antes de tocar nada: el preflight corre después del pg_dump y antes
 * de migrar.
 *
 * Deliberadamente fuera de esta lista: la cola de pendientes del proveedor, los
 * rechazos abiertos, los enlaces sin conciliar, los odómetros regresivos y el
 * rendimiento en cero. Todo eso es trabajo operativo acumulado, real pero
 * inofensivo para el despliegue; bloquear por ahí sería dejar los deploys
 * rehenes de una digitación del proveedor.
 */
export const BLOCKING_FUEL_COUNTERS = [
  "splitTctIdentities",
  "providerTransactionsWithoutIdentity",
  "unknownProviderTransactions",
  "duplicateActiveBatches",
  "projectionPlateDuplicates",
  "batchDetailMismatches",
  "detailDuplicateKeys",
] as const satisfies readonly (keyof FuelIntegrationsPreflight)[]

/** Contadores que sí se informan, pero nunca detienen un despliegue. */
export const FUEL_DEBT_COUNTERS = [
  "openProviderPendings",
  "openProviderRejections",
  "unmatchedReconciliationLinks",
  "dteReconciliationMismatches",
  "detailWithoutOdometer",
  "detailPlatesWithoutVehicle",
  "meterReadingsRegressive",
  "meterReadingsNoChange",
  "providerPerformanceZero",
] as const satisfies readonly (keyof FuelIntegrationsPreflight)[]

export interface CounterFinding {
  counter: string
  value: number
}

export function findBlockingFuelCounters(report: FuelIntegrationsPreflight): CounterFinding[] {
  return BLOCKING_FUEL_COUNTERS
    .map((counter) => ({ counter, value: report[counter] }))
    .filter(({ value }) => value > 0)
}

export function findFuelDebtCounters(report: FuelIntegrationsPreflight): CounterFinding[] {
  return FUEL_DEBT_COUNTERS
    .map((counter) => ({ counter, value: report[counter] }))
    .filter(({ value }) => value > 0)
}

function formatFindings(findings: readonly CounterFinding[]): string {
  return findings.map(({ counter, value }) => `    ${counter}: ${value}`).join("\n")
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL?.trim()
  if (!databaseUrl) throw new Error("DATABASE_URL es requerido. Este preflight sólo lee la base indicada.")
  const sql = postgres(databaseUrl, { max: 1 })
  let report: FuelIntegrationsPreflight
  try {
    report = await readFuelIntegrationsPreflight(sql)
    console.log(JSON.stringify(report, null, 2))
  } finally {
    await sql.end()
  }

  const debt = findFuelDebtCounters(report)
  if (debt.length > 0) {
    console.warn(`    deuda operativa (no bloquea):\n${formatFindings(debt)}`)
  }

  const blocking = findBlockingFuelCounters(report)
  if (blocking.length === 0) return

  // La salida de emergencia es explícita y queda en el log del deploy: puede
  // hacer falta desplegar justamente el arreglo del dato que bloquea.
  if (process.env.SKIP_FUEL_PREFLIGHT_GATE === "1") {
    console.warn(`    ⚠️  invariantes rotas, ignoradas por SKIP_FUEL_PREFLIGHT_GATE=1:\n${formatFindings(blocking)}`)
    return
  }

  throw new Error(
    `El dato de combustible contradice invariantes que el despliegue da por ciertas:\n${formatFindings(blocking)}\n` +
      `  No se aplicaron migraciones. Corrige el dato, o repite con SKIP_FUEL_PREFLIGHT_GATE=1 si ya evaluaste el riesgo.`,
  )
}

// Sin `await` de nivel superior: el runner transpila a CJS y ahí el top-level
// await es un error de transformación, así que el script fallaba antes de abrir
// la conexión. El guard sigue permitiendo importar el módulo desde el test.
if (process.argv[1]?.includes("preflight-fuel-integrations")) {
  main().then(
    () => process.exit(0),
    (error) => {
      console.error(error instanceof Error ? error.message : error)
      process.exit(1)
    },
  )
}
