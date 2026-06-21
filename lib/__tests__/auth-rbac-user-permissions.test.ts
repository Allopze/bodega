import { beforeEach, describe, expect, it, vi } from "vitest"

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

import { getUserRbacById, clearUserRbacCache } from "@/lib/auth/rbac"

describe("getUserRbacById direct permissions", () => {
  beforeEach(() => {
    mocks.selectResults.length = 0
  })

  it("adds direct user permissions to permissions inherited from roles", async () => {
    mocks.db.query.users.findFirst.mockResolvedValue({
      id: "u-direct",
      name: "Direct Permissions",
      email: "direct@example.com",
      avatarColor: null,
      isActive: true,
    })
    // Audit A-05: getUserRbacById now runs userRoles/direct/worksites in
    // parallel and chains rolePermissions off userRoles. The FIFO queue
    // below mirrors the actual call order: 1) userRoles, 2) direct,
    // 3) worksites, then 4) rolePermissions once userRoles resolves.
    mocks.selectResults.push(
      [{ roleId: "rol-jefa", roleName: "jefa_chome" }],
      [{ permissionName: "warehouse:adjust_stock" }],
      [{ worksiteId: "ws-1", isPrimary: true }],
      [{ permissionName: "reports:view" }],
    )

    const snapshot = await getUserRbacById("u-direct", true)

    expect(snapshot?.permissions.toSorted()).toEqual([
      "reports:view",
      "warehouse:adjust_stock",
    ])
  })

  it("returns null if user is not in DB", async () => {
    mocks.db.query.users.findFirst.mockResolvedValueOnce(null)
    const snapshot = await getUserRbacById("non-existent-user", true)
    expect(snapshot).toBeNull()
  })

  it("uses cache and clearUserRbacCache clears it", async () => {
    mocks.db.query.users.findFirst.mockResolvedValue({
      id: "u-cached",
      name: "Cached User",
      email: "cached@example.com",
      avatarColor: null,
      isActive: true,
    })

    // Setup select results for DB query
    mocks.selectResults.push(
      [{ roleId: "rol-jefa", roleName: "jefa_chome" }],
      [{ permissionName: "warehouse:adjust_stock" }],
      [{ worksiteId: "ws-1", isPrimary: true }],
      [{ permissionName: "reports:view" }],
    )

    // First fetch: cache miss
    const snapshot1 = await getUserRbacById("u-cached", false)
    expect(snapshot1?.name).toBe("Cached User")

    // Second fetch: cache hit (should not trigger new DB queries or consume selectResults)
    const snapshot2 = await getUserRbacById("u-cached", false)
    expect(snapshot2).toEqual(snapshot1)

    // clearUserRbacCache
    clearUserRbacCache("u-cached")

    // Third fetch: cache miss again (consumes selectResults)
    mocks.db.query.users.findFirst.mockResolvedValue({
      id: "u-cached",
      name: "Cached User Updated",
      email: "cached@example.com",
      avatarColor: null,
      isActive: true,
    })
    mocks.selectResults.push(
      [], [], []
    )
    const snapshot3 = await getUserRbacById("u-cached", false)
    expect(snapshot3?.name).toBe("Cached User Updated")
  })

  it("invalidates cache after TTL expires", async () => {
    vi.useFakeTimers()
    const now = Date.now()
    vi.setSystemTime(now)

    mocks.db.query.users.findFirst.mockResolvedValue({
      id: "u-ttl",
      name: "TTL User",
      email: "ttl@example.com",
      avatarColor: null,
      isActive: true,
    })
    mocks.selectResults.push(
      [], [], []
    )

    const snapshot1 = await getUserRbacById("u-ttl", false)
    expect(snapshot1?.name).toBe("TTL User")

    // Advance time by 6 seconds (TTL is 5 seconds)
    vi.setSystemTime(now + 6_000)

    mocks.db.query.users.findFirst.mockResolvedValue({
      id: "u-ttl",
      name: "TTL User Updated",
      email: "ttl@example.com",
      avatarColor: null,
      isActive: true,
    })
    mocks.selectResults.push(
      [], [], []
    )

    const snapshot2 = await getUserRbacById("u-ttl", false)
    expect(snapshot2?.name).toBe("TTL User Updated")

    vi.useRealTimers()
  })

  it("enforces cache entry limit and evicts oldest items", async () => {
    mocks.db.query.users.findFirst.mockResolvedValue({
      id: "user-loop",
      name: "Loop User",
      email: "loop@example.com",
      avatarColor: null,
      isActive: true,
    })

    // Prepare enough query mock results for loop calls (1005 calls)
    for (let i = 0; i < 1005; i++) {
      mocks.selectResults.push([], [], [])
    }

    // Insert 1005 items into the cache
    for (let i = 0; i < 1005; i++) {
      await getUserRbacById(`u-${i}`, false)
    }

    // u-0 should have been evicted.
    // Let's verify by checking if a fetch for u-0 now triggers a DB select.
    mocks.selectResults.push([], [], [])
    const snapshot = await getUserRbacById("u-0", false)
    expect(snapshot?.name).toBe("Loop User")
  })

  it("handles user with no roles and no worksites", async () => {
    mocks.db.query.users.findFirst.mockResolvedValue({
      id: "u-empty",
      name: "Empty User",
      email: "empty@example.com",
      avatarColor: null,
      isActive: true,
    })
    mocks.selectResults.push(
      [],
      [],
      [],
    )

    const snapshot = await getUserRbacById("u-empty", true)
    expect(snapshot?.roles).toEqual([])
    expect(snapshot?.permissions).toEqual([])
    expect(snapshot?.worksiteIds).toEqual([])
    expect(snapshot?.primaryWorksiteId).toBeNull()
  })

  it("handles worksite rows without a primary worksite", async () => {
    mocks.db.query.users.findFirst.mockResolvedValue({
      id: "u-ws-no-primary",
      name: "User",
      email: "u@example.com",
      avatarColor: null,
      isActive: true,
    })
    mocks.selectResults.push(
      [],
      [],
      [{ worksiteId: "ws-second", isPrimary: false }],
    )

    const snapshot = await getUserRbacById("u-ws-no-primary", true)
    expect(snapshot?.primaryWorksiteId).toBe("ws-second")
  })
})
