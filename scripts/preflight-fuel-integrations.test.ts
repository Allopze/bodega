import { describe, expect, it, vi } from "vitest"
import type postgres from "postgres"
import { readFuelIntegrationsPreflight } from "./preflight-fuel-integrations"

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
