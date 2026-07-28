import { beforeEach, describe, expect, it, vi } from "vitest"

const mockListEppCoverageGaps = vi.hoisted(() => vi.fn())
const mockNextCodeTx = vi.hoisted(() => vi.fn())
const mockTransaction = vi.hoisted(() => vi.fn())
const mockInsert = vi.hoisted(() => vi.fn())
const mockUpdate = vi.hoisted(() => vi.fn())
const mockFindProduct = vi.hoisted(() => vi.fn())

vi.mock("@/db", () => ({
  db: {
    transaction: mockTransaction,
  },
}))
vi.mock("@/lib/code-sequences", () => ({ nextCodeTx: mockNextCodeTx }))
vi.mock("@/lib/services/prevention-epp", () => ({ listEppCoverageGaps: mockListEppCoverageGaps }))

const access = {
  userId: "prevention-manager",
  scope: { mode: "some" as const, ids: ["ws-1"] },
  permissions: ["prevention:epp:view"],
}

describe("generateReplenishmentDrafts", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockNextCodeTx.mockResolvedValue("SOL-2026-0042")
    mockFindProduct.mockResolvedValue({ id: "product-casco", unitOfMeasure: "unidad" })
    mockUpdate.mockReturnValue({
      set: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) })),
    })
    mockTransaction.mockImplementation(async (callback) => callback({
      insert: mockInsert,
      update: mockUpdate,
      query: { products: { findFirst: mockFindProduct } },
    }))
  })

  it("creates one linked draft for each newly reserved coverage gap", async () => {
    mockListEppCoverageGaps.mockResolvedValue([{
      workerId: "worker-1", workerName: "Ana", worksiteId: "ws-1", position: "Operadora",
      eppTypeId: "epp-casco", eppTypeLabel: "Casco", requirementId: "requirement-1",
      enforcement: "blocking", reason: "Uso obligatorio", gapType: "missing", lastDeliveredAt: null,
    }])
    let insertCall = 0
    mockInsert.mockImplementation(() => {
      insertCall += 1
      if (insertCall === 1) {
        return { values: vi.fn(() => ({
          onConflictDoNothing: vi.fn(() => ({ returning: vi.fn().mockResolvedValue([{ id: "link-1" }]) })),
        })) }
      }
      if (insertCall === 3) {
        return { values: vi.fn(() => ({ returning: vi.fn().mockResolvedValue([{ id: "item-1" }]) })) }
      }
      return { values: vi.fn().mockResolvedValue(undefined) }
    })

    const { generateReplenishmentDrafts } = await import("@/lib/services/epp-replenishment")
    await expect(generateReplenishmentDrafts(access)).resolves.toEqual({
      createdCount: 1,
      requestCodes: ["SOL-2026-0042"],
    })
    expect(mockNextCodeTx).toHaveBeenCalledWith(expect.anything(), "SOL", expect.any(Number))
    expect(mockUpdate).toHaveBeenCalledTimes(1)
  })

  it("does not create a request when every live gap is already reserved", async () => {
    mockListEppCoverageGaps.mockResolvedValue([{
      workerId: "worker-1", workerName: "Ana", worksiteId: "ws-1", position: null,
      eppTypeId: "epp-casco", eppTypeLabel: "Casco", requirementId: "requirement-1",
      enforcement: "warning", reason: "Uso obligatorio", gapType: "missing", lastDeliveredAt: null,
    }])
    mockInsert.mockReturnValue({ values: vi.fn(() => ({
      onConflictDoNothing: vi.fn(() => ({ returning: vi.fn().mockResolvedValue([]) })),
    })) })

    const { generateReplenishmentDrafts } = await import("@/lib/services/epp-replenishment")
    await expect(generateReplenishmentDrafts(access)).resolves.toEqual({ createdCount: 0, requestCodes: [] })
    expect(mockNextCodeTx).not.toHaveBeenCalled()
  })
})
