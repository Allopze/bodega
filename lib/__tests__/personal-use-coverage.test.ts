/**
 * Guarda de regresión — uso personal de equipos (spec 2026-11-20, §5.3 y §6).
 *
 * En los días de uso personal un equipo no suma plata, litros, km, horas ni
 * ralentí en ningún agregado de GESTIÓN, pero la cuadratura, los pagos, las
 * conciliaciones y Mantención siguen viéndolo todo. Una cifra que excluye el
 * período en una pantalla y no en otra es peor que no tener la función
 * (anti-objetivo de la spec), así que esta guarda obliga a decidir:
 *
 * 1. Todo archivo de `lib/` o `app/` que agrega (`sum(`/`avg(`) sobre una de las
 *    tablas de §5.3 está clasificado: gestión (aplica la regla común), registro
 *    (la muestra marcada) o exento (pagos, conciliación, bodega…), con motivo.
 *    Uno nuevo sin clasificar hace fallar la prueba.
 * 2. Los de gestión y registro importan la regla común.
 * 3. Los de pagos, conciliación y Mantención NO la importan.
 *
 * Mismo patrón de escaneo que `fleet-relocation-callers.test.ts`: sin base de
 * datos y en cada `npm test`.
 */
import { describe, expect, it } from "vitest"
import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"

const ROOT = process.cwd()

/** Las fuentes de §5.3 (y su telemetría, viajes y lecturas, para km, horas y ralentí). */
const SOURCE_TABLES = /\b(fuelProviderTransactions|fuelEquipmentLoads|fuelConsumptionRecords|fuelLoads|purchaseOrderItems|fuelTelemetryDaily|fuelOperationRecords|fuelTaeSubmissions|fleetGpsTrips|fuelMeterReadings)\b/
const AGGREGATE = /\b(sum|avg)\(/i
/** La regla común: SQL, memoria, combustible o el filtro de litros de gestión. */
const COMMON_RULE = /@\/lib\/fleet\/personal-use(-sql)?"|@\/lib\/combustibles\/personal-use-fuel-sql"|\bbuildManagementLoadWhere\b|@\/lib\/services\/fleet-personal-use"/

/** Agregados de gestión: excluyen los días de uso personal. */
const MANAGEMENT_FILES = [
  // Control operacional y Costo por contrato
  "lib/services/operational-control.ts",
  "lib/combustibles/control/queries/asset-fuel-summary.ts",
  "lib/services/purchasing-module/vehicle-purchase-summary.ts",
  // Flota, Analítica e Inicio
  "lib/services/fleet.ts",
  "lib/services/fleet-gps-indicators.ts",
  "lib/services/analytics-module/dashboard.ts",
  "lib/services/dashboard-fuel.ts",
  // Combustible: Panel, indicadores, consumo, resumen, TAE, rendimiento y ralentí
  "lib/combustibles/panel/queries.ts",
  "lib/combustibles/indicators/queries.ts",
  "lib/combustibles/consumption-dashboard.ts",
  "lib/combustibles/fuel-control-overview.ts",
  "lib/combustibles/operations-dashboard.ts",
  "lib/combustibles/tae-dashboard.ts",
  "lib/combustibles/control/queries/overview.ts",
  "lib/combustibles/control/queries/performance.ts",
  "lib/combustibles/control/queries/meter-rates.ts",
  "lib/combustibles/control/queries/idle.ts",
  "lib/combustibles/control/queries/idle-comparison.ts",
  "lib/combustibles/equipment/get-equipment-file.ts",
  // Detectores: el uso personal no abre casos
  "lib/combustibles/anomaly-detector.ts",
  "lib/services/fuel-tae/anomalies.ts",
]

/** Registros: muestran la fila con la marca «Uso personal», sin ocultarla ni restarla. */
const RECORD_FILES = [
  "lib/combustibles/fuel-log.ts",
  "lib/combustibles/inbox/queries.ts",
  "lib/combustibles/control/review-queue.ts",
]

/** Agregan sobre esas tablas pero NO son gestión de costos/consumo por equipo. */
const EXEMPT_FILES: Record<string, string> = {
  "app/(app)/combustibles/actions-module/statements.ts": "estados de cuenta (pagos)",
  "app/(app)/combustibles/pagos/invoice-data.ts": "facturas (pagos)",
  "app/(app)/recepcion/page.tsx": "recepción de OC (bodega)",
  "lib/combustibles/control/queries/reconciliation.ts": "cuadratura",
  "lib/combustibles/control/queries/seals.ts": "control de sellos (cuadratura)",
  "lib/combustibles/coverage-matrix-data.ts": "cobertura de fuentes",
  "lib/combustibles/evidence-management.ts": "evidencias de cargas",
  "lib/combustibles/fuel-cycle.ts": "ciclo de pago",
  "lib/combustibles/payables-summary.ts": "lo que falta pagar",
  "lib/combustibles/tae-copec-reconciliation.ts": "conciliación TAE ↔ Copec",
  "lib/combustibles/tae-import-ledger.ts": "libro de importación TAE",
  "lib/services/deliveries-void.ts": "bodega (entregas)",
  "lib/services/deliveries-worker-stock.ts": "bodega (stock del trabajador)",
  "lib/services/dispatch-guides.ts": "bodega (guías de despacho)",
  "lib/services/epp-delivery-scale-reconciliation.ts": "EPP",
  "lib/services/epp-pending-delivery.ts": "EPP",
  "lib/services/item-state-module/rollup.ts": "estado de ítems de compra",
  "lib/services/operational-work-queue.ts": "cola de trabajo",
  "lib/services/purchasing-module/receiving.ts": "recepción de OC (bodega)",
  "lib/services/request-status-reconciliation.ts": "estado de solicitudes",
  "lib/services/stock-availability.ts": "bodega (stock)",
}

/** Pagos, conciliaciones y Mantención: ven TODO, nunca importan la regla. */
const PAYMENT_FILES = [
  "lib/combustibles/fuel-reconciliation.ts",
  "lib/combustibles/fuel-dte-reconciliation.ts",
  "lib/combustibles/control/queries/reconciliation.ts",
  "lib/combustibles/control/queries/reconciliation-summary.ts",
  "lib/combustibles/tae-copec-reconciliation.ts",
  "lib/combustibles/payables-summary.ts",
  "lib/combustibles/statements-preview.ts",
  "lib/combustibles/fuel-provider-ledger.ts",
  "lib/combustibles/copec-sync.ts",
  "lib/combustibles/provider-pending-items.ts",
  "lib/combustibles/coverage-notice-data.ts",
  "lib/combustibles/sources-status.ts",
  "lib/combustibles/coverage-matrix-data.ts",
  "lib/combustibles/fuel-cycle.ts",
  "lib/combustibles/open-period.ts",
  "lib/combustibles/load-status.ts",
  "lib/services/operational-control-sources.ts",
  "lib/services/dte-portal/reconciliation.ts",
  "lib/services/dte-portal/folio-match.ts",
  "lib/services/purchasing-module/reconciliation-overview.ts",
  "app/(app)/combustibles/pagos/invoice-data.ts",
]

function scanned(roots: string[]): string[] {
  return roots.flatMap((root) =>
    readdirSync(path.join(ROOT, root), { recursive: true, encoding: "utf8" })
      .map((entry) => `${root}/${entry.split(path.sep).join("/")}`)
      .filter((file) => /\.tsx?$/.test(file))
      .filter((file) => !/\.test\.tsx?$/.test(file) && !file.includes("/__tests__/") && !file.includes("/testing/") && !file.endsWith("test-fixtures.ts")),
  )
}

const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8")
const existing = (files: string[]) => files.filter((file) => {
  try { read(file); return true } catch { return false }
})

describe("uso personal: cobertura de la regla común", () => {
  it("todo agregado sobre las fuentes de §5.3 está clasificado (gestión, registro o exento)", () => {
    const classified = new Set([...MANAGEMENT_FILES, ...RECORD_FILES, ...Object.keys(EXEMPT_FILES)])
    const unclassified = scanned(["lib", "app"])
      .filter((file) => !file.startsWith("lib/services/mantencion/"))
      .filter((file) => {
        const source = read(file)
        return SOURCE_TABLES.test(source) && AGGREGATE.test(source)
      })
      .filter((file) => !classified.has(file))
    expect(unclassified, "agrega sobre combustible/OC/GPS: decide si excluye el uso personal y clasifícalo aquí").toEqual([])
  })

  it("los agregados de gestión y los registros usan la regla común", () => {
    const missing = [...MANAGEMENT_FILES, ...RECORD_FILES].filter((file) => !COMMON_RULE.test(read(file)))
    expect(missing).toEqual([])
  })

  it("pagos, conciliaciones y Mantención no la importan", () => {
    const offenders = [...existing(PAYMENT_FILES), ...scanned(["lib/services/mantencion"])]
      .filter((file) => /@\/lib\/fleet\/personal-use(-sql)?"|@\/lib\/combustibles\/personal-use-fuel-sql"|\bbuildManagementLoadWhere\b/.test(read(file)))
    expect(offenders).toEqual([])
  })

  it("las listas apuntan a archivos que existen", () => {
    const listed = [...MANAGEMENT_FILES, ...RECORD_FILES, ...Object.keys(EXEMPT_FILES)]
    expect(listed.filter((file) => existing([file]).length === 0)).toEqual([])
  })
})
