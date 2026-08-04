import { describe, expect, it } from "vitest"
import {
  reorder, moveTo, optionsToText, textToOptions, buildSkeletonDefinition,
  duplicateItem, duplicateSection, validateOptionsText, cloneDefinitionForActivity,
} from "./checklist-builder"
import { pdtpChecklistDefinitionSchema } from "@/lib/validation/prevention-module/pdtp"
import type { ChecklistDefinition, ChecklistSection } from "@/lib/sst/types"

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

describe("checklist-builder: buildSkeletonDefinition (F1)", () => {
  it("genera un esqueleto con la forma mínima esperada para empezar en modo visual", () => {
    const def = buildSkeletonDefinition("act-1", "Inspección de Estado de Extintores")
    expect(def.code).toBe("pdtp_act-1")
    expect(def.version).toBe("01")
    expect(def.title).toBe("Inspección de Estado de Extintores")
    expect(def.tipo).toBe("nuevo")
    expect(def.legalFramework).toEqual([])
    expect(def.sections).toEqual([])
    expect(def.revisionDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(def.closingAct.resultOptions).toHaveLength(3)
    expect(def.closingAct.signatureRoles).toContain("prevencionista_faena")
  })

  it("empieza con sections vacías (no pasa el schema hasta agregar 1 sección con 1 ítem)", () => {
    const def = buildSkeletonDefinition("act-2", "Charla de seguridad")
    const section: ChecklistSection = { id: "s1", title: "Verificación", items: [{ id: "i1", label: "Ítem", kind: "cumple_nocumple_obs" }] }
    const withContent: typeof def = { ...def, sections: [section] }
    expect(() => pdtpChecklistDefinitionSchema.parse(def)).toThrow()
    expect(() => pdtpChecklistDefinitionSchema.parse(withContent)).not.toThrow()
  })
})

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

describe("checklist-builder: validateOptionsText (F11)", () => {
  it("acepta opciones bien formadas", () => {
    expect(validateOptionsText("si: Sí\nno: No")).toEqual({ valid: true, issues: [] })
  })

  it("señala línea sin valor, sin etiqueta y valores repetidos", () => {
    const result = validateOptionsText("si: Sí\nsi: Sí otra\n: Sin valor\nsolo-valor")
    expect(result.valid).toBe(false)
    expect(result.issues.some((i) => i.includes("repetido"))).toBe(true)
    expect(result.issues.some((i) => i.includes("no tiene valor"))).toBe(true)
    expect(result.issues.some((i) => i.includes("no tiene etiqueta"))).toBe(true)
  })

  it("texto vacío es válido (no bloqueante)", () => {
    expect(validateOptionsText("")).toEqual({ valid: true, issues: [] })
  })
})

describe("checklist-builder: duplicateItem / duplicateSection (F8)", () => {
  it("duplica un ítem con id y label nuevos", () => {
    const original = { id: "i1", label: "Ítem 1", kind: "cumple_nocumple_obs" as const, danoPotencial: "grave" as const }
    const copy = duplicateItem(original)
    expect(copy.id).not.toBe(original.id)
    expect(copy.label).toBe("Ítem 1 (copia)")
    expect(copy.kind).toBe(original.kind)
    expect(copy.danoPotencial).toBe(original.danoPotencial)
  })

  it("duplica una sección con sus ítems y conserva appliesWhen", () => {
    const section: ChecklistSection = {
      id: "s1",
      title: "Estado del extintor",
      appliesWhen: ["prevencionista_faena"],
      items: [
        { id: "i1", label: "Sello", kind: "cumple_nocumple_obs" },
        { id: "i2", label: "Presión", kind: "cumple_nocumple_na_obs" },
      ],
    }
    const copy = duplicateSection(section)
    expect(copy.id).not.toBe("s1")
    expect(copy.title).toBe("Estado del extintor (copia)")
    expect(copy.appliesWhen).toEqual(["prevencionista_faena"])
    expect(copy.items).toHaveLength(2)
    expect(copy.items.map((i) => i.id)).not.toEqual(["i1", "i2"])
    expect(copy.items[0]!.label).toBe("Sello (copia)")
  })
})

describe("checklist-builder: cloneDefinitionForActivity (F12)", () => {
  it("reapunta code a la actividad destino, regenera ids y mantiene el resto", () => {
    const cloned = cloneDefinitionForActivity(BASE_DEFINITION, "act-99")
    expect(cloned.code).toBe("pdtp_act-99")
    expect(cloned.sections[0]!.id).not.toBe("s1")
    expect(cloned.sections[0]!.items[0]!.id).not.toBe("i1")
    expect(cloned.sections[0]!.title).toBe("Sección 1")
    expect(cloned.sections[0]!.items[0]!.label).toBe("Ítem 1")
    expect(cloned.revisionDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(() => pdtpChecklistDefinitionSchema.parse(cloned)).not.toThrow()
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
