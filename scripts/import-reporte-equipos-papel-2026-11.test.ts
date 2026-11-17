import { describe, expect, it, vi } from "vitest"

vi.mock("@/db", () => ({ db: {} }))

import {
  ESTADO_ITEMS,
  buildAnswers,
  buildSignatures,
  consolidate,
  documentCaption,
  submissionId,
  type PaperReport,
} from "./import-reporte-equipos-papel-2026-11"
import { REPORTE_EQUIPOS_SECTIONS } from "@/lib/sst/definitions/reporte-equipos-sections"
import { validateAnswerRow } from "@/lib/prevention/inspections"

function report(overrides: Partial<PaperReport> = {}): PaperReport {
  return {
    pagina: 5, folio: "023353", fecha: "2026-11-02", fechaPapel: "02-11-26", equipo: "H-14", faenaPapel: "Chome Grúas",
    operador: "Operador QA", area: "Planta en general", turnoPapel: "Día", turno: "dia", hInicio: "835", hTermino: "842",
    obs: "Neumático desgastado.", combustible: "41", lavado1: null,
    fallas: [{ item: "neumaticos_llantas", origen: "marca", nota: null }],
    sinLectura: null, desviaciones: [], firmas: { entrante: true, saliente: true, supervisor: true },
    cierre: "operativo_con_observaciones", notas: [], imagen: { archivo: "p05.jpg", bytes: 1, sha256: "x" },
    ...overrides,
  }
}

const itemsById = new Map(REPORTE_EQUIPOS_SECTIONS.flatMap((section) => section.items.map((item) => [`${section.id}::${item.id}`, item])))

describe("buildAnswers", () => {
  it("responde los 19 ítems de estado y cada fila pasa la validación del motor", () => {
    const rows = buildAnswers(report())
    const estado = rows.filter((row) => row.sectionId === "estado_camion")
    expect(estado.map((row) => row.itemId)).toEqual([...ESTADO_ITEMS])
    for (const row of rows) {
      const item = itemsById.get(`${row.sectionId}::${row.itemId}`)
      expect(item, `${row.sectionId}::${row.itemId} existe en la plantilla`).toBeDefined()
      expect(validateAnswerRow({ label: item!.label, kind: item!.kind }, row)).toBeNull()
    }
  })

  it("una falla marcada queda en falla y el resto conforme", () => {
    const rows = buildAnswers(report())
    expect(rows.find((row) => row.itemId === "neumaticos_llantas")?.result).toBe("non_conforming")
    expect(rows.find((row) => row.itemId === "luces")?.result).toBe("conforming")
  })

  it("una falla que sólo viene en observaciones lo dice en el comentario", () => {
    const rows = buildAnswers(report({ fallas: [{ item: "freno_servicio", origen: "observacion", nota: "Frenos largos, favor revisar" }] }))
    expect(rows.find((row) => row.itemId === "freno_servicio")?.comment).toContain("Frenos largos")
  })

  it("lo que viene en blanco en el papel no se inventa", () => {
    const rows = buildAnswers(report({ hTermino: null, area: null, turno: null, combustible: null }))
    const ids = rows.map((row) => row.itemId)
    expect(ids).not.toContain("horometro_termino")
    expect(ids).not.toContain("area_trabajo")
    expect(ids).not.toContain("turno")
    expect(ids).not.toContain("carga_combustible")
  })

  it("un equipo fuera de servicio con la lista tachada deja N/A con motivo salvo sus fallas", () => {
    const rows = buildAnswers(report({ sinLectura: "todos", fallas: [{ item: "freno_servicio", origen: "observacion", nota: "Sin frenos" }] }))
    expect(rows.find((row) => row.itemId === "freno_servicio")?.result).toBe("non_conforming")
    const na = rows.filter((row) => row.sectionId === "estado_camion" && row.result === "not_applicable")
    expect(na).toHaveLength(ESTADO_ITEMS.length - 1)
    expect(na.every((row) => (row.comment ?? "").length > 10)).toBe(true)
  })

  it("sin folio legible queda dicho en el folio del papel", () => {
    const rows = buildAnswers(report({ folio: null }))
    expect(rows.find((row) => row.itemId === "folio_papel")?.value).toMatch(/^S\/N/)
  })
})

describe("firmas, folio y leyenda", () => {
  it("sólo registra las firmas que trae el papel", () => {
    expect(buildSignatures(report({ firmas: { entrante: false, saliente: true, supervisor: false } })).map((s) => s.role)).toEqual(["operador_saliente"])
  })
  it("el id de envío es estable por folio o página", () => {
    expect(submissionId(report())).toBe("papel-reporte-equipos-023353")
    expect(submissionId(report({ folio: null, pagina: 16 }))).toBe("papel-reporte-equipos-pag-16")
  })
  it("la leyenda de la foto cita el folio, la página y las notas", () => {
    expect(documentCaption(report({ notas: ["Nota."] }))).toContain("N° 023353")
    expect(documentCaption(report({ notas: ["Nota."] }))).toContain("Notas de transcripción: Nota.")
  })
})

describe("consolidate", () => {
  const finding = (id: string, date: string, itemId = "luces", capaRequired = false) => ({ findingId: id, vehicleId: "v1", itemId, date, folio: id, capaRequired })
  const answer = (date: string, result: string, itemId = "luces") => ({ vehicleId: "v1", itemId, date, folio: `F${date.slice(-2)}`, result })

  it("deja abierta sólo la última de una falla repetida", () => {
    const closes = consolidate(
      [finding("a", "2026-11-02"), finding("b", "2026-11-04")],
      [answer("2026-11-02", "non_conforming"), answer("2026-11-04", "non_conforming")],
    )
    expect(closes.map((close) => close.findingId)).toEqual(["a"])
    expect(closes[0]!.reason).toContain("vuelve a fallar")
  })

  it("cierra la que un reporte posterior marca normal", () => {
    const closes = consolidate([finding("a", "2026-11-02")], [answer("2026-11-02", "non_conforming"), answer("2026-11-03", "conforming")])
    expect(closes[0]!.reason).toContain("marca este ítem normal")
  })

  it("una falla que exige CAPA no se cierra porque un papel posterior la marque normal", () => {
    const closes = consolidate([finding("a", "2026-11-07", "freno_servicio", true)], [answer("2026-11-09", "conforming", "freno_servicio")])
    expect(closes).toEqual([])
  })

  it("una falla que exige CAPA sí se cierra si vuelve a fallar después, aunque haya un normal entremedio", () => {
    const closes = consolidate([finding("a", "2026-11-03", "luces", true)], [answer("2026-11-04", "conforming"), answer("2026-11-05", "non_conforming")])
    expect(closes[0]!.reason).toContain("vuelve a fallar")
  })

  it("un N/A posterior no la cierra ni otro equipo u otro ítem", () => {
    const closes = consolidate([finding("a", "2026-11-02")], [
      answer("2026-11-07", "not_applicable"),
      { ...answer("2026-11-08", "conforming"), vehicleId: "v2" },
      answer("2026-11-09", "conforming", "bocina"),
    ])
    expect(closes).toEqual([])
  })
})
