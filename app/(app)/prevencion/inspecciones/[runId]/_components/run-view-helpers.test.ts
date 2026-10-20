import { describe, expect, it } from "vitest"
import type { CompletionBlocker } from "@/lib/prevention/inspections"
import type { HeldRow } from "@/lib/prevention/inspection-capture"
import {
  collectProgressGaps,
  groupProgressGaps,
  groupSectionItems,
  matrixColumnShortLabel,
  reasonIsMissing,
  recordActionsAvailability,
  resultNeedsReason,
  sectionProgressById,
} from "./run-view-helpers"
import type { ItemInfo } from "./types"

function item(id: string, matrix?: ItemInfo["matrix"]): ItemInfo {
  return { id, label: id, required: false, countsForCompliance: true, danoPotencial: null, matrix }
}

describe("groupSectionItems", () => {
  it("deja los ítems sueltos como vienen", () => {
    const blocks = groupSectionItems([item("a"), item("b")])
    expect(blocks.map((block) => block.kind)).toEqual(["item", "item"])
  })

  it("junta las celdas de una prenda en un solo bloque, en el orden de la primera aparición", () => {
    const blocks = groupSectionItems([
      item("casco_uso", { rowId: "casco", rowLabel: "Casco", columnLabel: "Usa (Sí/No/N/A)" }),
      item("casco_estado", { rowId: "casco", rowLabel: "Casco", columnLabel: "Estado (B/R/M)" }),
      item("guantes_uso", { rowId: "guantes", rowLabel: "Guantes", columnLabel: "Usa (Sí/No/N/A)" }),
      item("nota"),
      item("guantes_estado", { rowId: "guantes", rowLabel: "Guantes", columnLabel: "Estado (B/R/M)" }),
    ])
    expect(blocks.map((block) => block.kind === "matrix" ? `matrix:${block.rowId}:${block.items.map((cell) => cell.id).join("+")}` : `item:${block.item.id}`)).toEqual([
      "matrix:casco:casco_uso+casco_estado",
      "matrix:guantes:guantes_uso+guantes_estado",
      "item:nota",
    ])
  })
})

describe("matrixColumnShortLabel", () => {
  it.each([
    ["Usa (Sí/No/N/A)", "Usa"],
    ["Estado (B/R/M)", "Estado"],
    ["Registro (Sí/No)", "Registro"],
    ["Sin paréntesis", "Sin paréntesis"],
  ])("%s → %s", (input, expected) => expect(matrixColumnShortLabel(input)).toBe(expected))
})

describe("motivo", () => {
  it("los tres resultados que explican piden motivo", () => {
    expect(["not_applicable", "partial", "non_conforming"].every(resultNeedsReason)).toBe(true)
    expect(["conforming", "recorded", ""].some(resultNeedsReason)).toBe(false)
  })

  it("falta si es más corto que el mínimo, con los espacios recortados", () => {
    expect(reasonIsMissing({ result: "non_conforming", comment: "  a " })).toBe(true)
    expect(reasonIsMissing({ result: "non_conforming", comment: "ok!" })).toBe(false)
    expect(reasonIsMissing({ result: "conforming", comment: "" })).toBe(false)
  })
})

describe("qué falta para declarar ejecutada", () => {
  const blocker = (kind: CompletionBlocker["kind"], itemId?: string): CompletionBlocker => ({
    kind, detail: itemId ?? "Acta", ...(itemId ? { sectionId: "s", itemId } : {}),
  })
  const itemKeys = ["s::a", "s::b", "s::c", "s::d", "s::e"]

  it("agrupa por naturaleza y cada grupo apunta al primer ítem, en el orden de la inspección", () => {
    const gaps = collectProgressGaps({
      blockers: [
        blocker("missing_required", "e"),
        blocker("missing_required", "b"),
        blocker("missing_nc_reason", "d"),
        blocker("unconfirmed_critical", "c"),
        blocker("missing_closing_act"),
      ],
      held: [],
      itemKeys,
      drafts: {},
    })
    expect(groupProgressGaps(gaps).map((group) => [group.label, group.firstKey])).toEqual([
      ["2 sin responder", "s::b"],
      ["1 sin motivo", "s::d"],
      ["1 por confirmar", "s::c"],
      ["acta incompleta", null],
    ])
  })

  it("una fila retenida a la que le falta el motivo cuenta como «sin motivo» y no se repite con su impedimento", () => {
    const held: HeldRow[] = [{ key: "s::a", reason: "invalid", problem: "«a»: un «No cumple» exige indicar el motivo." }]
    const gaps = collectProgressGaps({
      blockers: [blocker("missing_nc_reason", "a")],
      held,
      itemKeys,
      drafts: { "s::a": { result: "non_conforming", comment: "" } },
    })
    expect(gaps).toHaveLength(1)
    expect(groupProgressGaps(gaps)).toEqual([expect.objectContaining({ kind: "no_reason", count: 1, firstKey: "s::a" })])
  })

  it("una fila retenida por otra razón queda «por corregir»", () => {
    const gaps = collectProgressGaps({
      blockers: [],
      held: [{ key: "s::b", reason: "unanswer_with_photos", problem: "Quita primero sus fotos." }],
      itemKeys,
      drafts: { "s::b": { result: "", comment: "" } },
    })
    expect(groupProgressGaps(gaps).map((group) => group.label)).toEqual(["1 por corregir"])
  })

  it("sin nada pendiente no hay grupos", () => {
    expect(groupProgressGaps(collectProgressGaps({ blockers: [], held: [], itemKeys, drafts: {} }))).toEqual([])
  })
})

describe("recordActionsAvailability", () => {
  const both = { canReview: true, canManage: true }
  it.each([
    ["planned", both, { pdf: false, reopen: false, cancel: true }],
    ["in_progress", both, { pdf: false, reopen: false, cancel: true }],
    ["completed", both, { pdf: true, reopen: true, cancel: true }],
    ["reviewed", both, { pdf: true, reopen: true, cancel: false }],
    ["cancelled", both, { pdf: false, reopen: false, cancel: false }],
    ["completed", { canReview: false, canManage: false }, { pdf: true, reopen: false, cancel: false }],
  ])("%s con %j", (status, permissions, expected) => {
    expect(recordActionsAvailability(status, permissions)).toEqual(expected)
  })
})

describe("sectionProgressById", () => {
  it("cuenta las respuestas del borrador por sección", () => {
    const progress = sectionProgressById(
      [{ id: "s1", items: [{ id: "a" }, { id: "b" }] }, { id: "s2", items: [{ id: "c" }] }],
      { "s1::a": { result: "conforming" }, "s1::b": { result: "" } },
    )
    expect(progress).toEqual({ s1: { answered: 1, total: 2 }, s2: { answered: 0, total: 1 } })
  })
})
