import { describe, expect, it, vi } from "vitest"
import {
  getUserIdsWithPermission,
  getUserIdsWithPermissionForWorksite,
} from "@/lib/services/notification-targeting"

const mockFindFirstPerm = vi.fn()

vi.mock("@/db", () => ({
  db: {
    query: {
      permissions: {
        findFirst: (...args: unknown[]) => mockFindFirstPerm(...args),
      },
      rolePermissions: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      userPermissions: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    },
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        leftJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      }),
    }),
  },
}))

describe("Notification Targeting Service (notification-targeting.ts)", () => {
  it("returns empty array if permission does not exist", async () => {
    mockFindFirstPerm.mockResolvedValueOnce(null)

    const userIds = await getUserIdsWithPermission("non_existent_permission")

    expect(userIds).toEqual([])
  })

  it("returns empty array when worksiteId is empty", async () => {
    const userIds = await getUserIdsWithPermissionForWorksite("solicitudes.crear", "")

    expect(userIds).toEqual([])
  })
})
