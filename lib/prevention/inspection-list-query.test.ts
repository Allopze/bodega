import { describe, expect, it } from "vitest"
import {
  buildInspectionExportQuery,
  inspectionSubjectTypeLabel,
  inspectionTaskStatusLabel,
  parseInspectionListQuery,
  safeNewInspectionDefaults,
} from "@/lib/prevention/inspection-list-query"

describe("inspection list query", () => {
  it("uses the same structured filters for rows, totals and export", () => {
    const parsed = parseInspectionListQuery({
      tipo: "audit",
      estado: "completed",
      faena: "ws-mininco",
      q: "  extintor  ",
      vista: "critical",
      pagina: "3",
    })

    expect(parsed).toEqual({
      page: 3,
      filter: {
        kinds: ["audit"],
        status: "completed",
        worksiteId: "ws-mininco",
        search: "extintor",
        view: "critical",
      },
    })
    expect(buildInspectionExportQuery(parsed.filter)).toBe(
      "?tipo=audit&estado=completed&faena=ws-mininco&q=extintor&vista=critical",
    )
  })

  it("drops unknown values instead of creating misleading filters", () => {
    expect(parseInspectionListQuery({
      tipo: "unknown",
      estado: "unknown",
      vista: "unknown",
      pagina: "-8",
    })).toEqual({ page: 1, filter: {} })
  })

  // I-10 (auditoría UI/UX 2026-08-25): responsable + rango de ejecución.
  it("parses the responsible and executed-date-range filters", () => {
    const parsed = parseInspectionListQuery({
      responsable: "u-prevencionista",
      desde: "2026-08-01",
      hasta: "2026-08-31",
    })
    expect(parsed.filter).toEqual({
      assignedToUserId: "u-prevencionista",
      executedFrom: "2026-08-01",
      executedTo: "2026-08-31",
    })
    expect(buildInspectionExportQuery(parsed.filter)).toBe(
      "?responsable=u-prevencionista&desde=2026-08-01&hasta=2026-08-31",
    )
  })

  it("drops a malformed date instead of silently returning zero rows", () => {
    expect(parseInspectionListQuery({ desde: "ayer", hasta: "2026/08/31" }).filter).toEqual({})
  })

  // I-31: la vista rápida "Vencidas" vive en el mismo enum que las demás.
  it("accepts the overdue quick view", () => {
    expect(parseInspectionListQuery({ vista: "overdue" }).filter).toEqual({ view: "overdue" })
  })

  it("names a completed run by the next task", () => {
    expect(inspectionTaskStatusLabel("completed")).toBe("Pendiente de revisión")
    expect(inspectionTaskStatusLabel("reviewed")).toBe("Revisada y cerrada")
  })

  it("translates known subject types without rewriting user-defined labels", () => {
    expect(inspectionSubjectTypeLabel("equipment")).toBe("Equipo")
    expect(inspectionSubjectTypeLabel("camion")).toBe("Camión")
    expect(inspectionSubjectTypeLabel("Sala eléctrica")).toBe("Sala eléctrica")
  })

  it("does not preselect a template or worksite for a global user", () => {
    expect(safeNewInspectionDefaults()).toEqual({ templateId: "", worksiteId: "", subjectRef: "_none" })
  })
})
