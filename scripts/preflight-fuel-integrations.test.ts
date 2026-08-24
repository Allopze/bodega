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
    })
  })
})
