import { describe, expect, it } from "vitest"
import { RE04_METHODOLOGY } from "@/lib/prevention/miper/methodology"
import { analyzeRe04Measures, suggestedMappings } from "@/lib/prevention/miper/re04-measures"
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

/**
 * Fase C: una fila con una medida por implementar, una existente con frecuencia,
 * una existente sin frecuencia (con un plazo viejo que ya no aplica) y una
 * existente con una frecuencia que la importación no reconoce como tal. La
 * descripción de la segunda trae un salto de línea, como sale de un `Textarea`.
 */
const alignedSnapshot: MiperSnapshot = {
  ...snapshot,
  entries: [{
    ...snapshot.entries[0]!,
    controls: [
      { id: "ctl-a", hierarchy: "engineering", description: "Topes de descarga", responsibleUserId: null, responsibleName: "Supervisor de patio", dueDate: "2026-06-30", status: "proposed", isExisting: false, verificationFrequency: null },
      { id: "ctl-b", hierarchy: "administrative", description: "Charla de inicio\nde turno", responsibleUserId: null, responsibleName: null, dueDate: null, status: "proposed", isExisting: true, verificationFrequency: "Trimestral" },
      { id: "ctl-c", hierarchy: "ppe", description: "Casco y barbiquejo", responsibleUserId: null, responsibleName: "Jefe de faena", dueDate: "2026-12-31", status: "proposed", isExisting: true, verificationFrequency: null },
      { id: "ctl-d", hierarchy: "administrative", description: "Revisión de extintores", responsibleUserId: null, responsibleName: "Jefe de faena", dueDate: null, status: "proposed", isExisting: true, verificationFrequency: "Al inicio del turno" },
    ],
  }],
}
const alignedDetail = { ...detail, version: { ...detail.version, snapshot: alignedSnapshot } } as MiperVersionDetail

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
    // Una línea por medida en las tres columnas (Fase C): la segunda medida no tiene plazo y lo dice.
    expect(sheet.getCell("T14").value).toBe("Supervisor de patio\nSupervisor de patio")
    expect(sheet.getCell("U14").value).toBe("30-06-2026\n—")
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
    // El nombre del libro vivo se distingue del sellado.
    expect(miperFilenameBase(detail, { liveState: true })).toBe("RE-04-MIPER-BIO-2026-v2-vivo")
  })

  it("en el sellado por defecto la matriz sale de la foto y no lleva la leyenda", async () => {
    const workbook = await buildMiperWorkbook(detail, null)
    expect(String(workbook.getWorksheet("RE-04 IPER")!.getCell("A1").value)).not.toContain("no aprobados")
    // Sellado puro (versión vigente, programa no adelantado): sin aviso en RE-04.1.
    expect(workbook.getWorksheet("Programa de Trabajo")!.getCell("A2").value).toBe("")
  })

  it("con liveState la matriz sale del estado vivo y las hojas llevan la leyenda", async () => {
    const liveEntry = snapshot.entries[0]!
    const liveSnapshot: MiperSnapshot = {
      header: snapshot.header,
      entries: [
        { ...liveEntry, id: "live-1", hazard: "Peligro vivo" },
        { ...liveEntry, id: "live-2", rowNumber: 2, hazard: "Otro peligro vivo" },
      ],
    }
    const sealed = await buildMiperWorkbook(detail, null)
    const live = await buildMiperWorkbook(detail, null, { liveState: true, liveSnapshot })

    expect(String(sealed.getWorksheet("RE-04 IPER")!.getCell("A1").value)).not.toContain("no aprobados")
    expect(String(live.getWorksheet("RE-04 IPER")!.getCell("A1").value)).toContain("Incluye cambios no aprobados")
    expect(String(live.getWorksheet("Programa de Trabajo")!.getCell("A2").value)).toContain("Incluye cambios no aprobados")

    // El sellado conserva la única fila de la foto; el vivo trae las dos del estado vivo.
    expect(sealed.getWorksheet("RE-04 IPER")!.getCell("K14").value).toBe("Camión en pendiente")
    expect(live.getWorksheet("RE-04 IPER")!.getCell("K14").value).toBe("Peligro vivo")
    expect(live.getWorksheet("RE-04 IPER")!.getCell("K15").value).toBe("Otro peligro vivo")
  })

  it("en el sellado el aviso del programa aparece sólo si está adelantado respecto de la versión", async () => {
    const ahead = { ...program, program: { ...program.program, lastReviewedOn: "2026-05-01" } } as unknown as ProgramWorkspace
    const workbook = await buildMiperWorkbook(detail, ahead)
    expect(String(workbook.getWorksheet("Programa de Trabajo")!.getCell("A2").value)).toContain("cambios posteriores a la aprobación")
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

  it("una línea por medida en MEDIDA, RESPONSABLE y PLAZOS: «Existente · frecuencia» si es existente, fecha si es por implementar (Fase C)", async () => {
    const workbook = await buildMiperWorkbook(alignedDetail, null)
    const sheet = workbook.getWorksheet("RE-04 IPER")!
    expect(sheet.getCell("R14").value).toBe(
      "III. Controles de ingeniería: Topes de descarga\nIV. Controles administrativos: Charla de inicio de turno\nV. Elementos de protección personal: Casco y barbiquejo\nIV. Controles administrativos: Revisión de extintores",
    )
    expect(sheet.getCell("T14").value).toBe("Supervisor de patio\n—\nJefe de faena\nJefe de faena")
    // PLAZOS se describe solo: la existente lo dice aunque no tenga frecuencia; «—» queda para la por implementar sin fecha.
    expect(sheet.getCell("U14").value).toBe("30-06-2026\nExistente · Trimestral\nExistente\nExistente · Al inicio del turno")
  })

  it("una descripción con salto de línea no corre las líneas: las tres columnas tienen tantas líneas como medidas", async () => {
    const workbook = await buildMiperWorkbook(alignedDetail, null)
    const sheet = workbook.getWorksheet("RE-04 IPER")!
    const lines = (cell: string) => String(sheet.getCell(cell).value).split("\n").length
    expect([lines("R14"), lines("T14"), lines("U14")]).toEqual([4, 4, 4])
  })

  it("el libro exportado se vuelve a importar: cada medida conserva su tipo, su responsable y si es existente (con su frecuencia) o por implementar (con su plazo) (Fase C)", async () => {
    const sheet = (await buildMiperWorkbook(alignedDetail, null)).getWorksheet("RE-04 IPER")!
    const original = { "MEDIDA DE CONTROL": sheet.getCell("R14").value, "RESPONSABLE": sheet.getCell("T14").value, "PLAZOS": sheet.getCell("U14").value }
    const analysis = analyzeRe04Measures([{ rowNumber: 14, status: "ready", original }], { today: "2026-10-03" })
    const { measures, phrases } = analysis
    expect(measures.map((measure) => [measure.text, measure.prefix, measure.responsibleKey])).toEqual([
      ["Topes de descarga", "engineering", "supervisor de patio"],
      ["Charla de inicio de turno", "administrative", ""],
      ["Casco y barbiquejo", "ppe", "jefe de faena"],
      ["Revisión de extintores", "administrative", "jefe de faena"],
    ])
    expect(phrases.every((phrase) => phrase.suggestion.source === "prefix")).toBe(true)
    // Lo que carga «Aceptar sugerencias» es, medida por medida, lo que la MIPER tenía: incluida
    // la existente sin frecuencia (ctl-c) y la de una frecuencia que no es palabra clave (ctl-d).
    const { deadlineMapping } = suggestedMappings(analysis)
    const controls = alignedSnapshot.entries[0]!.controls
    expect(measures.map((measure) => deadlineMapping[measure.deadlineKey])).toEqual(controls.map((control) => (control.isExisting
      ? { kind: "existing", frequency: control.verificationFrequency }
      : { kind: "pending", dueDate: control.dueDate })))
  })
})
