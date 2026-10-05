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

type DomainName = DteSyncHealthEvaluation["domains"][number]["name"]
type DomainSpec = [status: "healthy" | "degraded" | "critical", code: string, slot: string]

/** Evaluación con los dominios dados medidos y el resto fuera de su ventana. */
function multiDomain(measured: Partial<Record<DomainName, DomainSpec>>): DteSyncHealthEvaluation {
  const names: DomainName[] = ["purchases", "chipax_sales", "chipax_bank", "sales"]
  const domains = names.map((name) => {
    const spec = measured[name]
    return spec
      ? { name, status: spec[0], code: spec[1], slot: spec[2], expectedPeriods: ["2026-10", "2026-09"] }
      : { name, status: "not_due" as const, code: "DTE_HEALTH_NOT_DUE", slot: null, expectedPeriods: ["2026-10", "2026-09"] }
  })
  const statuses = domains.map((domain) => domain.status)
  const status = statuses.includes("critical") ? "critical" : statuses.includes("degraded") ? "degraded" : "healthy"
  return { status, code: "DTE_HEALTH_TEST", checkedAt: "2026-10-02T13:00:00.000Z", domains }
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

  // Producción, 2026-10: ventas avisaba "faltan documentos" a las 07:30 y, a las
  // 09:00, el éxito de Chipax —otro dominio, otra ventana— despachaba
  // "Sincronización DTE recuperada" aunque ventas seguía igual. Un correo falso
  // por día a cada titular de admin:dte_sync.
  it("no da por recuperado un dominio que nadie volvió a medir", () => {
    const ventasParcial = multiDomain({ sales: ["degraded", "DTE_HEALTH_INGEST_PARTIAL", "2026-10-02T07:30"] })
    const alert = decideDteHealthAlert(ventasParcial, null)!
    expect(alert.kind).toBe("alert")
    const previous = { fingerprint: alert.fingerprint, status: "degraded" as const }

    const chipaxSano = multiDomain({
      chipax_sales: ["healthy", "DTE_HEALTH_SUCCESS", "2026-10-02T09:00"],
      chipax_bank: ["healthy", "DTE_HEALTH_SUCCESS", "2026-10-02T09:00"],
    })
    expect(decideDteHealthAlert(chipaxSano, previous)).toBeNull()

    const ventasSana = multiDomain({ sales: ["healthy", "DTE_HEALTH_SUCCESS", "2026-10-03T07:30"] })
    const recovery = decideDteHealthAlert(ventasSana, previous)!
    expect(recovery.kind).toBe("recovery")
    expect(recovery.body).toMatch(/ventas/)
  })

  it("no envía recuperación mientras alguno de los dominios que avisaron siga con problema", () => {
    const chipaxCaido = multiDomain({
      chipax_sales: ["critical", "DTE_HEALTH_RUN_FAILED", "2026-10-05T09:00"],
      chipax_bank: ["critical", "DTE_HEALTH_RUN_FAILED", "2026-10-05T09:00"],
    })
    const alert = decideDteHealthAlert(chipaxCaido, null)!
    const previous = { fingerprint: alert.fingerprint, status: "critical" as const }

    const soloCartolas = multiDomain({
      chipax_sales: ["degraded", "DTE_HEALTH_INGEST_PARTIAL", "2026-10-06T09:00"],
      chipax_bank: ["healthy", "DTE_HEALTH_SUCCESS", "2026-10-06T09:00"],
    })
    expect(decideDteHealthAlert(soloCartolas, previous)?.kind).toBe("alert")
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
