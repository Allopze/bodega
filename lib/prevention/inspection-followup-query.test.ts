import { describe, expect, it } from "vitest"
import {
  FOLLOWUP_STATUS_LABELS,
  FOLLOWUP_STATUSES,
  buildInspectionFollowupExportQuery,
  compareByAttention,
  followupDaysOverdue,
  followupFilterIsActive,
  followupStatusOf,
  parseInspectionFollowupQuery,
  type FollowupStatus,
} from "@/lib/prevention/inspection-followup-query"

const TODAY = "2026-10-20"

describe("parseInspectionFollowupQuery", () => {
  it("lee estado, tipo, faena y texto, y recorta el texto", () => {
    expect(parseInspectionFollowupQuery({ estado: "vencidas", tipo: "audit", faena: "ws-1", q: "  extintor  " })).toEqual({
      status: "vencidas",
      kind: "audit",
      worksiteId: "ws-1",
      search: "extintor",
    })
  })

  it("descarta valores que no existen en vez de crear filtros que no devuelven nada", () => {
    expect(parseInspectionFollowupQuery({ estado: "inventado", tipo: "otro", faena: "  ", q: "" })).toEqual({})
  })

  it("acepta URLSearchParams y toma el primer valor de una clave repetida", () => {
    expect(parseInspectionFollowupQuery(new URLSearchParams("estado=sin_capa&faena=ws-2"))).toEqual({ status: "sin_capa", worksiteId: "ws-2" })
    expect(parseInspectionFollowupQuery({ estado: ["abiertas", "cerradas"] })).toEqual({ status: "abiertas" })
  })

  it("reconoce los cuatro estados, y cada uno tiene su etiqueta en español", () => {
    for (const status of FOLLOWUP_STATUSES) {
      expect(parseInspectionFollowupQuery({ estado: status })).toEqual({ status })
    }
    expect(FOLLOWUP_STATUS_LABELS).toEqual({
      sin_capa: "Sin acción CAPA",
      abiertas: "Abiertas",
      vencidas: "Vencidas",
      cerradas: "Cerradas",
    })
  })
})

describe("buildInspectionFollowupExportQuery", () => {
  it("lleva en el enlace exactamente los filtros que la pantalla leyó", () => {
    const filter = parseInspectionFollowupQuery({ estado: "vencidas", tipo: "observation", faena: "ws-1", q: "sello roto", basura: "x" })
    const query = buildInspectionFollowupExportQuery(filter)

    expect(query).toBe("?estado=vencidas&tipo=observation&faena=ws-1&q=sello+roto")
    // Ida y vuelta: lo que descarga es lo que ve.
    expect(parseInspectionFollowupQuery(new URLSearchParams(query))).toEqual(filter)
  })

  it("sin filtros no agrega query", () => {
    expect(buildInspectionFollowupExportQuery({})).toBe("")
  })
})

describe("followupFilterIsActive", () => {
  it("distingue «aún no hay hallazgos» de «no hay con estos filtros»", () => {
    expect(followupFilterIsActive({})).toBe(false)
    expect(followupFilterIsActive({ search: "x" })).toBe(true)
    expect(followupFilterIsActive({ status: "cerradas" })).toBe(true)
    expect(followupFilterIsActive({ worksiteId: "ws-1" })).toBe(true)
    expect(followupFilterIsActive({ kind: "audit" })).toBe(true)
  })
})

describe("followupStatusOf", () => {
  const row = (over: Partial<Parameters<typeof followupStatusOf>[0]> = {}) => ({
    actionId: "act-1",
    capaStatus: "in_progress",
    targetDate: "2026-11-02",
    findingStatus: "capa_linked",
    ...over,
  })

  it("un hallazgo sin acción CAPA y sin cerrar nadie se lo ha tomado", () => {
    expect(followupStatusOf(row({ actionId: null, capaStatus: null, targetDate: null, findingStatus: "open" }), TODAY)).toBe("sin_capa")
  })

  it("un hallazgo cerrado sin derivar a CAPA está resuelto, no «sin acción»", () => {
    expect(followupStatusOf(row({ actionId: null, capaStatus: null, targetDate: null, findingStatus: "closed" }), TODAY)).toBe("cerradas")
  })

  it("una acción viva con plazo por delante está abierta; vencida si el plazo ya pasó", () => {
    expect(followupStatusOf(row(), TODAY)).toBe("abiertas")
    expect(followupStatusOf(row({ targetDate: "2026-10-19" }), TODAY)).toBe("vencidas")
  })

  it("el plazo de hoy todavía no está vencido", () => {
    expect(followupStatusOf(row({ targetDate: TODAY }), TODAY)).toBe("abiertas")
  })

  it("verificada, cerrada o cancelada ya no se ejecuta, aunque su plazo haya pasado", () => {
    for (const capaStatus of ["verified", "closed", "cancelled"]) {
      expect(followupStatusOf(row({ capaStatus, targetDate: "2026-01-01" }), TODAY)).toBe("cerradas")
    }
  })

  it("pendiente de verificación sigue siendo trabajo abierto, y vence como cualquier otra", () => {
    expect(followupStatusOf(row({ capaStatus: "pending_verification" }), TODAY)).toBe("abiertas")
    expect(followupStatusOf(row({ capaStatus: "pending_verification", targetDate: "2026-09-01" }), TODAY)).toBe("vencidas")
  })
})

describe("compareByAttention", () => {
  const item = (followupStatus: FollowupStatus, targetDate: string | null = null) => ({ followupStatus, targetDate })

  it("ordena vencidas, luego sin acción CAPA, luego abiertas y al final cerradas", () => {
    const shuffled = [item("cerradas"), item("abiertas", "2026-12-01"), item("sin_capa"), item("vencidas", "2026-10-01")]
    expect([...shuffled].sort(compareByAttention).map((entry) => entry.followupStatus)).toEqual(["vencidas", "sin_capa", "abiertas", "cerradas"])
  })

  it("entre vencidas va primera la más atrasada, y entre abiertas la que vence antes", () => {
    const vencidas = [item("vencidas", "2026-10-15"), item("vencidas", "2026-09-01"), item("vencidas", "2026-10-19")]
    expect(vencidas.sort(compareByAttention).map((entry) => entry.targetDate)).toEqual(["2026-09-01", "2026-10-15", "2026-10-19"])
    const abiertas = [item("abiertas", "2026-12-01"), item("abiertas", "2026-10-25")]
    expect(abiertas.sort(compareByAttention).map((entry) => entry.targetDate)).toEqual(["2026-10-25", "2026-12-01"])
  })

  it("dentro de sin acción CAPA y de cerradas conserva el orden de llegada (el sort es estable)", () => {
    const withTag = (tag: string, status: FollowupStatus) => ({ ...item(status), tag })
    const sinCapa = [withTag("a", "sin_capa"), withTag("b", "sin_capa"), withTag("c", "sin_capa")]
    expect(sinCapa.sort(compareByAttention).map((entry) => entry.tag)).toEqual(["a", "b", "c"])
  })
})

describe("followupDaysOverdue", () => {
  it("cuenta días calendario desde el plazo hasta hoy", () => {
    expect(followupDaysOverdue("2026-10-19", TODAY)).toBe(1)
    expect(followupDaysOverdue("2026-10-08", TODAY)).toBe(12)
    // Cruza el fin de año sin perder un día.
    expect(followupDaysOverdue("2025-12-31", "2026-01-02")).toBe(2)
  })

  it("no es negativo ni cuenta el día del plazo: vence recién al día siguiente", () => {
    expect(followupDaysOverdue(TODAY, TODAY)).toBe(0)
    expect(followupDaysOverdue("2026-11-02", TODAY)).toBe(0)
    expect(followupDaysOverdue(null, TODAY)).toBe(0)
  })
})
