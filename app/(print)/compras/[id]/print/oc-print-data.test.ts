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

describe("loadOcPrintDataOrNull authorization", () => {
  it("returns null for another worksite before loading product data", async () => {
    await expect(loadOcPrintDataOrNull("oc-1", SESSION)).resolves.toBeNull()
    expect(mockFindProducts).not.toHaveBeenCalled()
  })
})
