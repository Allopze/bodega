import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  findDual: vi.fn(),
  findDuplicates: vi.fn(),
  selectRows: vi.fn(),
}))

vi.mock("./preflight-dte-single-link", () => ({
  findDteSingleBusinessLinkConflicts: () => mocks.findDual(),
  findDtePurchaseInvoiceDuplicateConflicts: () => mocks.findDuplicates(),
}))
vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => mocks.selectRows(),
      }),
    }),
  },
}))

const { repairDteSingleLink } = await import("./repair-dte-single-link")

describe("DTE single-link repair command", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.findDual.mockResolvedValue([{
      id: "dte-dual",
      purchaseOrderInvoiceId: "invoice-1",
      fuelLoadId: "fuel-1",
    }])
    mocks.findDuplicates.mockResolvedValue([{
      purchaseOrderInvoiceId: "invoice-2",
      dteDocumentIds: ["dte-keep", "dte-drop"],
    }])
    mocks.selectRows.mockResolvedValue([
      { id: "dte-keep", purchaseOrderInvoiceId: "invoice-2", fuelLoadId: null },
      { id: "dte-drop", purchaseOrderInvoiceId: "invoice-2", fuelLoadId: null },
    ])
  })

  it("reports every conflict by default without opening a write transaction", async () => {
    const result = await repairDteSingleLink({ apply: false })

    expect(result.mode).toBe("report")
    expect(result.conflicts).toBe(2)
    expect(result.repaired).toBe(0)
    expect(result.singleBusinessLink).toHaveLength(1)
    expect(result.duplicatePurchaseInvoices[0]?.dteDocumentIds).toEqual(["dte-keep", "dte-drop"])
  })

  it("requires an explicit mapping before apply can proceed", async () => {
    await expect(repairDteSingleLink({ apply: true })).rejects.toThrow(/--apply exige --mapping/)
  })
})
