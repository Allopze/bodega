import { describe, expect, it } from "vitest"
import { reorder, moveTo, optionsToText, textToOptions } from "./checklist-builder"
import { pdtpChecklistDefinitionSchema } from "@/lib/validation/prevention-module/pdtp"
import type { ChecklistDefinition } from "@/lib/sst/types"

const BASE_DEFINITION: ChecklistDefinition = {
  code: "c1",
  version: "01",
  revisionDate: "2026-01-01",
  title: "T1",
  tipo: "nuevo",
  legalFramework: [],
  applicableTo: "",
  sections: [
    {
      id: "s1",
      title: "Sección 1",
      items: [{ id: "i1", label: "Ítem 1", kind: "cumple_nocumple_obs" }],
    },
  ],
  closingAct: { title: "Cierre", resultOptions: [], signatureRoles: [] },
}

describe("checklist-builder: reorder", () => {
  it("mueve un elemento hacia arriba/abajo", () => {
    const list = ["a", "b", "c"]
    expect(reorder(list, 1, -1)).toEqual(["b", "a", "c"])
    expect(reorder(list, 1, 1)).toEqual(["a", "c", "b"])
  })

  it("no hace nada si el índice destino está fuera de rango", () => {
    const list = ["a", "b"]
    expect(reorder(list, 0, -1)).toEqual(list)
    expect(reorder(list, 1, 1)).toEqual(list)
  })
})

describe("checklist-builder: moveTo (drag&drop)", () => {
  it("mueve un elemento a una posición no adyacente", () => {
    expect(moveTo(["a", "b", "c", "d"], 0, 2)).toEqual(["b", "c", "a", "d"])
    expect(moveTo(["a", "b", "c", "d"], 3, 0)).toEqual(["d", "a", "b", "c"])
  })

  it("no hace nada si from === to o el índice está fuera de rango", () => {
    const list = ["a", "b", "c"]
    expect(moveTo(list, 1, 1)).toEqual(list)
    expect(moveTo(list, -1, 1)).toEqual(list)
    expect(moveTo(list, 0, 5)).toEqual(list)
  })
})

describe("checklist-builder: opciones select/multiselect", () => {
  it("hace round-trip texto <-> options", () => {
    const options = [{ value: "si", label: "Sí" }, { value: "no", label: "No" }]
    const text = optionsToText(options)
    expect(text).toBe("si: Sí\nno: No")
    expect(textToOptions(text)).toEqual(options)
  })

  it("ignora líneas vacías y usa el value como label si falta ':'", () => {
    expect(textToOptions("a: A\n\nb")).toEqual([{ value: "a", label: "A" }, { value: "b", label: "b" }])
  })
})

describe("checklist-builder: el resultado editado sigue siendo un ChecklistDefinition válido", () => {
  it("agregar sección + ítem + danoPotencial pasa pdtpChecklistDefinitionSchema", () => {
    const next: ChecklistDefinition = {
      ...BASE_DEFINITION,
      sections: [
        ...BASE_DEFINITION.sections,
        {
          id: "s2",
          title: "Sección 2",
          appliesWhen: ["prevencionista_faena"],
          countsForCompliance: true,
          items: [
            { id: "i2", label: "Ítem 2", kind: "select", options: textToOptions("a: A\nb: B"), danoPotencial: "grave" },
          ],
        },
      ],
    }
    expect(() => pdtpChecklistDefinitionSchema.parse(next)).not.toThrow()
  })

  it("reordenar secciones/ítems mantiene el JSON serializable y válido", () => {
    const withExtraItem: ChecklistDefinition = {
      ...BASE_DEFINITION,
      sections: [{
        ...BASE_DEFINITION.sections[0]!,
        items: [
          ...BASE_DEFINITION.sections[0]!.items,
          { id: "i2", label: "Ítem 2", kind: "text" },
        ],
      }],
    }
    const reordered: ChecklistDefinition = {
      ...withExtraItem,
      sections: [{ ...withExtraItem.sections[0]!, items: reorder(withExtraItem.sections[0]!.items, 0, 1) }],
    }
    const raw = JSON.stringify(reordered)
    expect(() => pdtpChecklistDefinitionSchema.parse(JSON.parse(raw))).not.toThrow()
    expect(reordered.sections[0]!.items[0]!.id).toBe("i2")
  })
})
