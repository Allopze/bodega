import { describe, expect, it } from "vitest"
import { normalizeMeasure } from "./dedup"
import { acceptSuggestions, choosePhraseType, decisionsToMappings, importSummary, initialDecisions, unconfirmedCount } from "./import-decisions"
import { analyzeRe04Measures, type MeasureAnalysis } from "./re04-measures"

/** Dos filas del Excel (14 y 15): una con plazo «INMEDIATO…» y otra «TRIMESTRAL»; una frase trae su «III.». */
const ANALYSIS: MeasureAnalysis = {
  measures: [
    { rowNumber: 14, text: "USO DE EPP (CASCO, GUANTES, CALZADO DE SEGURIDAD)", phraseKey: "uso epp casco guantes calzado seguridad", prefix: null, labeled: false, responsibleKey: "supervisor/prevencion", deadlineKey: "inmediato / antes de continuar la tarea" },
    { rowNumber: 14, text: "ORDEN Y LIMPIEZA", phraseKey: "orden limpieza", prefix: null, labeled: false, responsibleKey: "supervisor/prevencion", deadlineKey: "inmediato / antes de continuar la tarea" },
    { rowNumber: 15, text: "Topes de descarga", phraseKey: "topes descarga", prefix: "engineering", labeled: true, responsibleKey: "supervisor/prevencion", deadlineKey: "trimestral" },
    { rowNumber: 15, text: "ORDEN Y LIMPIEZA", phraseKey: "orden limpieza", prefix: null, labeled: false, responsibleKey: "supervisor/prevencion", deadlineKey: "trimestral" },
  ],
  phrases: [
    { key: "orden limpieza", text: "ORDEN Y LIMPIEZA", count: 2, suggestion: { hierarchy: "administrative", source: "keyword" } },
    { key: "topes descarga", text: "Topes de descarga", count: 1, suggestion: { hierarchy: "engineering", source: "prefix" } },
    { key: "uso epp casco guantes calzado seguridad", text: "USO DE EPP (CASCO, GUANTES, CALZADO DE SEGURIDAD)", count: 1, suggestion: { hierarchy: "ppe", source: "keyword" } },
  ],
  responsibles: [{ key: "supervisor/prevencion", text: "SUPERVISOR/PREVENCION", count: 4, suggestion: { kind: "text", name: "SUPERVISOR/PREVENCION" } }],
  deadlines: [
    { key: "inmediato / antes de continuar la tarea", text: "INMEDIATO / ANTES DE CONTINUAR LA TAREA", count: 2, suggestion: { kind: "pending", dueDate: "2026-10-03" } },
    { key: "trimestral", text: "TRIMESTRAL", count: 2, suggestion: { kind: "existing", frequency: "TRIMESTRAL" } },
  ],
}

describe("decisiones de la vista previa (Fase C)", () => {
  it("el tipo nace sugerido salvo el que trae el Excel; responsables y plazos nacen en su sugerencia", () => {
    const decisions = initialDecisions(ANALYSIS)
    expect(decisions.phrases).toEqual({
      "orden limpieza": { hierarchy: "administrative", confirmed: false },
      "topes descarga": { hierarchy: "engineering", confirmed: true },
      "uso epp casco guantes calzado seguridad": { hierarchy: "ppe", confirmed: false },
    })
    expect(unconfirmedCount(decisions)).toBe(2)
    expect(decisions.responsibles["supervisor/prevencion"]).toEqual({ kind: "text", name: "SUPERVISOR/PREVENCION" })
    expect(decisions.deadlines.trimestral).toEqual({ kind: "existing", frequency: "TRIMESTRAL" })
  })

  it("sólo el «I.–V.» ROTULADO del libro exportado nace confirmado; un romano suelto («I. USAR CASCO») nace sugerido con ese tipo", () => {
    const analysis = analyzeRe04Measures([{
      rowNumber: 14, status: "ready",
      original: { "MEDIDA DE CONTROL": "I. USAR CASCO\nIII. Controles de ingeniería: Topes de descarga" },
    }], { today: "2026-10-03" })
    expect(initialDecisions(analysis).phrases).toEqual({
      [normalizeMeasure("USAR CASCO")]: { hierarchy: "elimination", confirmed: false },
      [normalizeMeasure("Topes de descarga")]: { hierarchy: "engineering", confirmed: true },
    })
  })

  it("«Aceptar sugerencias» confirma todo sin cambiar los tipos; elegir un tipo confirma esa frase; nada se modifica en el lugar", () => {
    const decisions = initialDecisions(ANALYSIS)
    const accepted = acceptSuggestions(decisions)
    expect(unconfirmedCount(accepted)).toBe(0)
    expect(accepted.phrases["orden limpieza"]).toEqual({ hierarchy: "administrative", confirmed: true })
    const chosen = choosePhraseType(decisions, "orden limpieza", "engineering")
    expect(chosen.phrases["orden limpieza"]).toEqual({ hierarchy: "engineering", confirmed: true })
    expect(unconfirmedCount(chosen)).toBe(1)
    expect(decisions.phrases["orden limpieza"]!.confirmed).toBe(false)
  })

  it("los mapeos para el servidor son las decisiones, sin el estado de confirmación", () => {
    expect(decisionsToMappings(acceptSuggestions(initialDecisions(ANALYSIS)))).toEqual({
      measureMapping: { "orden limpieza": "administrative", "topes descarga": "engineering", "uso epp casco guantes calzado seguridad": "ppe" },
      responsibleMapping: { "supervisor/prevencion": { kind: "text", name: "SUPERVISOR/PREVENCION" } },
      deadlineMapping: { "inmediato / antes de continuar la tarea": { kind: "pending", dueDate: "2026-10-03" }, trimestral: { kind: "existing", frequency: "TRIMESTRAL" } },
    })
  })

  it("el resumen cuenta sólo las medidas de las filas que se cargan, existentes o por implementar según su plazo", () => {
    const { deadlines } = initialDecisions(ANALYSIS)
    expect(importSummary(ANALYSIS, new Set([14, 15]), deadlines)).toEqual({ measures: 4, existing: 2, pending: 2 })
    expect(importSummary(ANALYSIS, new Set([14]), deadlines)).toEqual({ measures: 2, existing: 0, pending: 2 })
    expect(importSummary(ANALYSIS, new Set([14, 15]), { ...deadlines, trimestral: { kind: "pending", dueDate: null } })).toEqual({ measures: 4, existing: 0, pending: 4 })
  })
})
