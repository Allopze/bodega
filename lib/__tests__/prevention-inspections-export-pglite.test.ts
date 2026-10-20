/**
 * Excel de Inspecciones y Excel de Seguimiento (Anexo 15), reabiertos con ExcelJS.
 *
 * Fija lo que la auditoría del 2026-10-19 encontró en los dos archivos (P2-2, P2-3, REP-002):
 *   - las fechas salían como texto UTC (`2026-10-19 18:34:14.564+00`) y no se podían ordenar ni
 *     filtrar: ahora son celdas de fecha con la hora de pared de Chile y su formato;
 *   - estado, frecuencia, daño y procedencia salían como enums crudos o con otro vocabulario que
 *     la pantalla;
 *   - la hoja de hallazgos mostraba el id de la CAPA y no su código;
 *   - el libro no llevaba «Metadatos» ni el sufijo `_filtradas` con responsable o fechas;
 *   - el Anexo 15 conserva sus encabezados y hojas oficiales, y solo gana columnas a la derecha.
 */
import path from "node:path"
import ExcelJS from "exceljs"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { beforeAll, describe, expect, it, vi } from "vitest"
import type { Session } from "next-auth"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import type { WorksiteScope } from "@/lib/auth/scope"
import { migratePGlite } from "@/lib/testing/pglite-migrate"

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const testGlobal = globalThis as typeof globalThis & { __db?: DB }
testGlobal.__db = testDb
vi.mock("@/db", () => ({ get db() { return testGlobal.__db } }))

const { buildInspectionExport, inspectionExportFilterSummary } = await import("@/lib/services/prevention-inspections-export")
const { buildInspectionFollowupWorkbook, listInspectionFollowup } = await import("@/lib/services/prevention-inspection-followup")
const { buildXlsxBuffer } = await import("@/lib/reports/export")

const EJECUTOR = "u-exp-ejecutor"
const REVISOR = "u-exp-revisor"
const ASIGNADA = "u-exp-asignada"
const WS = "ws-exp-1"

const TPL_EXT = "tpl-exp-ext"
const TPL_RETIRADA = "tpl-exp-retirada"
const TPL_REEMPLAZADA = "tpl-exp-reemplazada"
const TPL_OFICIAL = "tpl-exp-oficial"
const TPL_OBS = "tpl-exp-obs"

const RUN_A = "run-exp-a"
const RUN_B = "run-exp-b"
const RUN_OBS = "run-exp-obs"

const access = {
  userId: REVISOR,
  scope: { mode: "all", ids: [] } as WorksiteScope,
  permissions: ["prevention:inspections:view", "prevention:inspections:export"],
}

const session = {
  user: { id: REVISOR, email: "revisor@exp.cl", name: "Rodrigo Revisor", isGlobal: true, worksiteIds: [] },
  expires: "2099-01-01T00:00:00.000Z",
} as unknown as Session

/** Cuestionario congelado de la plantilla de extintores: un `select`, una `date` y una escala B/R/M. */
const EXTINTORES = {
  code: "extintores",
  version: "1",
  revisionDate: "2026-01-01",
  title: "Inspección de extintores",
  tipo: "inspeccion",
  legalFramework: [],
  applicableTo: "",
  sections: [{
    id: "s1",
    title: "Extintor",
    items: [
      { id: "tipo", label: "Tipo de extintor", kind: "select", options: [{ value: "pqs", label: "PQS (Polvo Químico Seco)" }, { value: "co2", label: "CO2" }] },
      { id: "vence", label: "Vencimiento de la carga", kind: "date" },
      { id: "sello", label: "Sello de seguridad", kind: "bueno_regular_malo_obs", danoPotencial: "grave" },
    ],
  }],
}

function hash(seed: string) {
  return seed.padEnd(64, "0").slice(0, 64)
}

async function seedTemplate(values: Partial<typeof schema.preventionInspectionTemplates.$inferInsert> & { id: string; code: string; name: string }) {
  await testDb.insert(schema.preventionInspectionTemplates).values({
    versionLabel: "v1",
    kind: "inspection",
    definitionSnapshot: { code: values.code, sections: [] },
    contentHash: hash(values.id),
    status: "approved",
    authorUserId: REVISOR,
    approvedByUserId: REVISOR,
    approvedAt: "2026-06-15T12:00:00.000Z",
    ...values,
  })
}

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  await testDb.insert(schema.users).values([
    { id: EJECUTOR, name: "Elena Ejecutora", email: "ejecutora@exp.cl", hashedPassword: "x", isActive: true },
    { id: REVISOR, name: "Rodrigo Revisor", email: "revisor@exp.cl", hashedPassword: "x", isActive: true },
    { id: ASIGNADA, name: "Ana Asignada", email: "asignada@exp.cl", hashedPassword: "x", isActive: true },
  ])
  await testDb.insert(schema.worksites).values({ id: WS, name: "Faena Exportación", code: "EXP", isActive: true })

  await seedTemplate({ id: TPL_EXT, code: "extintores", name: "Inspección de extintores", definitionSnapshot: EXTINTORES })
  // Una retirada (`superseded` que nadie reemplazó) y una reemplazada de verdad.
  // Su definición de origen ya no está en el catálogo (R-11): la columna «Origen» no tiene nombre que mostrar.
  await seedTemplate({ id: TPL_RETIRADA, code: "retirada", name: "Instrumento retirado", status: "superseded", approvedByUserId: null, approvedAt: null, sourceDefinitionCode: "definicion_retirada_del_catalogo" })
  await seedTemplate({ id: TPL_REEMPLAZADA, code: "reemplazada", name: "Instrumento reemplazado", status: "superseded", supersededByTemplateId: TPL_EXT, approvedByUserId: null, approvedAt: null })
  await seedTemplate({ id: TPL_OFICIAL, code: "oficial", name: "Anexo oficial", status: "draft", provenanceKind: "official_document", approvedByUserId: null, approvedAt: null })
  await seedTemplate({ id: TPL_OBS, code: "observacion", name: "Observación planeada", kind: "observation", sourceDefinitionCode: "caminata_seguridad" })

  await testDb.insert(schema.preventionInspectionRuns).values([
    {
      id: RUN_A, code: "INS-EXP-0001", templateId: TPL_EXT, worksiteId: WS, status: "completed",
      subjectLabel: "Extintor QA 01", scheduledFor: "2026-10-15", assignedToUserId: ASIGNADA,
      executedByUserId: EJECUTOR,
      // 15:34 en Chile (UTC-3, horario de verano).
      executedAt: "2026-10-19T18:34:14.564Z",
      conformingCount: 3, partialCount: 1, nonConformingCount: 2, notApplicableCount: 4,
      normalizedComplianceBasisPoints: 8000, createdByUserId: EJECUTOR,
    },
    {
      id: RUN_B, code: "INS-EXP-0002", templateId: TPL_EXT, worksiteId: WS, status: "reviewed",
      executedByUserId: EJECUTOR,
      // 08:00 en Chile (UTC-4, horario de invierno).
      executedAt: "2026-06-15T12:00:00.000Z",
      reviewedByUserId: REVISOR, reviewedAt: "2026-06-16T15:00:00.000Z",
      createdByUserId: EJECUTOR,
    },
    {
      id: RUN_OBS, code: "OBS-EXP-0001", templateId: TPL_OBS, worksiteId: WS, status: "completed",
      // 22:30 del 19-10 en Chile, pero ya es 20-10 en UTC.
      executedAt: "2026-10-20T01:30:00.000Z",
      executedByUserId: EJECUTOR, createdByUserId: EJECUTOR,
    },
  ])

  await testDb.insert(schema.preventionInspectionAnswers).values([
    { id: "ans-exp-tipo", runId: RUN_A, sectionId: "s1", itemId: "tipo", itemLabel: "Tipo de extintor", result: "recorded", value: "pqs" },
    { id: "ans-exp-vence", runId: RUN_A, sectionId: "s1", itemId: "vence", itemLabel: "Vencimiento de la carga", result: "recorded", value: "2027-03-05" },
    { id: "ans-exp-sello", runId: RUN_A, sectionId: "s1", itemId: "sello", itemLabel: "Sello de seguridad", result: "non_conforming", comment: "Sello roto", danoPotencial: "grave" },
  ])

  await testDb.insert(schema.preventionCapaActions).values({
    id: "capa-exp-1", code: "CAPA-EXP-001", sourceType: "inspection", sourceId: RUN_A, worksiteId: WS,
    finding: "Sello roto en el extintor", actionDescription: "Reponer el sello de seguridad",
    responsibleUserId: ASIGNADA, targetDate: "2026-11-02", status: "in_progress",
    createdByUserId: REVISOR, createdAt: "2026-10-19T19:00:00.000Z", updatedAt: "2026-10-19T19:00:00.000Z",
  })
  await testDb.insert(schema.preventionCapaFollowups).values({
    id: "fup-exp-1", actionId: "capa-exp-1", note: "Se pidió el repuesto", progress: 40,
    createdByUserId: REVISOR, createdAt: "2026-10-20T12:00:00.000Z",
  })

  await testDb.insert(schema.preventionInspectionFindings).values([
    {
      id: "fnd-exp-1", runId: RUN_A, description: "Sello roto en el extintor", danoPotencial: "grave",
      criticality: "high", status: "capa_linked", capaActionId: "capa-exp-1", createdAt: "2026-10-19T18:40:00.000Z",
    },
    {
      id: "fnd-exp-2", runId: RUN_A, description: "Manguera con grietas", danoPotencial: "moderado",
      criticality: "low", status: "closed", closedByUserId: REVISOR,
      // 17:30 en Chile.
      closedAt: "2026-10-19T20:30:00.000Z", createdAt: "2026-10-19T18:41:00.000Z",
    },
    {
      id: "fnd-exp-obs", runId: RUN_OBS, description: "Orden deficiente en la bodega",
      criticality: "medium", status: "open", createdAt: "2026-10-20T01:40:00.000Z",
    },
  ])

  await testDb.insert(schema.preventionContainers).values({
    id: "cnt-exp-1", worksiteId: WS, code: "CS-EXP-1", location: "Acopio", createdByUserId: REVISOR,
  })
  await testDb.insert(schema.preventionInspectionPrograms).values([
    {
      // Sin sujeto concreto: solo el tipo declarado.
      id: "prg-exp-1", templateId: TPL_EXT, worksiteId: WS, frequency: "monthly", intervalDays: 30,
      nextDueOn: "2026-11-05", assignedToUserId: ASIGNADA, subjectType: "contenedor", createdByUserId: REVISOR,
    },
    {
      id: "prg-exp-2", templateId: TPL_EXT, worksiteId: WS, frequency: "weekly", intervalDays: 7,
      nextDueOn: "2026-11-12", subjectType: "contenedor", subjectContainerId: "cnt-exp-1", createdByUserId: REVISOR,
    },
  ])
})

/* ── Lectura del .xlsx ───────────────────────────────────────────────────── */

type Row = Record<string, ExcelJS.Cell>

async function open(buffer: ArrayBuffer) {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer)
  return workbook
}

function headersOf(worksheet: ExcelJS.Worksheet): string[] {
  return (worksheet.getRow(1).values as ExcelJS.CellValue[]).slice(1).map((value) => String(value))
}

/** Filas de datos como `{ encabezado: celda }`, para leer valor y formato por nombre de columna. */
function rowsOf(worksheet: ExcelJS.Worksheet): Row[] {
  const headers = headersOf(worksheet)
  const rows: Row[] = []
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return
    rows.push(Object.fromEntries(headers.map((header, index) => [header, row.getCell(index + 1)])))
  })
  return rows
}

function rowWhere(rows: Row[], header: string, value: string): Row {
  const found = rows.find((row) => row[header]?.value === value)
  if (!found) throw new Error(`No hay fila con ${header} = ${value}`)
  return found
}

/** Una celda de fecha lleva la hora de pared de Chile escrita como si fuera UTC. */
function wallClock(cell: ExcelJS.Cell, precision: "minute" | "day" = "minute") {
  expect(cell.value, "la celda debe ser una fecha real y no texto").toBeInstanceOf(Date)
  return (cell.value as Date).toISOString().slice(0, precision === "minute" ? 16 : 10)
}

async function inspectionsWorkbook(filter: Parameters<typeof buildInspectionExport>[1] = {}) {
  const report = await buildInspectionExport(access, filter)
  const bytes = await buildXlsxBuffer(report, { session, filters: report.filterSummary })
  return { report, workbook: await open(bytes) }
}

/* ── Excel de Inspecciones ───────────────────────────────────────────────── */

describe("Excel de Inspecciones — hoja «Inspecciones»", () => {
  it("«Ejecutada» es una fecha real en hora de Chile, con su formato", async () => {
    const { workbook } = await inspectionsWorkbook()
    const rows = rowsOf(workbook.getWorksheet("Inspecciones")!)

    const verano = rowWhere(rows, "Código", "INS-EXP-0001")["Ejecutada"]!
    expect(wallClock(verano)).toBe("2026-10-19T15:34")
    expect(verano.numFmt).toBe("dd-mm-yyyy hh:mm")

    const invierno = rowWhere(rows, "Código", "INS-EXP-0002")["Ejecutada"]!
    expect(wallClock(invierno)).toBe("2026-06-15T08:00")
    expect(invierno.numFmt).toBe("dd-mm-yyyy hh:mm")
  })

  it("el estado usa el vocabulario de la pantalla y la procedencia lleva etiqueta", async () => {
    const { workbook } = await inspectionsWorkbook()
    const rows = rowsOf(workbook.getWorksheet("Inspecciones")!)

    expect(rowWhere(rows, "Código", "INS-EXP-0001")["Estado"]!.value).toBe("Pendiente de revisión")
    expect(rowWhere(rows, "Código", "INS-EXP-0002")["Estado"]!.value).toBe("Revisada y cerrada")
    expect(rowWhere(rows, "Código", "INS-EXP-0001")["Procedencia documental"]!.value).toBe("Definición de plataforma")
  })

  it("los agregados se llaman por lo que cuentan y las columnas nuevas van al final", async () => {
    const { workbook } = await inspectionsWorkbook()
    const sheet = workbook.getWorksheet("Inspecciones")!

    expect(headersOf(sheet)).toEqual([
      "Código", "Plantilla", "Tipo", "Origen", "Faena", "Sujeto", "Estado", "Ejecutada", "Ejecutó", "Revisó",
      "Ítems conformes", "Ítems regulares", "Ítems no conformes", "Ítems no evaluados (No aplica / No tiene)",
      "Resultado oficial %", "Resultado normalizado %", "Procedencia documental", "Revisión documental",
      "Checksum documental", "Hash digital", "Participantes", "Comentario de revisión",
      // Nuevas: a la derecha de lo que ya existía.
      "Responsable", "Programada para", "Revisada", "Hallazgos abiertos", "Hallazgos graves abiertos",
    ])

    const row = rowWhere(rowsOf(sheet), "Código", "INS-EXP-0001")
    expect([
      row["Ítems conformes"]!.value, row["Ítems regulares"]!.value,
      row["Ítems no conformes"]!.value, row["Ítems no evaluados (No aplica / No tiene)"]!.value,
    ]).toEqual([3, 1, 2, 4])
    expect(row["Resultado normalizado %"]!.value).toBe(80)
    expect(row["Responsable"]!.value).toBe("Ana Asignada")
    expect(row["Ejecutó"]!.value).toBe("Elena Ejecutora")
    // Un hallazgo abierto y grave (el cerrado no cuenta).
    expect(row["Hallazgos abiertos"]!.value).toBe(1)
    expect(row["Hallazgos graves abiertos"]!.value).toBe(1)
  })

  it("«Programada para» es fecha calendario y «Revisada» fecha con hora, ambas con formato", async () => {
    const { workbook } = await inspectionsWorkbook()
    const rows = rowsOf(workbook.getWorksheet("Inspecciones")!)

    const programada = rowWhere(rows, "Código", "INS-EXP-0001")["Programada para"]!
    expect(wallClock(programada, "day")).toBe("2026-10-15")
    expect(programada.numFmt).toBe("dd-mm-yyyy")

    const revisada = rowWhere(rows, "Código", "INS-EXP-0002")["Revisada"]!
    expect(wallClock(revisada)).toBe("2026-06-16T11:00")
    expect(revisada.numFmt).toBe("dd-mm-yyyy hh:mm")
  })
})

describe("Excel de Inspecciones — hojas de detalle", () => {
  it("«Respuestas» traduce el valor y el daño potencial", async () => {
    const { workbook } = await inspectionsWorkbook()
    const rows = rowsOf(workbook.getWorksheet("Respuestas")!)

    // La etiqueta de la opción elegida, no `pqs`.
    expect(rowWhere(rows, "Ítem", "Tipo de extintor")["Valor"]!.value).toBe("PQS (Polvo Químico Seco)")
    // La fecha como la muestra la pantalla, no `2027-03-05`.
    expect(rowWhere(rows, "Ítem", "Vencimiento de la carga")["Valor"]!.value).toBe("05-03-2027")

    const sello = rowWhere(rows, "Ítem", "Sello de seguridad")
    expect(sello["Daño potencial"]!.value).toBe("Grave")
    // La escala del instrumento (B/R/M), no «No cumple».
    expect(sello["Resultado"]!.value).toBe("Malo")
  })

  it("«Hallazgos» lleva clasificación con etiqueta, el código de la CAPA y «Cerrado» como fecha", async () => {
    const { workbook } = await inspectionsWorkbook()
    const rows = rowsOf(workbook.getWorksheet("Hallazgos")!)

    const conCapa = rowWhere(rows, "Descripción", "Sello roto en el extintor")
    expect(conCapa["Clasificación de daño"]!.value).toBe("Grave")
    expect(conCapa["Criticidad"]!.value).toBe("Alta")
    expect(conCapa["Estado"]!.value).toBe("Con CAPA")
    // El código que se busca en /prevencion/capa, no el id interno.
    expect(conCapa["CAPA"]!.value).toBe("CAPA-EXP-001")

    const cerrado = rowWhere(rows, "Descripción", "Manguera con grietas")
    expect(cerrado["Clasificación de daño"]!.value).toBe("Moderado")
    expect(wallClock(cerrado["Cerrado"]!)).toBe("2026-10-19T17:30")
    expect(cerrado["Cerrado"]!.numFmt).toBe("dd-mm-yyyy hh:mm")
    expect(cerrado["CAPA"]!.value || "").toBe("")
  })

  it("«Plantillas» distingue retirada de reemplazada, trae «Aprobada» como fecha y la procedencia", async () => {
    const { workbook } = await inspectionsWorkbook()
    const rows = rowsOf(workbook.getWorksheet("Plantillas")!)

    expect(rowWhere(rows, "Código", "retirada")["Estado"]!.value).toBe("Retirada")
    expect(rowWhere(rows, "Código", "reemplazada")["Estado"]!.value).toBe("Reemplazada")

    const oficial = rowWhere(rows, "Código", "oficial")
    expect(oficial["Estado"]!.value).toBe("Borrador")
    expect(oficial["Procedencia"]!.value).toBe("Documento oficial")

    const extintores = rowWhere(rows, "Código", "extintores")
    expect(extintores["Estado"]!.value).toBe("Aprobada")
    expect(extintores["Procedencia"]!.value).toBe("Definición de plataforma")
    expect(wallClock(extintores["Aprobada"]!)).toBe("2026-06-15T08:00")
    expect(extintores["Aprobada"]!.numFmt).toBe("dd-mm-yyyy hh:mm")
  })

  /**
   * R-11 (reauditoría 2026-10-20): la columna «Origen» traía el código interno de la definición
   * (`caminata_seguridad`). Se lee con el nombre con que el catálogo la conoce.
   */
  it("«Plantillas» rotula «Origen» con el nombre de la definición, no con su código interno", async () => {
    const { workbook } = await inspectionsWorkbook()
    const rows = rowsOf(workbook.getWorksheet("Plantillas")!)

    expect(rowWhere(rows, "Código", "observacion")["Origen"]!.value).toBe("Caminata de seguridad")
    // Sin definición de origen no hay nada que rotular; una que ya no existe cae a su código legible.
    expect(rowWhere(rows, "Código", "extintores")["Origen"]!.value || "").toBe("")
    expect(rowWhere(rows, "Código", "retirada")["Origen"]!.value).toBe("Definicion retirada del catalogo")
    for (const row of rows) expect(String(row["Origen"]!.value ?? "")).not.toMatch(/_/)
  })

  it("«Programación» lleva la frecuencia en español, «Próxima» como fecha y el sujeto al final", async () => {
    const { workbook } = await inspectionsWorkbook()
    const sheet = workbook.getWorksheet("Programación")!
    const rows = rowsOf(sheet)
    const mensual = rowWhere(rows, "Frecuencia", "Mensual")

    expect(wallClock(mensual["Próxima"]!, "day")).toBe("2026-11-05")
    expect(mensual["Próxima"]!.numFmt).toBe("dd-mm-yyyy")
    expect(headersOf(sheet).at(-1)).toBe("Sujeto")
    // Sin recurso concreto, el tipo declarado.
    expect(mensual["Sujeto"]!.value).toBe("Contenedor")

    // Con contenedor del catálogo, su etiqueta (código · ubicación), igual que la ejecución que genera.
    expect(rowWhere(rows, "Frecuencia", "Semanal")["Sujeto"]!.value).toBe("CS-EXP-1 · Acopio")
  })
})

describe("Excel de Inspecciones — trazabilidad del archivo", () => {
  it("el libro lleva la hoja «Metadatos» con los filtros en palabras de la pantalla", async () => {
    const { workbook } = await inspectionsWorkbook({ status: "completed", assignedToUserId: ASIGNADA })

    const metadatos = workbook.getWorksheet("Metadatos")
    expect(metadatos, "REP-002: sin contexto el libro no decía quién lo generó ni con qué alcance").toBeDefined()
    const entries = new Map<string, string>()
    metadatos!.eachRow((row) => entries.set(String(row.getCell(1).value), String(row.getCell(2).value)))

    expect(entries.get("Generado")).toMatch(/\(hora de Chile\)$/)
    expect(entries.get("Generado por")).toBe("revisor@exp.cl")
    const filtros = entries.get("Filtros aplicados")!
    expect(filtros).toContain("Pendiente de revisión")
    expect(filtros).toContain("Ana Asignada")
    expect(filtros).not.toContain(ASIGNADA)
    expect(filtros).not.toContain("completed")
  })

  it("el responsable acota las filas del libro", async () => {
    const { workbook } = await inspectionsWorkbook({ assignedToUserId: ASIGNADA })
    const codigos = rowsOf(workbook.getWorksheet("Inspecciones")!).map((row) => row["Código"]!.value)
    expect(codigos).toEqual(["INS-EXP-0001"])
  })

  it("el nombre del archivo declara el alcance, también con responsable y fechas", async () => {
    const sinFiltros = await buildInspectionExport(access, {})
    expect(sinFiltros.filenameBase).toMatch(/^inspecciones_\d{4}-\d{2}-\d{2}$/)

    for (const filter of [
      { assignedToUserId: ASIGNADA },
      { executedFrom: "2026-10-01" },
      { executedTo: "2026-10-31" },
      { worksiteId: WS },
      { status: "completed" },
    ]) {
      const report = await buildInspectionExport(access, filter)
      expect(report.filenameBase, JSON.stringify(filter)).toMatch(/^inspecciones_filtradas_\d{4}-\d{2}-\d{2}$/)
    }

    // Acotar por tipo no es «filtrar»: ya se dice en el nombre.
    const auditorias = await buildInspectionExport(access, { kinds: ["audit"] })
    expect(auditorias.filenameBase).toMatch(/^inspecciones_audit_\d{4}-\d{2}-\d{2}$/)
  })

  it("sin permiso de exportar no entrega nada", async () => {
    await expect(buildInspectionExport({ ...access, permissions: ["prevention:inspections:view"] }, {}))
      .rejects.toThrow(/fuera de alcance/)
  })
})

describe("inspectionExportFilterSummary", () => {
  it("sin filtros lo dice, en vez de escribir un objeto vacío", () => {
    expect(inspectionExportFilterSummary({})).toEqual({ Filtros: "Ninguno" })
  })

  it("traduce cada filtro y cae al id solo cuando no conoce el nombre", () => {
    expect(inspectionExportFilterSummary({
      kinds: ["audit"],
      status: "in_progress",
      view: "pending_review",
      worksiteId: "ws-1",
      assignedToUserId: "u-1",
      search: "  extintor ",
      executedFrom: "2026-10-01",
      executedTo: "2026-10-19",
    }, { worksiteName: "Faena Norte" })).toEqual({
      Tipo: "Auditoría",
      Estado: "En ejecución",
      Vista: "Pendientes de revisión",
      Faena: "Faena Norte",
      Responsable: "u-1",
      Búsqueda: "extintor",
      "Ejecutadas desde": "01-10-2026",
      "Ejecutadas hasta": "19-10-2026",
    })
  })
})

/* ── Excel de Seguimiento (Anexo 15) ─────────────────────────────────────── */

/** Encabezados y hojas oficiales del Anexo 15: no cambian ni se reordenan. */
const ANEXO_15_HEADERS = ["Fecha", "Área", "Desviación", "Medidas correctivas", "Responsable", "Fecha Ejecución MC", "Status", "% Cumplimiento", "Comentarios"]
const ANEXO_15_SHEETS = ["SEGUIMENTO INSPECCIONES", "SEGUIMIENTO OBSERVACIONES"]
const COLUMNAS_NUEVAS = ["Faena", "Sujeto", "Tipo de instrumento", "Inspección", "Criticidad", "Acción CAPA"]

async function followupWorkbook() {
  return open(await buildInspectionFollowupWorkbook(access))
}

describe("Excel de Seguimiento (Anexo 15)", () => {
  it("conserva los nombres de hoja y los nueve encabezados oficiales, en su orden", async () => {
    const workbook = await followupWorkbook()

    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(ANEXO_15_SHEETS)
    for (const sheet of workbook.worksheets) {
      const headers = headersOf(sheet)
      // A–I idénticos al formato oficial; J–O, lo nuevo.
      expect(headers.slice(0, 9)).toEqual(ANEXO_15_HEADERS)
      expect(headers.slice(9)).toEqual(COLUMNAS_NUEVAS)
      // Las seis columnas nuevas quedan dentro del autofiltro.
      expect(JSON.stringify(sheet.autoFilter)).toMatch(/"column":15|O1/)
    }
  })

  it("«Fecha» y «Fecha Ejecución MC» son celdas de fecha dd-mm-yyyy, y el avance sigue en 0%", async () => {
    const sheet = (await followupWorkbook()).getWorksheet("SEGUIMENTO INSPECCIONES")!
    const rows = rowsOf(sheet)
    const conCapa = rowWhere(rows, "Desviación", "Sello roto en el extintor")

    expect(wallClock(conCapa["Fecha"]!, "day")).toBe("2026-10-19")
    expect(conCapa["Fecha"]!.numFmt).toBe("dd-mm-yyyy")
    expect(wallClock(conCapa["Fecha Ejecución MC"]!, "day")).toBe("2026-11-02")
    expect(conCapa["Fecha Ejecución MC"]!.numFmt).toBe("dd-mm-yyyy")

    expect(conCapa["% Cumplimiento"]!.value).toBe(0.4)
    expect(conCapa["% Cumplimiento"]!.numFmt).toBe("0%")
    // La primera fila de datos es una fecha: A2.
    expect(sheet.getCell("A2").value).toBeInstanceOf(Date)
    expect(sheet.getCell("H2").numFmt).toBe("0%")
  })

  it("agrega a la derecha la faena, el sujeto, el tipo, la inspección, la criticidad y la CAPA", async () => {
    const sheet = (await followupWorkbook()).getWorksheet("SEGUIMENTO INSPECCIONES")!
    const rows = rowsOf(sheet)
    const conCapa = rowWhere(rows, "Desviación", "Sello roto en el extintor")

    expect(conCapa["Faena"]!.value).toBe("Faena Exportación")
    expect(conCapa["Sujeto"]!.value).toBe("Extintor QA 01")
    expect(conCapa["Tipo de instrumento"]!.value).toBe("Inspección")
    expect(conCapa["Inspección"]!.value).toBe("INS-EXP-0001")
    expect(conCapa["Criticidad"]!.value).toBe("Alta")
    expect(conCapa["Acción CAPA"]!.value).toBe("CAPA-EXP-001")
    // «Área» conserva su semántica: el sujeto, o la faena si no hay sujeto.
    expect(conCapa["Área"]!.value).toBe("Extintor QA 01")

    // Un hallazgo sin acción: sin fecha MC, y «Status» sigue diciendo «Sin CAPA».
    const sinCapa = rowWhere(rows, "Desviación", "Manguera con grietas")
    expect(sinCapa["Status"]!.value).toBe("Sin CAPA")
    expect(sinCapa["Acción CAPA"]!.value || "").toBe("")
    expect(sinCapa["Fecha Ejecución MC"]!.value ?? "").toBe("")
  })

  it("la hoja de observaciones separa por tipo y usa el día de Chile", async () => {
    const workbook = await followupWorkbook()
    const inspecciones = rowsOf(workbook.getWorksheet("SEGUIMENTO INSPECCIONES")!)
    expect(inspecciones.map((row) => row["Inspección"]!.value)).not.toContain("OBS-EXP-0001")

    const [observacion] = rowsOf(workbook.getWorksheet("SEGUIMIENTO OBSERVACIONES")!)
    expect(observacion!["Inspección"]!.value).toBe("OBS-EXP-0001")
    expect(observacion!["Tipo de instrumento"]!.value).toBe("Observación planeada")
    expect(observacion!["Criticidad"]!.value).toBe("Media")
    // 01:30Z del 20-10 es todavía 19-10 en Chile.
    expect(wallClock(observacion!["Fecha"]!, "day")).toBe("2026-10-19")
    // Sin sujeto declarado, «Área» cae a la faena y «Sujeto» queda vacío.
    expect(observacion!["Área"]!.value).toBe("Faena Exportación")
    expect(observacion!["Sujeto"]!.value || "").toBe("")
  })

  it("sin permiso de exportar no entrega nada", async () => {
    await expect(buildInspectionFollowupWorkbook({ ...access, permissions: ["prevention:inspections:view"] }))
      .rejects.toThrow(/Sin permiso/)
  })
})

/* ── Seguimiento: orden de atención y filtros (listInspectionFollowup) ───────────────────────── */

describe("Seguimiento — listInspectionFollowup", () => {
  /** El día de Chile contra el que se mide lo vencido: fijo, para que el reloj no cambie el resultado. */
  const TODAY = "2026-10-20"
  const WS2 = "ws-exp-2"
  const RUN_FUP = "run-fup"
  const attention = { order: "attention", today: TODAY } as const
  const ids = (rows: { findingId: string }[]) => rows.map((row) => row.findingId)

  beforeAll(async () => {
    await testDb.insert(schema.worksites).values({ id: WS2, name: "Faena Seguimiento Dos", code: "FUP", isActive: true })
    await testDb.insert(schema.preventionInspectionRuns).values({
      id: RUN_FUP, code: "INS-FUP-0001", templateId: TPL_EXT, worksiteId: WS2, status: "reviewed",
      subjectLabel: "Camión FUP-1", executedByUserId: EJECUTOR, executedAt: "2026-09-01T15:00:00.000Z",
      reviewedByUserId: REVISOR, reviewedAt: "2026-09-02T15:00:00.000Z", createdByUserId: EJECUTOR,
    })
    const capa = (id: string, code: string, status: string, targetDate: string, over: Record<string, unknown> = {}) => ({
      id, code, sourceType: "inspection", sourceId: RUN_FUP, worksiteId: WS2,
      finding: "Hallazgo FUP", actionDescription: `Medida de ${code}`, targetDate, status,
      createdByUserId: REVISOR, createdAt: "2026-09-02T16:00:00.000Z", updatedAt: "2026-09-02T16:00:00.000Z", ...over,
    })
    await testDb.insert(schema.preventionCapaActions).values([
      capa("capa-fup-late", "CAPA-FUP-001", "pending", "2026-10-01", { actionDescription: "Cambiar la manguera dañada", responsibleUserId: ASIGNADA }),
      // Más atrasada que la anterior, y con responsable sólo por texto (sin usuario).
      capa("capa-fup-late2", "CAPA-FUP-002", "in_progress", "2026-09-15", { responsibleSnapshot: "Contratista Externo" }),
      // Plazo vencido pero ya cerrada: no cuenta como vencida.
      capa("capa-fup-done", "CAPA-FUP-003", "closed", "2026-09-10"),
      // Vence hoy: todavía no está vencida.
      capa("capa-fup-today", "CAPA-FUP-004", "pending", "2026-10-20"),
    ])
    await testDb.insert(schema.preventionInspectionFindings).values([
      { id: "fnd-fup-late", runId: RUN_FUP, description: "Manguera dañada FUP", criticality: "high", status: "capa_linked", capaActionId: "capa-fup-late", createdAt: "2026-09-01T15:10:00.000Z" },
      { id: "fnd-fup-late2", runId: RUN_FUP, description: "Extintor sin presión FUP", criticality: "critical", status: "capa_linked", capaActionId: "capa-fup-late2", createdAt: "2026-09-01T15:11:00.000Z" },
      { id: "fnd-fup-done", runId: RUN_FUP, description: "Señal borrada FUP", criticality: "low", status: "closed", capaActionId: "capa-fup-done", closedByUserId: REVISOR, closedAt: "2026-09-12T15:00:00.000Z", createdAt: "2026-09-01T15:12:00.000Z" },
      { id: "fnd-fup-today", runId: RUN_FUP, description: "Piso resbaloso FUP", criticality: "medium", status: "capa_linked", capaActionId: "capa-fup-today", createdAt: "2026-09-01T15:13:00.000Z" },
      { id: "fnd-fup-sin", runId: RUN_FUP, description: "Luminaria apagada FUP", criticality: "medium", status: "open", createdAt: "2026-09-01T15:14:00.000Z" },
    ])
  })

  it("la pantalla ordena por atención: vencidas (la más atrasada primero), sin acción CAPA, abiertas por plazo y cerradas", async () => {
    const rows = await listInspectionFollowup(access, {}, attention)

    expect(ids(rows)).toEqual([
      "fnd-fup-late2", "fnd-fup-late", // vencidas: 15-09 antes que 01-10
      "fnd-fup-sin", "fnd-exp-obs", // sin acción CAPA, en orden cronológico
      "fnd-fup-today", "fnd-exp-1", // abiertas: vence hoy antes que 02-11
      "fnd-fup-done", "fnd-exp-2", // cerradas (una con CAPA cerrada, otra cerrada sin CAPA)
    ])
    expect(Object.fromEntries(rows.map((row) => [row.findingId, row.followupStatus]))).toEqual({
      "fnd-fup-late2": "vencidas", "fnd-fup-late": "vencidas",
      "fnd-fup-sin": "sin_capa", "fnd-exp-obs": "sin_capa",
      "fnd-fup-today": "abiertas", "fnd-exp-1": "abiertas",
      "fnd-fup-done": "cerradas", "fnd-exp-2": "cerradas",
    })
  })

  it("sin pedir orden conserva el cronológico de siempre, que es el del Excel oficial", async () => {
    const chronological = [
      "fnd-fup-late", "fnd-fup-late2", "fnd-fup-done", "fnd-fup-today", "fnd-fup-sin", // run del 01-09
      "fnd-exp-1", "fnd-exp-2", // run del 19-10
      "fnd-exp-obs", // run del 20-10
    ]

    expect(ids(await listInspectionFollowup(access, {}, { today: TODAY }))).toEqual(chronological)
    expect(ids(await listInspectionFollowup(access))).toEqual(chronological)
    expect(ids(await listInspectionFollowup(access, {}, { order: "chronological", today: TODAY }))).toEqual(chronological)
  })

  it("el día del plazo todavía no está vencido; pasa a vencida al día siguiente", async () => {
    const statusOf = async (today: string, id: string) =>
      (await listInspectionFollowup(access, {}, { today })).find((row) => row.findingId === id)?.followupStatus

    expect(await statusOf("2026-10-20", "fnd-fup-today")).toBe("abiertas")
    expect(await statusOf("2026-10-21", "fnd-fup-today")).toBe("vencidas")
    // Una acción cerrada no vence nunca, por atrasado que esté su plazo.
    expect(await statusOf("2027-01-01", "fnd-fup-done")).toBe("cerradas")
  })

  it("cada estado filtra exactamente su subconjunto, y los cuatro juntos son el total", async () => {
    const byStatus = async (status: "sin_capa" | "abiertas" | "vencidas" | "cerradas") =>
      ids(await listInspectionFollowup(access, { status }, attention)).sort()

    const parts = {
      vencidas: await byStatus("vencidas"),
      sin_capa: await byStatus("sin_capa"),
      abiertas: await byStatus("abiertas"),
      cerradas: await byStatus("cerradas"),
    }
    expect(parts.vencidas).toEqual(["fnd-fup-late", "fnd-fup-late2"])
    expect(parts.sin_capa).toEqual(["fnd-exp-obs", "fnd-fup-sin"])
    expect(parts.abiertas).toEqual(["fnd-exp-1", "fnd-fup-today"])
    expect(parts.cerradas).toEqual(["fnd-exp-2", "fnd-fup-done"])
    // Excluyentes y completos: ninguna fila queda sin estado ni cuenta en dos.
    const all = ids(await listInspectionFollowup(access, {}, attention)).sort()
    expect(Object.values(parts).flat().sort()).toEqual(all)
  })

  it("filtra por faena y por tipo de instrumento", async () => {
    expect(ids(await listInspectionFollowup(access, { worksiteId: WS2 }, attention))).toEqual([
      "fnd-fup-late2", "fnd-fup-late", "fnd-fup-sin", "fnd-fup-today", "fnd-fup-done",
    ])
    expect(ids(await listInspectionFollowup(access, { kind: "observation" }, attention))).toEqual(["fnd-exp-obs"])
    expect(await listInspectionFollowup(access, { kind: "audit" }, attention)).toEqual([])
  })

  it("busca en el hallazgo, la medida, los códigos, el sujeto, la faena y el responsable, sin distinguir mayúsculas", async () => {
    const search = async (text: string) => ids(await listInspectionFollowup(access, { search: text }, attention)).sort()

    expect(await search("MANGUERA")).toEqual(["fnd-exp-2", "fnd-fup-late"]) // hallazgo "Manguera con grietas" y "Manguera dañada"
    expect(await search("repuesto")).toEqual([]) // el seguimiento no es campo de búsqueda
    expect(await search("capa-fup-002")).toEqual(["fnd-fup-late2"]) // código de la acción
    expect(await search("INS-FUP")).toHaveLength(5) // código de la inspección
    expect(await search("Camión FUP-1")).toHaveLength(5) // sujeto
    expect(await search("Seguimiento Dos")).toHaveLength(5) // faena
    expect(await search("Ana Asignada")).toEqual(["fnd-exp-1", "fnd-fup-late"]) // responsable con usuario
    expect(await search("Contratista")).toEqual(["fnd-fup-late2"]) // responsable sólo por texto
    expect(await search("Reponer el sello")).toEqual(["fnd-exp-1"]) // medida
  })

  it("lo que se escribe en el buscador se busca tal cual: % y _ no son comodines", async () => {
    expect(await listInspectionFollowup(access, { search: "%" }, attention)).toEqual([])
    expect(await listInspectionFollowup(access, { search: "_" }, attention)).toEqual([])
    expect(await listInspectionFollowup(access, { search: "\\" }, attention)).toEqual([])
  })

  it("combina filtros: todos acotan a la vez", async () => {
    const rows = await listInspectionFollowup(access, { worksiteId: WS2, status: "vencidas", search: "extintor" }, attention)

    expect(ids(rows)).toEqual(["fnd-fup-late2"])
  })

  it("los filtros nunca amplían el alcance de faenas de quien mira", async () => {
    const onlyWs = { ...access, scope: { mode: "some", ids: [WS] } as WorksiteScope }

    expect(ids(await listInspectionFollowup(onlyWs, {}, attention))).toEqual(["fnd-exp-obs", "fnd-exp-1", "fnd-exp-2"])
    // Pedir una faena fuera de su alcance no la revela.
    expect(await listInspectionFollowup(onlyWs, { worksiteId: WS2 }, attention)).toEqual([])
    // Sin ninguna faena en el alcance, nada.
    expect(await listInspectionFollowup({ ...access, scope: { mode: "some", ids: [] } as WorksiteScope }, {}, attention)).toEqual([])
  })

  it("trae el último seguimiento de la acción, el responsable y el avance", async () => {
    const rows = await listInspectionFollowup(access, {}, attention)
    const withFollowup = rows.find((row) => row.findingId === "fnd-exp-1")!

    expect(withFollowup.lastFollowup).toEqual({ at: expect.stringContaining("2026-10-20"), author: "Rodrigo Revisor", note: "Se pidió el repuesto" })
    expect(withFollowup.progress).toBe(40)
    expect(withFollowup.responsible).toBe("Ana Asignada")
    expect(rows.find((row) => row.findingId === "fnd-fup-late2")!.responsible).toBe("Contratista Externo")
    // Sin seguimientos o sin acción: nada que mostrar.
    expect(rows.find((row) => row.findingId === "fnd-fup-late")!.lastFollowup).toBeNull()
    expect(rows.find((row) => row.findingId === "fnd-exp-obs")!.lastFollowup).toBeNull()
  })

  it("sin permiso de ver no entrega nada", async () => {
    await expect(listInspectionFollowup({ ...access, permissions: [] }, {}, attention)).rejects.toThrow(/fuera de alcance/)
  })
})

describe("Excel de Seguimiento — respeta los filtros pero no el orden de la pantalla", () => {
  const TODAY = "2026-10-20"
  /** La faena que sembró el bloque de arriba. */
  const WS2 = "ws-exp-2"
  const desviaciones = (workbook: ExcelJS.Workbook, sheet: string) =>
    rowsOf(workbook.getWorksheet(sheet)!).map((row) => row["Desviación"]!.value)

  it("con un estado entrega sólo esas filas, en el orden cronológico del formato oficial", async () => {
    const workbook = await open(await buildInspectionFollowupWorkbook(access, { status: "vencidas" }, { today: TODAY }))

    // La pantalla pondría primero la más atrasada («Extintor sin presión»); el Excel conserva el cronológico.
    expect(desviaciones(workbook, "SEGUIMENTO INSPECCIONES")).toEqual(["Manguera dañada FUP", "Extintor sin presión FUP"])
    expect(desviaciones(workbook, "SEGUIMIENTO OBSERVACIONES")).toEqual([])
  })

  it("con un tipo, la hoja del otro tipo queda con sus encabezados oficiales y sin filas", async () => {
    const workbook = await open(await buildInspectionFollowupWorkbook(access, { kind: "observation" }, { today: TODAY }))

    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(ANEXO_15_SHEETS)
    expect(desviaciones(workbook, "SEGUIMENTO INSPECCIONES")).toEqual([])
    expect(desviaciones(workbook, "SEGUIMIENTO OBSERVACIONES")).toEqual(["Orden deficiente en la bodega"])
    for (const sheet of workbook.worksheets) expect(headersOf(sheet).slice(0, 9)).toEqual(ANEXO_15_HEADERS)
  })

  it("faena y texto se combinan, y sin filtros sigue entregando el universo entero", async () => {
    const filtered = await open(await buildInspectionFollowupWorkbook(access, { worksiteId: WS2, search: "FUP-1" }, { today: TODAY }))
    expect(desviaciones(filtered, "SEGUIMENTO INSPECCIONES")).toHaveLength(5)

    const all = await open(await buildInspectionFollowupWorkbook(access, {}, { today: TODAY }))
    expect(desviaciones(all, "SEGUIMENTO INSPECCIONES")).toHaveLength(7)
  })
})
