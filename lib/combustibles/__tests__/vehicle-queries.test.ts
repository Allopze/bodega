import type { Session } from "next-auth"
import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/auth/scope", () => ({
  worksiteScopeSql: vi.fn(() => ({ queryChunks: ["scope"] })),
}))

import { buildFuelVehiclesWhere } from "@/lib/combustibles/queries"
import { worksiteScopeSql } from "@/lib/auth/scope"

const mockWorksiteScopeSql = vi.mocked(worksiteScopeSql)

describe("buildFuelVehiclesWhere", () => {
  it("applies session worksite scoping to fuel vehicle catalog reads", () => {
    const session = {
      user: {
        id: "user-1",
        roles: ["solicitante_faena"],
        worksiteIds: ["ws-1"],
      },
    } as Session

    const where = buildFuelVehiclesWhere(session)

    expect(where).toBeDefined()
    expect(mockWorksiteScopeSql).toHaveBeenCalledOnce()
  })
})
