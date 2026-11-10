import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Session } from "next-auth"

const mockFindOrder = vi.hoisted(() => vi.fn())
const mockFindProducts = vi.hoisted(() => vi.fn())
const mockCompany = vi.hoisted(() => vi.fn())

vi.mock("@/db", () => ({
  db: {
    query: {
      purchaseOrders: { findFirst: mockFindOrder },
      products: { findMany: mockFindProducts },
    },
  },
}))

vi.mock("@/lib/auth/can", async () => {
  const { canAccessWorksite } = await import("@/lib/auth/scope")
  return { canAccessWorksite }
})

vi.mock("@/lib/services/system-settings", () => ({ getCompanyProfile: mockCompany }))
vi.mock("next/navigation", () => ({ notFound: vi.fn() }))

import { loadOcPrintDataOrNull } from "./oc-print-data"

const SESSION = {
  user: {
    id: "u-1",
    permissions: ["purchasing:view"],
    roles: [],
    worksiteIds: ["w-allowed"],
    isGlobal: false,
  },
} as unknown as Session

beforeEach(() => {
  vi.clearAllMocks()
  mockCompany.mockResolvedValue({
    name: "CHOME SPA",
    rut: "",
    businessActivity: "",
    address: "",
    branchAddress: "",
    phone: "",
    email: "",
    website: "",
  })
  mockFindOrder.mockResolvedValue({
    id: "oc-1",
    code: "OC-2026-0001",
    worksiteId: "w-other",
    items: [],
    supplier: null,
    worksite: null,
  })
})

describe("loadOcPrintDataOrNull carga el equipo de la línea", () => {
  it("pide el equipo de flota y el folio de la OT además del instrumento y el colaborador (FF-7)", async () => {
    mockFindOrder.mockResolvedValue({
      id: "oc-1", code: "OC-2026-0001", worksiteId: "w-allowed", createdAt: "2026-11-09T12:00:00.000Z",
      issuedAt: null, totalAmount: 0, notes: null, items: [], supplier: null, worksite: null,
    })
    await loadOcPrintDataOrNull("oc-1", SESSION)
    const query = mockFindOrder.mock.calls[0]![0] as {
      with: { items: { with: { requestItem: { with: Record<string, unknown> } } } }
    }
    expect(Object.keys(query.with.items.with.requestItem.with)).toEqual(
      expect.arrayContaining(["equipment", "worker", "vehicle", "workOrder"]),
    )
  })
})

describe("loadOcPrintDataOrNull authorization", () => {
  it("returns null for another worksite before loading product data", async () => {
    await expect(loadOcPrintDataOrNull("oc-1", SESSION)).resolves.toBeNull()
    expect(mockFindProducts).not.toHaveBeenCalled()
  })
})
