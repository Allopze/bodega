import { describe, expect, it } from "vitest"
import { createMiperSchema, miperApproveFinalSchema, miperEntrySaveSchema, miperHeaderSchema, miperObservationSchema } from "./miper"

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
})
