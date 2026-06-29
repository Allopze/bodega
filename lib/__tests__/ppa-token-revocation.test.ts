import { beforeEach, describe, expect, it, vi } from "vitest"

const mockLimit = vi.hoisted(() => vi.fn())
const mockWhere = vi.hoisted(() => vi.fn(() => ({ limit: mockLimit })))
const mockSecondLeftJoin = vi.hoisted(() => vi.fn(() => ({ where: mockWhere })))
const mockFirstLeftJoin = vi.hoisted(() => vi.fn(() => ({ leftJoin: mockSecondLeftJoin })))
const mockFrom = vi.hoisted(() => vi.fn(() => ({ leftJoin: mockFirstLeftJoin })))
const mockSelect = vi.hoisted(() => vi.fn(() => ({ from: mockFrom })))

vi.mock("@/db", () => ({
  db: {
    select: mockSelect,
  },
}))

vi.mock("@/lib/services/notifications", () => ({
  getUserIdsWithPermission: vi.fn(),
  notifyAfterCommit: vi.fn(),
  notifyManyUser: vi.fn(),
}))

vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn() },
}))

import { getPpaByToken } from "@/lib/services/ppa"

describe("getPpaByToken", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns null when the permanent public token was manually revoked", async () => {
    mockLimit.mockResolvedValueOnce([
      {
        submission: {
          id: "ppa-1",
          publicToken: "tok-revoked",
          publicTokenRevokedAt: "2026-06-28T12:00:00.000Z",
          worksiteId: "ws-1",
          workerName: "Trabajador Prueba",
        },
        worksiteName: "Faena",
        supervisor: "Supervisor",
        prevencionista: "Prevencionista",
      },
    ])

    await expect(getPpaByToken("tok-revoked")).resolves.toBeNull()
  })
})
