import { describe, expect, it } from "vitest"
import {
  buildNoteInput, changeWorkOrder, changeWorksite, defaultCharge, hasContent, newDraft, newLine, parseQuantity, pruneBlankLines, validateDraft,
  type NoteDraft,
} from "./new-note-draft"
import { NEW_NOTE_OPTIONS as OPTIONS, SINGLE_WORKSITE_OPTIONS } from "./new-note-fixtures"

const filled = (draft: NoteDraft, patch: Partial<NoteDraft["lines"][number]> = {}): NoteDraft => ({
  ...draft,
  clientOpId: "op-12345678",
  lines: [{ ...draft.lines[0]!, description: "Filtro de aceite", quantity: "2", ...patch }],
})

describe("borrador de una nota nueva", () => {
  it("con varias faenas en el alcance no elige ninguna; con una sola, la deja fija", () => {
    expect(newDraft(OPTIONS).worksiteId).toBe("")
    expect(newDraft(SINGLE_WORKSITE_OPTIONS).worksiteId).toBe("ws-1")
  })

  it("una OT del enlace fija su faena y su equipo pasa a ser el cargo de la primera línea; un id ajeno se ignora", () => {
    const fromOrder = newDraft(OPTIONS, { workOrderId: "ot-2" })
    expect(fromOrder).toMatchObject({ worksiteId: "ws-2", workOrderId: "ot-2" })
    expect(fromOrder.lines[0]!.charge).toBe("v:v-2")
    expect(newDraft(OPTIONS, { workOrderId: "ot-x", worksiteId: "ws-x" })).toMatchObject({ worksiteId: "", workOrderId: "" })
  })

  it("cambiar de faena suelta la OT y el cargo de la faena anterior, y deja lo que sigue valiendo", () => {
    const draft = newDraft(OPTIONS, { workOrderId: "ot-1" })
    const manual = { ...draft, lines: [...draft.lines, { ...newLine("l2"), charge: "c:cc-1" }] }
    const moved = changeWorksite(manual, "ws-2", OPTIONS)
    expect(moved).toMatchObject({ worksiteId: "ws-2", workOrderId: "" })
    expect(moved.lines.map((line) => line.charge)).toEqual(["", ""])
    // Mismo cargo en la misma faena: se conserva.
    expect(changeWorksite(manual, "ws-1", OPTIONS)).toBe(manual)
  })

  it("elegir una OT pone su equipo como cargo de las líneas sin cargo y no pisa un cargo puesto a mano", () => {
    const base = { ...newDraft(OPTIONS), worksiteId: "ws-1" }
    const draft = { ...base, lines: [newLine("l1"), { ...newLine("l2"), charge: "c:cc-1" }] }
    const withOrder = changeWorkOrder(draft, "ot-1", OPTIONS)
    expect(withOrder.workOrderId).toBe("ot-1")
    expect(withOrder.lines.map((line) => line.charge)).toEqual(["v:v-1", "c:cc-1"])
    // Al quitar la OT, sólo se suelta el cargo que ella había puesto.
    expect(changeWorkOrder(withOrder, "", OPTIONS).lines.map((line) => line.charge)).toEqual(["", "c:cc-1"])
  })

  it("si el equipo de la OT ya no está en su faena (traslado), no se ofrece como cargo: el servidor lo rechazaría", () => {
    const moved = { ...OPTIONS, vehicles: OPTIONS.vehicles.map((item) => (item.id === "v-1" ? { ...item, worksiteId: "ws-2" } : item)) }
    expect(defaultCharge(moved, "ot-1")).toBe("")
    expect(defaultCharge(OPTIONS, "ot-1")).toBe("v:v-1")
  })

  it("lo que vale la pena guardar: una faena elegida o una línea intacta no cuentan", () => {
    expect(hasContent(newDraft(SINGLE_WORKSITE_OPTIONS))).toBe(false)
    expect(hasContent({ ...newDraft(OPTIONS), urgent: true })).toBe(true)
    expect(hasContent(filled(newDraft(OPTIONS)))).toBe(true)
  })
})

describe("validación y envío", () => {
  it.each([
    ["2", 2], ["1,5", 1.5], [" 3.25 ", 3.25], ["100000", 100000],
  ])("la cantidad «%s» vale %s", (text, value) => expect(parseQuantity(text)).toBe(value))

  it.each(["", "0", "-1", "abc", "1,2,3", "100001", "1e3"])("la cantidad «%s» no vale", (text) => expect(parseQuantity(text)).toBeNull())

  it("sin faena, sin descripción o sin cantidad dice qué falta, línea por línea", () => {
    const draft = { ...newDraft(OPTIONS), lines: [{ ...newLine("l1"), description: "ab", quantity: "0" }, { ...newLine("l2"), description: "Bomba", quantity: "1" }] }
    expect(validateDraft(draft)).toEqual({
      worksiteId: "Elige la faena.",
      "lines.0.description": "Describe el repuesto (al menos 3 letras).",
      "lines.0.quantity": "Indica una cantidad mayor que cero.",
    })
    expect(validateDraft(filled(newDraft(SINGLE_WORKSITE_OPTIONS)))).toEqual({})
    expect(validateDraft(newDraft(SINGLE_WORKSITE_OPTIONS))).toMatchObject({ lines: "Agrega al menos un repuesto." })
  })

  it("las líneas vacías se quitan antes de validar (siempre queda una) y los índices de error son los de la pantalla", () => {
    const draft = { ...newDraft(SINGLE_WORKSITE_OPTIONS), lines: [{ ...newLine("l1"), description: "Filtro", quantity: "1" }, newLine("l2"), newLine("l3")] }
    expect(pruneBlankLines(draft).lines.map((line) => line.key)).toEqual(["l1"])
    const empty = { ...draft, lines: [newLine("l1"), newLine("l2")] }
    expect(pruneBlankLines(empty).lines).toHaveLength(1)
    const intact = filled(draft)
    expect(pruneBlankLines(intact)).toBe(intact)
  })

  it("arma lo que recibe el servidor: número, cargo en su columna, repuesto del catálogo y valores vacíos como nulos", () => {
    const part = { id: "p-1", sku: "RPT-1", name: "Filtro de aceite", partNumber: "1R-0750", partBrand: "CAT", unitOfMeasure: "unidad" }
    const draft = {
      ...newDraft(OPTIONS, { workOrderId: "ot-1" }),
      clientOpId: "op-12345678",
      urgent: true,
      notes: "  Para mañana  ",
      lines: [
        { ...newLine("l1", "v:v-1"), description: " Filtro de aceite ", quantity: "1,5", part, partNumber: "1R-0750", supplierId: "sup-1" },
        { ...newLine("l2", "c:cc-1"), description: "Guantes", quantity: "10", unit: "par" },
      ],
    }
    expect(buildNoteInput(draft)).toEqual({
      clientOpId: "op-12345678",
      worksiteId: "ws-1",
      workOrderId: "ot-1",
      urgent: true,
      notes: "Para mañana",
      lines: [
        { description: "Filtro de aceite", quantity: 1.5, unitOfMeasure: "unidad", partNumber: "1R-0750", productId: "p-1", chargeVehicleId: "v-1", chargeCostCenterId: null, suggestedSupplierId: "sup-1" },
        { description: "Guantes", quantity: 10, unitOfMeasure: "par", partNumber: null, productId: null, chargeVehicleId: null, chargeCostCenterId: "cc-1", suggestedSupplierId: null },
      ],
    })
    expect(buildNoteInput({ ...draft, workOrderId: "", notes: " " })).toMatchObject({ workOrderId: null, notes: null })
  })
})
