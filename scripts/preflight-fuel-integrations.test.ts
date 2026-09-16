import { describe, expect, it, vi } from "vitest"
import type postgres from "postgres"
import {
  BLOCKING_FUEL_COUNTERS,
  findBlockingFuelCounters,
  findFuelDebtCounters,
  readFuelIntegrationsPreflight,
  type FuelIntegrationsPreflight,
} from "./preflight-fuel-integrations"

describe("preflight de integraciones de combustible", () => {
  it("abre una transacción read only y sólo reporta conflictos", async () => {
    const begin = vi.fn(async (mode: string, callback: (tx: unknown) => Promise<unknown>) => {
      expect(mode).toBe("read only")
      return callback((strings: TemplateStringsArray) => {
        expect(strings.join(" ")).toContain("fuel_provider_transactions")
        expect(strings.join(" ")).toContain("COUNT(r.id) <> b.filas_validas")
        // El rescate del detalle se mide leyendo el JSON ya guardado, sin escribir.
        expect(strings.join(" ")).toContain("jsonb_array_elements")
        return Promise.resolve([{
          split_tct_identities: 1,
          provider_transactions_without_identity: 0,
          unknown_provider_transactions: 0,
          open_provider_pendings: 2,
          open_provider_rejections: 1,
          duplicate_active_batches: 0,
          projection_plate_duplicates: 0,
          batch_detail_mismatches: 0,
          unmatched_reconciliation_links: 3,
          dte_reconciliation_mismatches: 1,
          detail_transactions: 265,
          detail_without_odometer: 0,
          detail_duplicate_keys: 0,
          detail_plates_without_vehicle: 2,
          meter_readings_regressive: 27,
          meter_readings_no_change: 1,
          provider_performance_zero: 48,
        }])
      })
    })

    await expect(readFuelIntegrationsPreflight({ begin } as unknown as postgres.Sql)).resolves.toEqual({
      splitTctIdentities: 1,
      providerTransactionsWithoutIdentity: 0,
      unknownProviderTransactions: 0,
      openProviderPendings: 2,
      openProviderRejections: 1,
      duplicateActiveBatches: 0,
      projectionPlateDuplicates: 0,
      batchDetailMismatches: 0,
      unmatchedReconciliationLinks: 3,
      dteReconciliationMismatches: 1,
      detailTransactions: 265,
      detailWithoutOdometer: 0,
      detailDuplicateKeys: 0,
      detailPlatesWithoutVehicle: 2,
      meterReadingsRegressive: 27,
      meterReadingsNoChange: 1,
      providerPerformanceZero: 48,
    })
  })
})

const EMPTY_REPORT: FuelIntegrationsPreflight = {
  splitTctIdentities: 0,
  providerTransactionsWithoutIdentity: 0,
  unknownProviderTransactions: 0,
  openProviderPendings: 0,
  openProviderRejections: 0,
  duplicateActiveBatches: 0,
  projectionPlateDuplicates: 0,
  batchDetailMismatches: 0,
  unmatchedReconciliationLinks: 0,
  dteReconciliationMismatches: 0,
  detailTransactions: 0,
  detailWithoutOdometer: 0,
  detailDuplicateKeys: 0,
  detailPlatesWithoutVehicle: 0,
  meterReadingsRegressive: 0,
  meterReadingsNoChange: 0,
  providerPerformanceZero: 0,
}

describe("puerta del preflight de combustible", () => {
  it("deja pasar un informe sin invariantes rotas", () => {
    expect(findBlockingFuelCounters(EMPTY_REPORT)).toEqual([])
  })

  it("bloquea cuando una invariante estructural deja de ser cero", () => {
    expect(findBlockingFuelCounters({ ...EMPTY_REPORT, splitTctIdentities: 1, detailDuplicateKeys: 2 })).toEqual([
      { counter: "splitTctIdentities", value: 1 },
      { counter: "detailDuplicateKeys", value: 2 },
    ])
  })

  it("no bloquea por deuda operativa: los pendientes y los odómetros sólo se informan", () => {
    // Son exactamente los valores que trajo producción el 2026-09-15, cuando el
    // deploy pasó y debía pasar.
    const report = {
      ...EMPTY_REPORT,
      openProviderPendings: 103,
      meterReadingsRegressive: 2,
      providerPerformanceZero: 4,
      detailTransactions: 30,
    }

    expect(findBlockingFuelCounters(report)).toEqual([])
    expect(findFuelDebtCounters(report)).toEqual([
      { counter: "openProviderPendings", value: 103 },
      { counter: "meterReadingsRegressive", value: 2 },
      { counter: "providerPerformanceZero", value: 4 },
    ])
  })

  it("no bloquea por el total de transacciones del detalle, que es sólo dimensión", () => {
    expect(BLOCKING_FUEL_COUNTERS).not.toContain("detailTransactions")
    expect(findFuelDebtCounters({ ...EMPTY_REPORT, detailTransactions: 265 })).toEqual([])
  })
})
