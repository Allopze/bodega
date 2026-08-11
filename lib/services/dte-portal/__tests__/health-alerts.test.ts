import { beforeEach, describe, expect, it, vi } from "vitest"
import type { DteSyncHealthEvaluation } from "../health"

const mocks = vi.hoisted(() => ({
  stateRows: vi.fn(),
  insertValues: vi.fn(),
  getUserIdsWithPermission: vi.fn(),
  createNotifications: vi.fn(),
}))

vi.mock("@/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ limit: () => mocks.stateRows() }) }) }),
    insert: () => ({ values: (...args: unknown[]) => {
      mocks.insertValues(...args)
      return { onConflictDoUpdate: vi.fn() }
    } }),
  },
}))
vi.mock("@/lib/services/notification-targeting", () => ({
  getUserIdsWithPermission: (...args: unknown[]) => mocks.getUserIdsWithPermission(...args),
}))
vi.mock("@/lib/services/notification-create", () => ({
  createNotifications: (...args: unknown[]) => mocks.createNotifications(...args),
}))

const { decideDteHealthAlert, notifyDteSyncHealthChange } = await import("../health-alerts")

function evaluation(status: DteSyncHealthEvaluation["status"]): DteSyncHealthEvaluation {
  return {
    status,
    code: status === "critical" ? "DTE_HEALTH_CRITICAL" : status === "degraded" ? "DTE_HEALTH_DEGRADED" : "DTE_HEALTH_OK",
    checkedAt: "2026-08-11T11:10:00.000Z",
    domains: [{
      name: "purchases",
      status: status === "healthy" ? "healthy" : status,
      code: "DTE_HEALTH_TEST",
      slot: "2026-08-11T07:00",
      expectedPeriods: ["2026-08", "2026-07"],
    }],
  }
}

describe("DTE health alert delivery", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.stateRows.mockResolvedValue([])
    mocks.getUserIdsWithPermission.mockResolvedValue(["admin-1", "manager-2"])
    mocks.createNotifications.mockResolvedValue(undefined)
    mocks.insertValues.mockReturnValue(undefined)
  })

  it("targets only the DTE permission audience and persists a redacted alert state", async () => {
    await notifyDteSyncHealthChange(evaluation("critical"))

    expect(mocks.getUserIdsWithPermission).toHaveBeenCalledWith("admin:dte_sync")
    expect(mocks.createNotifications).toHaveBeenCalledWith(["admin-1", "manager-2"], expect.objectContaining({
      type: "system_alert",
      entityHref: "/admin/dte",
      dedupeKey: expect.stringMatching(/^dte-sync-health:/),
    }))
    const state = mocks.insertValues.mock.calls[0]?.[0] as { value: string }
    expect(state.value).toContain("critical")
    expect(state.value).not.toContain("rut")
    expect(state.value).not.toContain("clave")
  })

  it("deduplicates an unchanged unhealthy slot before creating notifications", async () => {
    const critical = evaluation("critical")
    const decision = decideDteHealthAlert(critical, null)!
    mocks.stateRows.mockResolvedValue([{ value: JSON.stringify({ fingerprint: decision.fingerprint, status: "critical" }) }])

    await notifyDteSyncHealthChange(critical)

    expect(mocks.createNotifications).not.toHaveBeenCalled()
    expect(mocks.insertValues).not.toHaveBeenCalled()
  })

  it("sends recovery only after a prior unhealthy state and a measured healthy slot", async () => {
    mocks.stateRows.mockResolvedValue([{ value: JSON.stringify({ fingerprint: "critical:purchases:critical:2026-08-11T07:00", status: "critical" }) }])

    await notifyDteSyncHealthChange(evaluation("healthy"))

    expect(mocks.createNotifications).toHaveBeenCalledWith(expect.any(Array), expect.objectContaining({
      title: "Sincronización DTE recuperada",
      dedupeKey: expect.stringMatching(/^dte-sync-health:recovery:/),
    }))
  })
})
