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

function evaluation(
  status: DteSyncHealthEvaluation["status"],
  domainCode = "DTE_HEALTH_TEST",
): DteSyncHealthEvaluation {
  return {
    status,
    code: status === "critical" ? "DTE_HEALTH_CRITICAL" : status === "degraded" ? "DTE_HEALTH_DEGRADED" : "DTE_HEALTH_OK",
    checkedAt: "2026-08-11T11:10:00.000Z",
    domains: [{
      name: "purchases",
      status: status === "healthy" ? "healthy" : status,
      code: domainCode,
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

  // REC-06: separar los códigos de salud no sirve de nada si el aviso los
  // aplasta de vuelta. "Faltan documentos del libro" es un incidente;
  // "conciliaciones pendientes" es el estado normal de trabajo y produce aviso
  // casi a diario: con el mismo título, cuerpo y huella, el segundo enterraba al
  // primero.
  it("distingue ingesta parcial de conciliación pendiente en título, cuerpo y huella", () => {
    const ingesta = decideDteHealthAlert(evaluation("degraded", "DTE_HEALTH_INGEST_PARTIAL"), null)!
    const conciliacion = decideDteHealthAlert(evaluation("degraded", "DTE_HEALTH_RECONCILIATION_PENDING"), null)!

    expect(ingesta.fingerprint).not.toBe(conciliacion.fingerprint)
    expect(ingesta.title).not.toBe(conciliacion.title)
    expect(ingesta.title).toMatch(/faltan documentos/i)
    expect(ingesta.body).toMatch(/compras: faltan documentos del período/i)
    expect(conciliacion.body).toMatch(/compras: quedan conciliaciones pendientes/i)
  })

  it("no deduplica una ingesta parcial contra un aviso previo de conciliación pendiente", async () => {
    const conciliacion = decideDteHealthAlert(evaluation("degraded", "DTE_HEALTH_RECONCILIATION_PENDING"), null)!
    mocks.stateRows.mockResolvedValue([{ value: JSON.stringify({ fingerprint: conciliacion.fingerprint, status: "degraded" }) }])

    await notifyDteSyncHealthChange(evaluation("degraded", "DTE_HEALTH_INGEST_PARTIAL"))

    expect(mocks.createNotifications).toHaveBeenCalledWith(expect.any(Array), expect.objectContaining({
      title: "Sincronización DTE incompleta: faltan documentos",
    }))
  })
})
