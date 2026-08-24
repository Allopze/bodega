import { describe, expect, it } from "vitest"
import { buildFuelDteGroupCandidate, decideFuelDteGroup } from "./fuel-dte-reconciliation"

const dte = { id: "dte-1", tipoDte: "33", rutEmisor: "76.123.456-7", montoTotal: 100_000 }

describe("fuel DTE 1:N reconciliation", () => {
  it("matches an explicit group and compares its aggregate amount", () => {
    expect(decideFuelDteGroup(dte, [{ transactionIds: ["tx-1", "tx-2"], supplierRut: "76123456-7", totalAmount: 100_000 }])).toMatchObject({ status: "matched", transactionIds: ["tx-1", "tx-2"], difference: 0 })
  })

  it("never resolves two amount-equivalent groups automatically", () => {
    expect(decideFuelDteGroup(dte, [
      { transactionIds: ["tx-1"], supplierRut: "76123456-7", totalAmount: 100_000 },
      { transactionIds: ["tx-2"], supplierRut: "76123456-7", totalAmount: 100_000 },
    ]).status).toBe("ambiguous")
  })

  it("keeps a credit/debit note for explicit human review", () => {
    expect(decideFuelDteGroup({ ...dte, tipoDte: "61" }, [{ transactionIds: ["tx-1"], supplierRut: "76123456-7", totalAmount: 100_000 }])).toMatchObject({ status: "unmatched", reason: expect.stringMatching(/humana/) })
  })

  it("rejects a group that mixes suppliers or lacks a supplier RUT", () => {
    expect(buildFuelDteGroupCandidate([
      { id: "tx-1", supplierRut: "76123456-7", amount: 60_000 },
      { id: "tx-2", supplierRut: "96543210-1", amount: 40_000 },
    ])).toBeNull()
    expect(buildFuelDteGroupCandidate([
      { id: "tx-1", supplierRut: null, amount: 100_000 },
    ])).toBeNull()
  })
})
