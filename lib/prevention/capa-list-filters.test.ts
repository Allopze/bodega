import { describe, expect, it } from "vitest"
import { CAPA_STATUS_LABELS } from "./capa"
import {
  CAPA_CONDITIONS,
  CAPA_OPEN_VIEW,
  buildCapaStatusCounts,
  buildCapaStatusTabs,
  capaLegacyVistaHref,
  matchesCapaQuickFilter,
  parseCapaCondition,
  parseCapaStatusView,
} from "./capa-list-filters"

const today = "2026-08-02"

const openAction = {
  status: "in_progress",
  targetDate: "2026-08-01",
  reconciliationStatus: "needs_evidence",
  requiresImmediateStop: true,
}

describe("matchesCapaQuickFilter", () => {
  it("matches the operational metric conditions", () => {
    expect(matchesCapaQuickFilter(openAction, "open", today)).toBe(true)
    expect(matchesCapaQuickFilter(openAction, "overdue", today)).toBe(true)
    expect(matchesCapaQuickFilter(openAction, "unreconciled", today)).toBe(true)
    expect(matchesCapaQuickFilter(openAction, "immediate_stop", today)).toBe(true)
    expect(matchesCapaQuickFilter(openAction, "pending_verification", today)).toBe(false)
  })

  it("does not count closed actions as open, overdue, or urgent", () => {
    const closedAction = { ...openAction, status: "closed" }
    expect(matchesCapaQuickFilter(closedAction, "open", today)).toBe(false)
    expect(matchesCapaQuickFilter(closedAction, "overdue", today)).toBe(false)
    expect(matchesCapaQuickFilter(closedAction, "immediate_stop", today)).toBe(false)
  })

  it("keeps verified actions in the open backlog but out of overdue", () => {
    const verifiedAction = { ...openAction, status: "verified" }
    expect(matchesCapaQuickFilter(verifiedAction, "open", today)).toBe(true)
    expect(matchesCapaQuickFilter(verifiedAction, "overdue", today)).toBe(false)
  })
})

describe("parseCapaStatusView", () => {
  it("acepta cada estado guardado y la vista «abiertas»", () => {
    for (const status of Object.keys(CAPA_STATUS_LABELS)) expect(parseCapaStatusView(status)).toBe(status)
    expect(parseCapaStatusView(CAPA_OPEN_VIEW)).toBe("open")
  })

  it("«todas», vacío y valores desconocidos no filtran (no llegan crudos al servidor)", () => {
    expect(parseCapaStatusView(undefined)).toBeUndefined()
    expect(parseCapaStatusView("")).toBeUndefined()
    expect(parseCapaStatusView("all")).toBeUndefined()
    expect(parseCapaStatusView("IN_PROGRESS")).toBeUndefined()
  })
})

describe("parseCapaCondition", () => {
  it("sólo reconoce las condiciones que cruzan los estados", () => {
    expect(CAPA_CONDITIONS).toEqual(["overdue", "unreconciled", "immediate_stop"])
    expect(parseCapaCondition("overdue")).toBe("overdue")
    expect(parseCapaCondition("unreconciled")).toBe("unreconciled")
    expect(parseCapaCondition("immediate_stop")).toBe("immediate_stop")
  })

  it("las vistas que ahora son un estado (abiertas, por verificar) ya no son condiciones", () => {
    expect(parseCapaCondition("open")).toBeUndefined()
    expect(parseCapaCondition("pending_verification")).toBeUndefined()
    expect(parseCapaCondition("all")).toBeUndefined()
    expect(parseCapaCondition(undefined)).toBeUndefined()
  })
})

describe("buildCapaStatusCounts", () => {
  it("rellena con cero los estados sin filas y suma el total y las abiertas", () => {
    const counts = buildCapaStatusCounts([
      { status: "pending", total: 2 },
      { status: "verified", total: 1 },
      { status: "closed", total: 4 },
      { status: "cancelled", total: 3 },
    ])

    expect(counts.total).toBe(10)
    // Abiertas = ni cerradas ni canceladas: las verificadas siguen abiertas.
    expect(counts.open).toBe(3)
    expect(counts.byStatus).toEqual({
      pending: 2, in_progress: 0, pending_verification: 0, verified: 1, closed: 4, reopened: 0, cancelled: 3,
    })
  })
})

describe("buildCapaStatusTabs", () => {
  const counts = buildCapaStatusCounts([
    { status: "pending", total: 2 },
    { status: "in_progress", total: 3 },
    { status: "pending_verification", total: 1 },
    { status: "closed", total: 4 },
  ])

  it("«Todas» y «Abiertas» primero y luego un estado por pestaña, en el orden del flujo, cada una con su contador", () => {
    const tabs = buildCapaStatusTabs(counts)

    expect(tabs.map((tab) => tab.label)).toEqual([
      "Todas", "Abiertas", "Pendiente", "En proceso", "Pendiente de verificación", "Verificada", "Cerrada", "Reabierta", "Cancelada",
    ])
    expect(tabs.map((tab) => tab.count)).toEqual([10, 6, 2, 3, 1, 0, 4, 0, 0])
  })

  it("«Todas» no lleva parámetro y el resto viaja con el valor del estado (o «open»)", () => {
    expect(buildCapaStatusTabs(counts).map((tab) => tab.value)).toEqual([
      "", "open", "pending", "in_progress", "pending_verification", "verified", "closed", "reopened", "cancelled",
    ])
  })
})

describe("capaLegacyVistaHref", () => {
  it("?vista=open y ?vista=pending_verification (antes tarjetas) pasan a la pestaña del estado y conservan los demás filtros", () => {
    expect(capaLegacyVistaHref("/prevencion/capa", { vista: "open" })).toBe("/prevencion/capa?status=open")
    expect(capaLegacyVistaHref("/prevencion/capa", { vista: "pending_verification", worksite: "ws-1", page: "2" }))
      .toBe("/prevencion/capa?worksite=ws-1&status=pending_verification")
  })

  it("si la URL ya trae un estado, manda el estado y se quita la vista legada", () => {
    expect(capaLegacyVistaHref("/prevencion/capa", { vista: "open", status: "closed" })).toBe("/prevencion/capa?status=closed")
  })

  it("las condiciones vigentes (el enlace del tablero a «vencidas» incluido) no se redirigen", () => {
    expect(capaLegacyVistaHref("/prevencion/capa", { vista: "overdue" })).toBeNull()
    expect(capaLegacyVistaHref("/prevencion/capa", { vista: "unreconciled", status: "open" })).toBeNull()
    expect(capaLegacyVistaHref("/prevencion/capa", { status: "cancelled" })).toBeNull()
    expect(capaLegacyVistaHref("/prevencion/capa", {})).toBeNull()
  })
})
