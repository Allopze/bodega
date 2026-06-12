import { describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => {
  const selectResults: unknown[][] = []

  function makeBuilder(rows: unknown[]) {
    const builder = {
      from: vi.fn(() => builder),
      innerJoin: vi.fn(() => builder),
      where: vi.fn(() => Promise.resolve(rows)),
    }
    return builder
  }

  return {
    selectResults,
    db: {
      query: {
        users: {
          findFirst: vi.fn(),
        },
      },
      select: vi.fn(() => makeBuilder(selectResults.shift() ?? [])),
    },
  }
})

vi.mock("@/db", () => ({ db: mocks.db }))

import { getUserRbacById } from "@/lib/auth/rbac"

describe("getUserRbacById direct permissions", () => {
  it("adds direct user permissions to permissions inherited from roles", async () => {
    mocks.db.query.users.findFirst.mockResolvedValue({
      id: "u-direct",
      name: "Direct Permissions",
      email: "direct@example.com",
      avatarColor: null,
      isActive: true,
    })
    mocks.selectResults.push(
      [{ roleId: "rol-jefa", roleName: "jefa_chome" }],
      [{ permissionName: "reports:view" }],
      [{ permissionName: "warehouse:adjust_stock" }],
      [{ worksiteId: "ws-1", isPrimary: true }],
    )

    const snapshot = await getUserRbacById("u-direct", true)

    expect(snapshot?.permissions.toSorted()).toEqual([
      "reports:view",
      "warehouse:adjust_stock",
    ])
  })
})
