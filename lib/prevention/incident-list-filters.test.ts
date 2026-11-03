import { describe, expect, it } from "vitest"
import {
  INCIDENT_CONDITIONS,
  INCIDENT_OPEN_VIEW,
  buildIncidentStatusCounts,
  buildIncidentStatusTabs,
  incidentLegacyQuickHref,
  parseIncidentCondition,
  parseIncidentStatusView,
} from "./incident-list-filters"
import { INCIDENT_STATUS_LABELS } from "./incidents"

describe("parseIncidentStatusView", () => {
  it("acepta cada estado guardado y la vista «abiertos»", () => {
    for (const status of Object.keys(INCIDENT_STATUS_LABELS)) expect(parseIncidentStatusView(status)).toBe(status)
    expect(parseIncidentStatusView(INCIDENT_OPEN_VIEW)).toBe("open")
  })

  it("«todos», vacío y valores desconocidos no filtran (no llegan crudos al servidor)", () => {
    expect(parseIncidentStatusView(undefined)).toBeUndefined()
    expect(parseIncidentStatusView("")).toBeUndefined()
    expect(parseIncidentStatusView("all")).toBeUndefined()
    expect(parseIncidentStatusView("SUBMITTED")).toBeUndefined()
  })
})

describe("parseIncidentCondition", () => {
  it("sólo reconoce las condiciones que cruzan los estados", () => {
    expect(INCIDENT_CONDITIONS).toEqual(["overdue", "fatal"])
    expect(parseIncidentCondition("overdue")).toBe("overdue")
    expect(parseIncidentCondition("fatal")).toBe("fatal")
  })

  it("las vistas retiradas del filtro rápido (abiertos, por investigar) ya no son condiciones", () => {
    expect(parseIncidentCondition("open")).toBeUndefined()
    expect(parseIncidentCondition("investigation")).toBeUndefined()
    expect(parseIncidentCondition("all")).toBeUndefined()
    expect(parseIncidentCondition(undefined)).toBeUndefined()
  })
})

describe("buildIncidentStatusCounts", () => {
  it("rellena con cero los estados sin filas y suma el total y los abiertos", () => {
    const counts = buildIncidentStatusCounts([
      { status: "reported", total: 2 },
      { status: "under_investigation", total: 3 },
      { status: "closed", total: 5 },
    ])

    expect(counts.total).toBe(10)
    expect(counts.open).toBe(5)
    expect(counts.byStatus).toEqual({
      reported: 2, triage: 0, immediate_measures: 0, under_investigation: 3,
      pending_capa: 0, pending_verification: 0, closed: 5,
    })
  })

  it("un estado desconocido cuenta en el total y en abiertos (igual que `status <> closed`), sin pestaña propia", () => {
    const counts = buildIncidentStatusCounts([{ status: "legacy_state", total: 1 }, { status: "closed", total: 2 }])

    expect(counts.total).toBe(3)
    expect(counts.open).toBe(1)
    expect(Object.keys(counts.byStatus)).not.toContain("legacy_state")
  })
})

describe("buildIncidentStatusTabs", () => {
  const counts = buildIncidentStatusCounts([
    { status: "reported", total: 2 },
    { status: "triage", total: 1 },
    { status: "under_investigation", total: 3 },
    { status: "closed", total: 5 },
  ])

  it("«Todos» y «Abiertos» primero y luego un estado por pestaña, en el orden del flujo, cada una con su contador", () => {
    const tabs = buildIncidentStatusTabs(counts)

    expect(tabs.map((tab) => tab.label)).toEqual([
      "Todos", "Abiertos", "Reportado", "En triage", "Medidas inmediatas", "En investigación",
      "Pendiente CAPA", "Pendiente verificación", "Cerrado",
    ])
    expect(tabs.map((tab) => tab.count)).toEqual([11, 6, 2, 1, 0, 3, 0, 0, 5])
  })

  it("«Todos» no lleva parámetro y el resto viaja con el valor del estado (o «open»)", () => {
    const tabs = buildIncidentStatusTabs(counts)

    expect(tabs.map((tab) => tab.value)).toEqual([
      "", "open", "reported", "triage", "immediate_measures", "under_investigation",
      "pending_capa", "pending_verification", "closed",
    ])
  })

  it("ninguna pestaña muestra el valor crudo del enum como rótulo", () => {
    for (const tab of buildIncidentStatusTabs(counts)) expect(tab.label).not.toMatch(/_/)
  })
})

describe("incidentLegacyQuickHref", () => {
  it("?quick=open (enlace del tablero) pasa a la pestaña «Abiertos» y conserva los demás filtros", () => {
    expect(incidentLegacyQuickHref("/prevencion/incidentes", { quick: "open" })).toBe("/prevencion/incidentes?status=open")
    expect(incidentLegacyQuickHref("/prevencion/incidentes", { quick: "open", worksiteId: "ws-1", year: "2026" }))
      .toBe("/prevencion/incidentes?worksiteId=ws-1&year=2026&status=open")
  })

  it("si la URL ya trae un estado, manda el estado y se quita el filtro rápido legado", () => {
    expect(incidentLegacyQuickHref("/prevencion/incidentes", { quick: "open", status: "closed" }))
      .toBe("/prevencion/incidentes?status=closed")
  })

  it("las condiciones vigentes y la ausencia de filtro rápido no se redirigen", () => {
    expect(incidentLegacyQuickHref("/prevencion/incidentes", { quick: "overdue" })).toBeNull()
    expect(incidentLegacyQuickHref("/prevencion/incidentes", { quick: "fatal", status: "open" })).toBeNull()
    expect(incidentLegacyQuickHref("/prevencion/incidentes", {})).toBeNull()
    expect(incidentLegacyQuickHref("/prevencion/incidentes", { status: "closed" })).toBeNull()
  })

  it("ignora los valores repetidos o vacíos de la URL sin fallar", () => {
    expect(incidentLegacyQuickHref("/prevencion/incidentes", { quick: ["open", "fatal"], eventType: undefined }))
      .toBe("/prevencion/incidentes?status=open")
  })
})
