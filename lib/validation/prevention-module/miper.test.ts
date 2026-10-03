import { describe, expect, it } from "vitest"
import { FREQUENCY_MAX_LENGTH, MEASURE_MAX_LENGTH, RESPONSIBLE_MAX_LENGTH } from "@/lib/prevention/miper/re04-measures"
import { createMiperSchema, IMPORT_LIMITS, miperApproveFinalSchema, miperControlSaveSchema, miperEntrySaveSchema, miperHeaderSchema, miperObservationSchema, programActionSchema, riskImportCommitSchema } from "./miper"

const header = {
  matrixId: "m1", expectedVersion: 1, iperCode: "RE-04", elaboratedOn: "2026-04-30", updatedOn: "2026-05-02",
  companyName: "Chome", companyRut: "78.023.530-6", companyAddress: "Lagart 175", companyCommune: "Cabrero",
  economicActivity: "Transporte", adherentNumber: null, worksiteName: "Biodiversa",
  siteRepresentativeUserId: null, siteRepresentativeName: "Jean Paul", headcountTotal: 16, headcountMale: 14, headcountFemale: 2, headcountOther: 0,
  participationSummary: "", consultationEvidenceReference: "",
}

describe("schemas MIPER", () => {
  it("crear exige faena, período razonable y motivo", () => {
    expect(createMiperSchema.safeParse({ worksiteId: "ws", period: 2026, revisionReason: "Elaboración inicial 2026" }).success).toBe(true)
    expect(createMiperSchema.safeParse({ worksiteId: "ws", period: 1999, revisionReason: "Elaboración inicial 2026" }).success).toBe(false)
    expect(createMiperSchema.safeParse({ worksiteId: "ws", period: 2026, revisionReason: "corto" }).success).toBe(false)
  })
  it("encabezado: actualización ≥ elaboración y dotación que suma", () => {
    expect(miperHeaderSchema.safeParse(header).success).toBe(true)
    expect(miperHeaderSchema.safeParse({ ...header, updatedOn: "2026-01-01" }).success).toBe(false)
    expect(miperHeaderSchema.safeParse({ ...header, headcountMale: 10 }).success).toBe(false)
  })
  it("fila: P y C sólo 1, 2 o 4; admite fila incompleta; rechaza campos desconocidos", () => {
    expect(miperEntrySaveSchema.safeParse({ matrixId: "m1", values: { probability: 4, consequence: 2 } }).success).toBe(true)
    expect(miperEntrySaveSchema.safeParse({ matrixId: "m1", values: { probability: 3 } }).success).toBe(false)
    expect(miperEntrySaveSchema.safeParse({ matrixId: "m1", values: {} }).success).toBe(true)
    expect(miperEntrySaveSchema.safeParse({ matrixId: "m1", values: { classification: "tolerable" } }).success).toBe(false)
    expect(miperEntrySaveSchema.safeParse({ matrixId: "m1", entryId: "e1", values: { hazard: "x" } }).success).toBe(false) // falta expectedVersion
  })
  it("observación y aprobación final exigen texto suficiente", () => {
    expect(miperObservationSchema.safeParse({ matrixId: "m1", entryId: "e1", body: "Revisar consecuencia" }).success).toBe(true)
    expect(miperObservationSchema.safeParse({ matrixId: "m1", body: "ok" }).success).toBe(false)
    expect(miperApproveFinalSchema.safeParse({ matrixId: "m1", expectedVersion: 3, changeSummary: "corto" }).success).toBe(false)
  })

  it("medida: «¿ya está implementada?» y su frecuencia son opcionales y acotados (Fase C)", () => {
    const base = { matrixId: "m1", entryId: "e1", values: { hierarchy: "ppe", description: "Uso de casco" } }
    expect(miperControlSaveSchema.safeParse(base).success).toBe(true)
    expect(miperControlSaveSchema.safeParse({ ...base, values: { ...base.values, isExisting: true, verificationFrequency: "Trimestral" } }).success).toBe(true)
    expect(miperControlSaveSchema.safeParse({ ...base, values: { ...base.values, isExisting: false, verificationFrequency: null } }).success).toBe(true)
    expect(miperControlSaveSchema.safeParse({ ...base, values: { ...base.values, verificationFrequency: "x".repeat(121) } }).success).toBe(false)
    expect(miperControlSaveSchema.safeParse({ ...base, values: { ...base.values, isExisting: "sí" } }).success).toBe(false)
  })

  it("carga del RE-04: los mapeos son opcionales (archivo sin medidas), con tipos del enum y topes de tamaño (Fase C)", () => {
    const base = { batchId: "b1", worksiteId: "ws", target: "draft" }
    expect(riskImportCommitSchema.parse(base)).toMatchObject({ measureMapping: {}, responsibleMapping: {}, deadlineMapping: {} })
    expect(riskImportCommitSchema.safeParse({
      ...base,
      measureMapping: { casco: "ppe" },
      responsibleMapping: { "": { kind: "none" }, prevencion: { kind: "text", name: "PREVENCION" }, jefa: { kind: "user", userId: "u-1" } },
      deadlineMapping: { trimestral: { kind: "existing", frequency: "TRIMESTRAL" }, inmediato: { kind: "pending", dueDate: null }, fecha: { kind: "pending", dueDate: "2026-06-30" } },
    }).success).toBe(true)
    expect(riskImportCommitSchema.safeParse({ ...base, measureMapping: { casco: "helmet" } }).success).toBe(false)
    expect(riskImportCommitSchema.safeParse({ ...base, deadlineMapping: { fecha: { kind: "pending", dueDate: "30-06-2026" } } }).success).toBe(false)
    expect(riskImportCommitSchema.safeParse({ ...base, deadlineMapping: { x: { kind: "existing", frequency: "x".repeat(121) } } }).success).toBe(false)
    expect(riskImportCommitSchema.safeParse({ ...base, responsibleMapping: { x: { kind: "text", name: "  " } } }).success).toBe(false)
    expect(riskImportCommitSchema.safeParse({ ...base, responsibleMapping: { x: { kind: "persona", userId: "u-1" } } }).success).toBe(false)
    const tooMany = Object.fromEntries(Array.from({ length: IMPORT_LIMITS.phrases + 1 }, (_, index) => [`medida ${index}`, "administrative"]))
    expect(riskImportCommitSchema.safeParse({ ...base, measureMapping: tooMany }).success).toBe(false)
  })

  it("los topes de la medida son las constantes de la importación: el editor y la carga aceptan lo mismo (arrastre de la Fase C)", () => {
    const medida = (values: Record<string, unknown>) => miperControlSaveSchema.safeParse({ matrixId: "m1", entryId: "e1", values: { hierarchy: "ppe", description: "Uso de casco", ...values } }).success
    const carga = (decisions: Record<string, unknown>) => riskImportCommitSchema.safeParse({ batchId: "b1", worksiteId: "ws", target: "draft", ...decisions }).success
    expect(medida({ description: "x".repeat(MEASURE_MAX_LENGTH) })).toBe(true)
    expect(medida({ description: "x".repeat(MEASURE_MAX_LENGTH + 1) })).toBe(false)
    expect(medida({ responsibleName: "x".repeat(RESPONSIBLE_MAX_LENGTH) })).toBe(true)
    expect(medida({ responsibleName: "x".repeat(RESPONSIBLE_MAX_LENGTH + 1) })).toBe(false)
    expect(medida({ verificationFrequency: "x".repeat(FREQUENCY_MAX_LENGTH) })).toBe(true)
    expect(medida({ verificationFrequency: "x".repeat(FREQUENCY_MAX_LENGTH + 1) })).toBe(false)
    expect(carga({ responsibleMapping: { x: { kind: "text", name: "x".repeat(RESPONSIBLE_MAX_LENGTH) } } })).toBe(true)
    expect(carga({ responsibleMapping: { x: { kind: "text", name: "x".repeat(RESPONSIBLE_MAX_LENGTH + 1) } } })).toBe(false)
    expect(carga({ deadlineMapping: { x: { kind: "existing", frequency: "x".repeat(FREQUENCY_MAX_LENGTH) } } })).toBe(true)
    expect(carga({ deadlineMapping: { x: { kind: "existing", frequency: "x".repeat(FREQUENCY_MAX_LENGTH + 1) } } })).toBe(false)
  })

  it("las fechas son de calendario: «2026-02-31» y «2026-13-45» no existen y el 29 de febrero sólo en año bisiesto", () => {
    const accepts: Record<string, (date: string) => boolean> = {
      medida: (dueDate) => miperControlSaveSchema.safeParse({ matrixId: "m1", entryId: "e1", values: { hierarchy: "ppe", description: "Uso de casco", dueDate } }).success,
      carga: (dueDate) => riskImportCommitSchema.safeParse({ batchId: "b1", worksiteId: "ws", target: "draft", deadlineMapping: { fecha: { kind: "pending", dueDate } } }).success,
      programa: (startsOn) => programActionSchema.safeParse({ matrixId: "m1", description: "Inspección de extintores", scheduleKind: "monthly", startsOn }).success,
    }
    for (const [schema, accept] of Object.entries(accepts)) {
      expect([schema, accept("2026-02-31")]).toEqual([schema, false])
      expect([schema, accept("2026-13-45")]).toEqual([schema, false])
      expect([schema, accept("2027-02-29")]).toEqual([schema, false])
      expect([schema, accept("2028-02-29")]).toEqual([schema, true])
    }
  })
})
