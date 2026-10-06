import { describe, expect, it } from "vitest"
import type { OperationalQueueResult } from "@/lib/services/operational-work-queue"
import type { Permission } from "@/modules/permissions"
import { resolveQuickActions } from "./dashboard-quick-actions"
import type { DashboardScope } from "./dashboard-scope"

const scope: DashboardScope = { worksiteId: "all", worksiteName: null, period: "mes", view: "resumen" }

function summary(over: Partial<OperationalQueueResult["summary"]> = {}, moduleCounts: OperationalQueueResult["summary"]["moduleCounts"] = {}) {
  return { all: 0, critical: 0, overdue: 0, today: 0, blocked: 0, unassigned: 0, mine: 0, ...over, moduleCounts }
}

const grant = (...permissions: Permission[]) => (permission: Permission) => permissions.includes(permission)

describe("resolveQuickActions — la primaria se calcula", () => {
  it("con 215 vencidas y 1 aprobación, la primaria son las vencidas, no las aprobaciones", () => {
    const { primary } = resolveQuickActions({
      can: grant("operations:view_work", "approvals:approve"),
      scope,
      summary: summary({ overdue: 215, critical: 4 }, { aprobaciones: 1 }),
    })

    expect(primary).toEqual({ key: "overdue", label: "Ver 215 vencidas", href: "/pendientes?quick=overdue" })
  })

  it("conserva la faena del alcance en el destino", () => {
    const { primary } = resolveQuickActions({
      can: grant("operations:view_work"),
      scope: { ...scope, worksiteId: "ws-sur" },
      summary: summary({ overdue: 3 }),
    })

    expect(primary?.href).toBe("/pendientes?quick=overdue&worksiteId=ws-sur")
  })

  it("elige el grupo accionable más grande que el usuario puede atender", () => {
    const { primary } = resolveQuickActions({
      can: grant("operations:view_work", "approvals:approve"),
      scope,
      summary: summary({ overdue: 2, critical: 1 }, { aprobaciones: 9 }),
    })

    expect(primary).toEqual({ key: "approvals", label: "Revisar 9 aprobaciones", href: "/aprobaciones" })
  })

  it("no ofrece lo que no puede atender: sin permiso de aprobar, no hay aprobaciones", () => {
    const { primary } = resolveQuickActions({
      can: grant("operations:view_work"),
      scope,
      summary: summary({ overdue: 2 }, { aprobaciones: 50 }),
    })

    expect(primary?.key).toBe("overdue")
  })

  it("singular con una sola", () => {
    const { primary } = resolveQuickActions({ can: grant("operations:view_work"), scope, summary: summary({ overdue: 1 }) })

    expect(primary?.label).toBe("Ver 1 vencida")
  })
})

describe("resolveQuickActions — fallback y Más acciones", () => {
  it("sin pendientes cae a la lógica histórica: aprobaciones primero", () => {
    const { primary, more } = resolveQuickActions({
      can: grant("approvals:approve", "requests:create", "purchasing:create_order"),
      scope,
      summary: summary(),
    })

    expect(primary).toEqual({ key: "approvals", label: "Revisar aprobaciones", href: "/aprobaciones" })
    expect(more.map((action) => action.key)).toEqual(["new-request", "new-oc"])
  })

  it("sin aprobar, la primaria es la alta de solicitud", () => {
    const { primary } = resolveQuickActions({ can: grant("requests:create"), scope, summary: summary() })

    expect(primary?.key).toBe("new-request")
  })

  it("sin ningún permiso no hay acción", () => {
    expect(resolveQuickActions({ can: grant(), scope, summary: summary() }).primary).toBeNull()
  })

  it("Más acciones sólo trae altas reales, no navegación del sidebar", () => {
    const everything = grant(
      "operations:view_work", "approvals:approve", "requests:create", "purchasing:create_order",
      "analytics:view", "prevention:pdtp:view", "receiving:view", "deliveries:view", "warehouse:view_stock", "reports:view",
    )
    const { more } = resolveQuickActions({ can: everything, scope, summary: summary({ overdue: 5 }) })

    expect(more.map((action) => action.key)).toEqual(["new-request", "new-oc"])
    expect(more.map((action) => action.label)).toEqual(["Nueva solicitud", "Nueva OC"])
  })
})
