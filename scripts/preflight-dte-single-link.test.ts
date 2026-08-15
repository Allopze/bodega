import { beforeEach, describe, expect, it, vi } from "vitest"

const mockSelect = vi.fn()

vi.mock("@/db", () => ({
  db: { select: mockSelect },
}))

const { assertNoDteSingleBusinessLinkConflicts } = await import("./preflight-dte-single-link")

describe("DTE single-business-link migration preflight", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSelect.mockImplementationOnce(() => ({
      from: () => ({ where: () => Promise.resolve([]) }),
    })).mockImplementationOnce(() => ({
      from: () => ({
        where: () => ({
          groupBy: () => ({ having: () => Promise.resolve([]) }),
        }),
      }),
    }))
  })

  it("allows the migration when no historical DTE is linked to both domains", async () => {
    await expect(assertNoDteSingleBusinessLinkConflicts()).resolves.toEqual([])
  })

  it("blocks the migration with the exact conflicting DTE ids for remediation", async () => {
    mockSelect.mockReset()
    mockSelect.mockImplementationOnce(() => ({
      from: () => ({ where: () => Promise.resolve([{
        id: "dte-conflict-1",
        purchaseOrderInvoiceId: "invoice-1",
        fuelLoadId: "fuel-1",
      }]) }),
    })).mockImplementationOnce(() => ({
      from: () => ({
        where: () => ({
          groupBy: () => ({ having: () => Promise.resolve([]) }),
        }),
      }),
    }))

    await expect(assertNoDteSingleBusinessLinkConflicts()).rejects.toThrow(/dte-conflict-1/)
  })
})
