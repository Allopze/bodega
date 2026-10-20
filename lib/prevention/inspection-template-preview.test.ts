import { describe, expect, it } from "vitest"
import { CHECKLIST_DEFINITIONS } from "@/lib/sst/definitions"
import type { ChecklistDefinition } from "@/lib/sst/types"
import { buildInspectionTemplatePreview, scaleSummary } from "@/lib/prevention/inspection-template-preview"

const base = (over: Partial<ChecklistDefinition> = {}): ChecklistDefinition => ({
  code: "demo",
  version: "01",
  revisionDate: "2026-01-01",
  title: "Demo",
  tipo: "seguimiento",
  legalFramework: [],
  applicableTo: "Todos",
  sections: [],
  ...over,
})

describe("buildInspectionTemplatePreview", () => {
  it("aplana secciones e ítems con la escala del instrumento, no la genérica", () => {
    const preview = buildInspectionTemplatePreview(base({
      sections: [{
        id: "s1",
        title: "Estado",
        items: [
          { id: "a", label: "Frenos", kind: "bueno_regular_malo_obs", danoPotencial: "fatal" },
          { id: "b", label: "Limpieza", kind: "cumple_nocumple_na_obs" },
        ],
      }],
    }))
    const [frenos, limpieza] = preview.sections[0]!.items
    expect(scaleSummary(frenos!.scale)).toBe("Bueno · Regular · Malo")
    // El escape se llama como en la bandeja y el acta: «No aplica», no «N/A».
    expect(scaleSummary(limpieza!.scale)).toBe("Cumple · No cumple · No aplica")
    expect(frenos).toMatchObject({ danoPotencial: "fatal", danoPotencialLabel: "Fatal", dataKindLabel: null })
    expect(limpieza).toMatchObject({ danoPotencial: null, danoPotencialLabel: null })
  })

  it("un ítem que registra un dato no tiene escala y dice qué dato es", () => {
    const preview = buildInspectionTemplatePreview(base({
      sections: [{
        id: "s1",
        title: "Datos",
        items: [
          { id: "serie", label: "N° de serie", kind: "text", placeholder: "Ej. 12345" },
          { id: "vence", label: "Vencimiento de la carga", kind: "date" },
          { id: "tipo", label: "Tipo", kind: "select", options: [{ value: "pqs", label: "PQS" }, { value: "co2", label: "CO₂" }] },
        ],
      }],
    }))
    const [serie, vence, tipo] = preview.sections[0]!.items
    expect(serie).toMatchObject({ scale: [], dataKindLabel: "Texto corto", placeholder: "Ej. 12345", scored: false })
    expect(vence).toMatchObject({ scale: [], dataKindLabel: "Fecha" })
    expect(tipo).toMatchObject({ dataKindLabel: "Una opción de la lista", options: [{ value: "pqs", label: "PQS" }, { value: "co2", label: "CO₂" }] })
  })

  it("la obligatoriedad efectiva es la del cierre: lo declarado o lo puntuable de una sección que cuenta", () => {
    const preview = buildInspectionTemplatePreview(base({
      sections: [
        {
          id: "cuenta",
          title: "Cuenta para el cumplimiento",
          items: [
            { id: "a", label: "Puntuable sin marca", kind: "cumple_nocumple_obs" },
            { id: "b", label: "Dato declarado obligatorio", kind: "text", required: true },
            { id: "c", label: "Dato opcional", kind: "text" },
          ],
        },
        {
          id: "no-cuenta",
          title: "No cuenta",
          countsForCompliance: false,
          items: [
            { id: "d", label: "Puntuable fuera del cumplimiento", kind: "cumple_nocumple_obs" },
            { id: "e", label: "Declarado obligatorio fuera del cumplimiento", kind: "cumple_nocumple_obs", required: true },
          ],
        },
      ],
    }))
    const byId = Object.fromEntries(preview.sections.flatMap((s) => s.items).map((item) => [item.id, item]))
    expect(byId.a).toMatchObject({ required: false, effectiveRequired: true, scored: true })
    expect(byId.b).toMatchObject({ required: true, effectiveRequired: true, scored: false })
    expect(byId.c).toMatchObject({ effectiveRequired: false })
    expect(byId.d).toMatchObject({ effectiveRequired: false, scored: false })
    expect(byId.e).toMatchObject({ required: true, effectiveRequired: true })
    expect(preview.sections[1]!.countsForCompliance).toBe(false)
    expect(preview.totals).toEqual({ sections: 2, items: 5, effectiveRequired: 3, scored: 1, withDanoPotencial: 0, dataItems: 2 })
  })

  it("el acta trae el título, los resultados y los roles que firman con su etiqueta legible", () => {
    const preview = buildInspectionTemplatePreview(base({
      closingAct: {
        title: "Cierre de la inspección",
        resultOptions: [{ value: "ok", label: "Conforme" }, { value: "no", label: "No conforme" }],
        hasRestrictions: true,
        signatureRoles: ["jefe_area", "supervisor"],
      },
    }))
    expect(preview.closingAct).toEqual({
      title: "Cierre de la inspección",
      resultOptions: [{ value: "ok", label: "Conforme" }, { value: "no", label: "No conforme" }],
      hasRestrictions: true,
      signatureRoles: [{ role: "jefe_area", label: "Jefe area" }, { role: "supervisor", label: "Supervisor" }],
    })
  })

  it("sin acta declarada no inventa una", () => {
    expect(buildInspectionTemplatePreview(base()).closingAct).toBeNull()
  })

  it("una definición sin secciones (fixture o snapshot incompleto) da una vista vacía y no revienta", () => {
    const preview = buildInspectionTemplatePreview({ ...base(), sections: undefined } as unknown as ChecklistDefinition)
    expect(preview.sections).toEqual([])
    expect(preview.totals.items).toBe(0)
  })

  it("las banderas del instrumento salen de la definición", () => {
    const preview = buildInspectionTemplatePreview(base({ recordsDeviations: true, recordsPreventiveActions: true, closesOnCompletion: true }))
    expect(preview).toMatchObject({ recordsDeviations: true, recordsPreventiveActions: true, closesOnCompletion: true, rowsFromWarehouse: false })
  })

  describe("con las definiciones reales del catálogo", () => {
    it("EPP: avisa que las prendas salen de la bodega y conserva la fila y la columna de cada ítem", () => {
      const preview = buildInspectionTemplatePreview(CHECKLIST_DEFINITIONS.inspeccion_epp!)
      expect(preview.rowsFromWarehouse).toBe(true)
      const matrixItem = preview.sections.flatMap((s) => s.items).find((item) => item.matrix)
      expect(matrixItem?.matrix).toEqual({ rowLabel: expect.any(String), columnLabel: expect.stringMatching(/^(Usa|Estado|Uso|Registro)/) })
    })

    it("Extintores: mezcla ítems con escala B/M y ítems de dato, y no es EPP", () => {
      const preview = buildInspectionTemplatePreview(CHECKLIST_DEFINITIONS.inspeccion_extintores!)
      expect(preview.rowsFromWarehouse).toBe(false)
      expect(preview.totals.dataItems).toBeGreaterThan(0)
      expect(preview.totals.scored).toBeGreaterThan(0)
      expect(preview.totals.items).toBe(preview.sections.reduce((sum, s) => sum + s.items.length, 0))
      expect(preview.closingAct?.signatureRoles.map((r) => r.label)).toEqual(["Prevencionista", "Supervisor"])
    })

    it("un instrumento de desviaciones lo declara, y no tiene nada que puntuar", () => {
      const preview = buildInspectionTemplatePreview(CHECKLIST_DEFINITIONS.inspeccion_area!)
      expect(preview.recordsDeviations).toBe(true)
      expect(preview.totals.scored).toBe(0)
    })

    it("todas las definiciones del catálogo se mapean sin lanzar y con totales coherentes", () => {
      for (const definition of Object.values(CHECKLIST_DEFINITIONS)) {
        const preview = buildInspectionTemplatePreview(definition)
        expect(preview.totals.effectiveRequired).toBeLessThanOrEqual(preview.totals.items)
        expect(preview.totals.scored + preview.totals.dataItems).toBeLessThanOrEqual(preview.totals.items)
      }
    })
  })
})
