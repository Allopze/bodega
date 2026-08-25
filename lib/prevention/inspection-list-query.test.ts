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
