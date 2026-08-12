import { beforeEach, describe, expect, it, vi } from "vitest"

const mockWhere = vi.fn()
const mockFrom = vi.fn(() => ({ where: mockWhere }))
const mockSelect = vi.fn(() => ({ from: mockFrom }))

vi.mock("@/db", () => ({
  db: { select: mockSelect },
}))

const { assertNoDteSingleBusinessLinkConflicts } = await import("./preflight-dte-single-link")

describe("DTE single-business-link migration preflight", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWhere.mockResolvedValue([])
  })

  it("allows the migration when no historical DTE is linked to both domains", async () => {
    await expect(assertNoDteSingleBusinessLinkConflicts()).resolves.toEqual([])
  })

  it("blocks the migration with the exact conflicting DTE ids for remediation", async () => {
    mockWhere.mockResolvedValue([{
      id: "dte-conflict-1",
      purchaseOrderInvoiceId: "invoice-1",
      fuelLoadId: "fuel-1",
    }])

    await expect(assertNoDteSingleBusinessLinkConflicts()).rejects.toThrow(/dte-conflict-1/)
  })
})
