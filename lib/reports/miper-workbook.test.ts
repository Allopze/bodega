import { describe, expect, it } from "vitest"
import { RE04_METHODOLOGY } from "@/lib/prevention/miper/methodology"
import type { MiperSnapshot } from "@/lib/prevention/miper/snapshot"
import type { ProgramWorkspace } from "@/lib/services/miper/program-queries"
import { buildMiperWorkbook, miperFilenameBase, type MiperVersionDetail } from "./miper-workbook"

/**
 * Foto sellada de la v2 de la faena BIO. Reproduce lo que `getMiperVersion`
 * devuelve para una versión ya aprobada: la cabecera del RE-04, una fila
 * moderada con dos controles de distinta jerarquía y el historial de versiones.
 */
const snapshot: MiperSnapshot = {
  header: {
    period: 2026, iperCode: "RE-04", elaboratedOn: "2026-01-15", updatedOn: "2026-02-01",
    companyName: "Biodiversa SpA", companyRut: "76.123.456-7", companyAddress: "Av. del Mar 100", companyCommune: "Santiago",
    economicActivity: "Servicios ambientales", adherentNumber: "AD-123",
    worksiteName: "Faena Bio", siteRepresentativeUserId: "u-rep", siteRepresentativeName: "Ana Representante",
    headcountTotal: 10, headcountMale: 6, headcountFemale: 3, headcountOther: 1,
    participationSummary: "Taller participativo con el comité paritario.", consultationEvidenceReference: "EVID-PAR-001",
  },
  entries: [{
    id: "entry-1", rowNumber: 1,
    activity: "Transporte", task: "Descarga", position: "Conductor", location: "Patio de maniobras",
    exposedFemale: 1, exposedMale: 4, exposedOther: 0,
    riskFactorId: "rf-mecanico", riskFactor: "Mecánico", isRoutine: true,
    hazard: "Camión en pendiente", risk: "Volcamiento", probableDamage: "Politraumatismo",
    probability: 2, consequence: 2, magnitude: 4, classification: "moderate", controlledStatus: "partial",
    controls: [
      { id: "ctl-1", hierarchy: "engineering", description: "Topes de descarga", responsibleUserId: "u-1", responsibleName: "Supervisor de patio", dueDate: "2026-06-30", status: "implemented" },
      { id: "ctl-2", hierarchy: "ppe", description: "Casco y barbiquejo", responsibleUserId: "u-1", responsibleName: "Supervisor de patio", dueDate: null, status: "pending" },
    ],
  }],
}

const detail = {
  version: {
    id: "version-2", matrixId: "matrix-1", versionNumber: 2, period: 2026, roundId: "round-1",
    snapshot, snapshotSha256: "sha-version-2", changeSummary: "Emisión inicial",
    elaboratedByUserId: "u-elabora", technicalReviewerUserId: "u-revisa", approverUserId: "u-aprueba",
    elaboratedByName: "Elena Elabora", technicalReviewerName: "Revisora Técnica", approverName: "Alberto Aprueba",
    approvedAt: "2026-03-01",
  },
  worksiteId: "ws-bio", worksiteName: "Faena Bio", worksiteCode: "BIO",
  methodologySnapshot: RE04_METHODOLOGY,
  versions: [
    { versionNumber: 1, approvedAt: "2026-01-20", changeSummary: "Emisión inicial", approverName: "Alberto Aprueba", elaboratedByName: "Elena Elabora" },
    { versionNumber: 2, approvedAt: "2026-03-01", changeSummary: "Emisión inicial", approverName: "Alberto Aprueba", elaboratedByName: "Elena Elabora" },
  ],
} as unknown as MiperVersionDetail

/** Todo el texto plano de una hoja, para aserciones de "dice / no dice". */
function sheetText(workbook: Awaited<ReturnType<typeof buildMiperWorkbook>>, name: string): string {
  const values: string[] = []
  workbook.getWorksheet(name)?.eachRow((row) => row.eachCell((cell) => { if (cell.value !== null && cell.value !== undefined) values.push(String(cell.value)) }))
  return values.join("\n")
}

/**
 * Programa RE-04.1 de la misma MIPER: un encabezado con los campos derivados y
 * una actividad mensual con una ocurrencia ya realizada (fuera de plazo) y otra
 * pendiente. Es el estado que `getProgramWorkspace` devuelve para esa matriz.
 */
const program = {
  program: {
    id: "program-1", matrixId: "matrix-1", worksiteId: "ws-bio", period: 2026,
    companyName: "Biodiversa SpA", companyRut: "76.123.456-7", companyAddress: "Av. del Mar 100", companyCommune: "Santiago",
    economicActivity: "Servicios ambientales", adherentNumber: "AD-123", worksiteName: "Faena Bio",
    siteRepresentativeUserId: "u-rep", siteRepresentativeName: "Ana Representante",
    headcountTotal: 10, headcountMale: 6, headcountFemale: 3, headcountOther: 1,
    programManagerUserId: "u-enc", elaboratedOn: "2026-03-05", version: 1,
    createdByUserId: "u-elabora", createdAt: "2026-03-05T00:00:00.000Z", updatedAt: "2026-03-05T00:00:00.000Z",
    worksiteCount: 3, lastReviewedOn: "2026-03-01", programManagerName: "Elena Encargada",
  },
  proposals: null,
  progress: { done: 1, late: 1, pending: 1, overdue: 0, failed: 0, planned: 2, ratio: 0.5 },
  actions: [{
    id: "action-1", actionNumber: 1, processName: "Transporte", description: "Instalar topes de descarga",
    responsibleUserId: "u-1", responsibleName: "Supervisor de patio", locationLabel: "Patio de maniobras",
    scheduleKind: "monthly", startsOn: "2026-03-31", status: "active", retiredReason: null, version: 1,
    controls: [{ id: "ctl-1", rowNumber: 1, description: "Topes de descarga" }],
    occurrences: [
      { id: "occ-1", dueOn: "2026-03-31", outcome: "done", late: true, effectiveOn: "2026-04-02", reason: null, evidenceCount: 2 },
      { id: "occ-2", dueOn: "2026-04-30", outcome: "pending", late: false, effectiveOn: null, reason: null, evidenceCount: 0 },
    ],
    progress: { done: 1, late: 1, pending: 1, overdue: 0, failed: 0, planned: 2, ratio: 0.5 },
  }],
} as unknown as ProgramWorkspace

describe("libro RE-04 de una versión sellada de la MIPER", () => {
  it("arma las cuatro hojas y el encabezado de la versión aprobada", async () => {
    const workbook = await buildMiperWorkbook(detail, null)
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(["RE-04 IPER", "Modificaciones", "Criterios de Evaluación IPER", "Programa de Trabajo"])

    const sheet = workbook.getWorksheet("RE-04 IPER")!
    expect(sheet.getCell("A8").value).toBe("REPRESENTANTE DE LA EMPRESA EN LA FAENA (ADMINISTRADOR DE CONTRATO)")
    expect(sheet.getCell("D8").value).toBe("Ana Representante")
    // El RE-04 no tiene un "representante legal": quien firma por la faena es el
    // administrador de contrato. Si alguien revierte el rótulo, esto lo detecta.
    expect(sheetText(workbook, "RE-04 IPER")).not.toContain("REPRESENTANTE LEGAL")
    expect(sheet.getCell("A9").value).toBe("NOMBRE QUIEN ELABORÓ")
    expect(sheet.getCell("D9").value).toBe("Elena Elabora")
    expect(sheet.getCell("K9").value).toBe("NOMBRE QUIEN REVISÓ")
    expect(sheet.getCell("N9").value).toBe("Revisora Técnica")
    expect(sheet.getCell("K10").value).toBe("FECHA DE APROBACIÓN")
    expect(sheet.getCell("N10").value).toBe("01-03-2026")
  })

  it("traduce la clasificación, las medidas con su jerarquía y el estado de control", async () => {
    const workbook = await buildMiperWorkbook(detail, null)
    const sheet = workbook.getWorksheet("RE-04 IPER")!
    expect(sheet.getCell("Q14").value).toBe("MODERADO")
    expect(sheet.getCell("R14").value).toBe("III. Controles de ingeniería: Topes de descarga\nV. Elementos de protección personal: Casco y barbiquejo")
    expect(sheet.getCell("S14").value).toBe("Parcialmente")
    expect(sheet.getCell("T14").value).toBe("Supervisor de patio")
    expect(sheet.getCell("U14").value).toBe("30-06-2026")
  })

  it("lista las modificaciones y los criterios de evaluación", async () => {
    const workbook = await buildMiperWorkbook(detail, null)
    const changes = workbook.getWorksheet("Modificaciones")!
    expect(changes.getCell("A2").value).toBe(1)
    expect(changes.getCell("C2").value).toBe("Emisión inicial")
    expect(changes.getCell("C3").value).toBe("Emisión inicial")

    const criteria = workbook.getWorksheet("Criterios de Evaluación IPER")!
    expect(criteria.getCell("A2").value).toBe("Baja")
    expect(sheetText(workbook, "Criterios de Evaluación IPER")).toContain("MODERADO")
  })

  it("nombra el archivo con el código de faena, el período y la versión", () => {
    expect(miperFilenameBase(detail)).toBe("RE-04-MIPER-BIO-2026-v2")
  })

  it("agrega la hoja Programa de Trabajo (RE-04.1) con su encabezado y una línea por actividad", async () => {
    const workbook = await buildMiperWorkbook(detail, program)
    const sheet = workbook.getWorksheet("Programa de Trabajo")!
    expect(sheet.getCell("A1").value).toBe("Programa de Trabajo Preventivo (RE-04.1)")

    // Encabezado RE-04.1: representante de la empresa en la faena, nunca "legal".
    expect(sheet.getCell("A7").value).toBe("REPRESENTANTE DE LA EMPRESA EN LA FAENA (ADMINISTRADOR DE CONTRATO)")
    expect(sheet.getCell("D7").value).toBe("Ana Representante")
    expect(sheetText(workbook, "Programa de Trabajo")).not.toContain("REPRESENTANTE LEGAL")
    // Campos derivados del programa: N° de centros, última revisión y encargado.
    expect(sheet.getCell("D9").value).toBe(3)
    expect(sheet.getCell("D10").value).toBe("01-03-2026")
    expect(sheet.getCell("D11").value).toBe("Elena Encargada")

    // Una línea por actividad con proceso, medida, responsable, centro y frecuencia.
    expect(sheet.getCell("A14").value).toBe(1)
    expect(sheet.getCell("B14").value).toBe("Transporte")
    expect(sheet.getCell("C14").value).toBe("Instalar topes de descarga")
    expect(sheet.getCell("D14").value).toBe("Supervisor de patio")
    expect(sheet.getCell("E14").value).toBe("Patio de maniobras")
    expect(sheet.getCell("F14").value).toBe("Mensual (desde 31-03-2026)")
  })

  it("muestra la fecha efectiva y el avance (con las fuera de plazo marcadas)", async () => {
    const workbook = await buildMiperWorkbook(detail, program)
    const sheet = workbook.getWorksheet("Programa de Trabajo")!
    // Ocurrencia hecha el 02-04-2026 (fuera de plazo) y otra pendiente.
    expect(sheet.getCell("G14").value).toBe("02-04-2026")
    expect(sheet.getCell("H14").value).toBe("1/2 (50%) · 1 fuera de plazo")
  })

  it("deja la hoja Programa de Trabajo vacía con su mensaje si la versión no tiene programa", async () => {
    const workbook = await buildMiperWorkbook(detail, null)
    expect(workbook.getWorksheet("Programa de Trabajo")).toBeTruthy()
    expect(sheetText(workbook, "Programa de Trabajo")).toContain("no tiene actividades del Programa de Trabajo (RE-04.1) registradas")
  })
})
