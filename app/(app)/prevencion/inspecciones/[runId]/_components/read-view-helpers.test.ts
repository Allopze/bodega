import { describe, expect, it } from "vitest"
import {
  buildReadSection,
  classifyReadItem,
  foldedSectionLabel,
  hasAnyAnswer,
} from "./read-view-helpers"
import type { Draft, ItemInfo, ResultValue } from "./types"

const SCORABLE = { kind: "cumple_nocumple_na_obs" as const, required: false, countsForCompliance: true, danoPotencial: null }
const item = (id: string, extra: Partial<ItemInfo> = {}): ItemInfo => ({ id, label: `Ítem ${id}`, ...SCORABLE, ...extra })
const draft = (patch: Partial<Draft> = {}): Draft => ({ result: "", comment: "", value: "", needsConfirmation: false, ...patch })

describe("classifyReadItem", () => {
  it("lo que no cumple y lo que quedó a medias piden atención", () => {
    expect(classifyReadItem(item("a"), draft({ result: "non_conforming" }), 0)).toBe("non_conforming")
    expect(classifyReadItem(item("a"), draft({ result: "partial" }), 0)).toBe("partial")
  })

  it("lo conforme, lo que no aplica y lo sin responder se pliegan", () => {
    expect(classifyReadItem(item("a"), draft({ result: "conforming" }), 0)).toBe("conforming")
    expect(classifyReadItem(item("a"), draft({ result: "not_applicable" }), 0)).toBe("not_applicable")
    expect(classifyReadItem(item("a"), draft({ result: "not_present" as unknown as ResultValue }), 0)).toBe("not_applicable")
    expect(classifyReadItem(item("a"), draft(), 0)).toBe("unanswered")
  })

  it("un ítem conforme con foto sale a la vista", () => {
    expect(classifyReadItem(item("a"), draft({ result: "conforming" }), 1)).toBe("with_evidence")
  })

  it("un dato registrado es contenido y se muestra; vacío se pliega", () => {
    const dato = item("t", { kind: "text" })
    expect(classifyReadItem(dato, draft({ result: "recorded", value: "PQS" }), 0)).toBe("recorded")
    expect(classifyReadItem(dato, draft(), 0)).toBe("unanswered")
  })

  it("lo leído de la planilla sin ratificar y un resultado desconocido no se esconden", () => {
    expect(classifyReadItem(item("a"), draft({ result: "conforming", needsConfirmation: true }), 0)).toBe("unconfirmed")
    expect(classifyReadItem(item("a"), draft({ result: "algo_nuevo" as Draft["result"] }), 0)).toBe("other")
  })
})

describe("buildReadSection", () => {
  const section = { id: "s", items: [item("a"), item("b"), item("c"), item("d"), item("e", { kind: "text" })] }
  const drafts: Record<string, Draft> = {
    "s::a": draft({ result: "conforming" }),
    "s::b": draft({ result: "conforming" }),
    "s::c": draft({ result: "non_conforming", comment: "Aguja en zona roja" }),
    "s::d": draft({ result: "not_applicable", comment: "No corresponde" }),
    "s::e": draft({ result: "recorded", value: "PQS" }),
  }

  it("reparte lo que pide atención y lo plegado, y cuenta lo plegado", () => {
    const view = buildReadSection(section, drafts, () => undefined, () => null)
    expect(view.attention.map((block) => block.kind === "item" && block.entry.item.id)).toEqual(["c", "e"])
    expect(view.folded).toHaveLength(3)
    expect(view.counts).toEqual({ conforming: 2, notApplicable: 1, unanswered: 0 })
    expect(view.foldedCount).toBe(3)
  })

  it("la evidencia saca un ítem conforme del pliegue", () => {
    const view = buildReadSection(section, drafts, (key) => key === "s::a" ? [{ id: "ev", path: "p/a.jpg", caption: null }] : undefined, () => "ans-a")
    expect(view.attention.map((block) => block.kind === "item" && block.entry.item.id)).toEqual(["a", "c", "e"])
    expect(view.counts.conforming).toBe(1)
  })

  it("una prenda de matriz va junta y sale a la vista si UNA celda lo pide", () => {
    const celda = (id: string, columnLabel: string) => item(id, { matrix: { rowId: "zapato", rowLabel: "Zapato", columnLabel } })
    const matriz = { id: "m", items: [celda("zapato_uso", "Usa (Sí/No/N/A)"), celda("zapato_estado", "Estado (B/R/M)")] }
    const view = buildReadSection(matriz, {
      "m::zapato_uso": draft({ result: "conforming" }),
      "m::zapato_estado": draft({ result: "non_conforming", comment: "Suela rota" }),
    }, () => undefined, () => null)
    expect(view.attention).toHaveLength(1)
    expect(view.attention[0]).toMatchObject({ kind: "matrix", rowLabel: "Zapato" })
    expect(view.foldedCount).toBe(0)
  })
})

describe("foldedSectionLabel", () => {
  it("«{Sección} · 12 conformes», con singular y con lo demás", () => {
    expect(foldedSectionLabel("Equipo", { conforming: 12, notApplicable: 0, unanswered: 0 })).toBe("Equipo · 12 conformes")
    expect(foldedSectionLabel("Equipo", { conforming: 1, notApplicable: 0, unanswered: 0 })).toBe("Equipo · 1 conforme")
    expect(foldedSectionLabel("Equipo", { conforming: 10, notApplicable: 2, unanswered: 1 })).toBe("Equipo · 10 conformes, 2 no aplican, 1 sin responder")
    expect(foldedSectionLabel("Equipo", { conforming: 0, notApplicable: 1, unanswered: 0 })).toBe("Equipo · 1 no aplica")
  })
})

describe("hasAnyAnswer", () => {
  const sections = [{ id: "s", items: [item("a"), item("b", { kind: "text" })] }]
  it("sin una sola respuesta, no", () => {
    expect(hasAnyAnswer(sections, {})).toBe(false)
    expect(hasAnyAnswer(sections, { "s::a": draft() })).toBe(false)
  })
  it("con un resultado o un valor, sí", () => {
    expect(hasAnyAnswer(sections, { "s::a": draft({ result: "conforming" }) })).toBe(true)
    expect(hasAnyAnswer(sections, { "s::b": draft({ value: "x" }) })).toBe(true)
  })
})
