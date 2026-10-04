/**
 * Importación del RE-04 real (§9.3, Task 7 de la F3) contra PGlite.
 *
 * Se prueba con un **Excel de verdad** —armado con ExcelJS, con el encabezado del
 * formato en las filas 12-13— porque el contrato que importa es el del archivo:
 * los textos «SÍ, CONTROLADO» / «NO RUTINARIA», el MR que no coincide con P × C
 * y la P fuera de la escala. Lo que se afirma:
 *
 * 1. La fila con MR incoherente se carga y lo que queda guardado es `p × c`
 *    (el cálculo manda y la plataforma no puede escribir otra cosa: `magnitude` y
 *    `classification` son columnas generadas).
 * 2. La fila con P fuera de la escala **no** se carga: queda `ignorada` y
 *    `rejected` con su problema.
 * 3. El lote queda `activated`, con `risk_entry_id` por fila y la traza del Excel
 *    (`source_row_number`, `source_original`, `source_normalized`) en la fila.
 * 4. El borrador queda dueño del lote (`source_import_batch_id`); al agregar al
 *    vigente el lote queda **sin dueño** (lo impide el índice único) y la matriz
 *    aparece en «Requieren mi acción» de la portada como «Cambios sin
 *    enviar».
 * 5. El aviso de fila Intolerable sale **después del COMMIT**: ninguna resolución
 *    de destinatarios ocurre con una transacción abierta.
 */
import { createHash } from "node:crypto"
import path from "node:path"
import ExcelJS from "exceljs"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { and, asc, eq, inArray } from "drizzle-orm"
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { ZodError } from "zod"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { normalizeMeasure } from "@/lib/prevention/miper/dedup"
import { normalizeMiperName } from "@/lib/prevention/miper/names"
import { analyzeRe04Measures, suggestedMappings, type ImportMappings } from "@/lib/prevention/miper/re04-measures"
import { RE04_COLUMNS, RE04_SHEET_NAME } from "@/lib/prevention/miper/re04-import"
import { RiskLegalDomainError } from "@/lib/services/prevention-risk-legal-errors"
import { todayInChile } from "@/lib/utils"
import { IMPORT_LIMITS } from "@/lib/validation/prevention-module/miper"

/** Evidencia de que ningún aviso se resolvió dentro de una transacción. */
const spy = vi.hoisted(() => ({
  openTransactions: 0,
  /** Transacciones abiertas desde el último reinicio: una carga rechazada por el esquema no abre ninguna. */
  transactionsStarted: 0,
  recipientLookups: [] as Array<{ permission: string; worksiteId: string; openTransactions: number }>,
  /** La próxima lectura de un lote dentro de una transacción lo ve `staged` (ver `withStaleBatchRead`). */
  staleBatchRead: false,
}))

vi.mock("@/lib/services/notification-targeting", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/services/notification-targeting")>()
  return {
    ...actual,
    getUserIdsWithPermissionForWorksite: async (permission: string, worksiteId: string) => {
      spy.recipientLookups.push({ permission, worksiteId, openTransactions: spy.openTransactions })
      return actual.getUserIdsWithPermissionForWorksite(permission, worksiteId)
    },
  }
})

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const g = globalThis as typeof globalThis & { __db?: DB }

/** El resultado de una consulta con cada fila `staged`, a cualquier profundidad de la cadena (`.where().limit()`). */
function readAsStaged<T extends object>(query: T): T {
  return new Proxy(query, {
    get(target, property, receiver) {
      if (property === "then") {
        const rows = target as unknown as PromiseLike<Array<Record<string, unknown>>>
        return (onFulfilled?: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) =>
          rows.then((result) => result.map((row) => ({ ...row, status: "staged" }))).then(onFulfilled, onRejected)
      }
      const value: unknown = Reflect.get(target, property, receiver)
      return typeof value === "function" ? (...args: unknown[]) => readAsStaged((value as (...a: unknown[]) => object).apply(target, args)) : value
    },
  })
}

/**
 * La carrera que PGlite (una sola conexión) no produce solo: la vista previa lee
 * el lote ANTES de que una carga confirme —lo ve `staged`— y su DELETE corre
 * DESPUÉS, contra el lote ya `activated` (en Postgres, el DELETE espera el
 * candado de la carga y vuelve a evaluar su WHERE sobre la fila confirmada). La
 * carga corre de verdad antes; esto sólo devuelve la lectura vieja del lote.
 */
function withStaleBatchRead(tx: DB): DB {
  return new Proxy(tx, {
    get(target, property, receiver) {
      if (property !== "select" || !spy.staleBatchRead) return Reflect.get(target, property, receiver)
      return (...args: unknown[]) => {
        const builder = (target.select as (...a: unknown[]) => { from: (table: unknown) => object })(...args)
        return new Proxy(builder, {
          get(query, key, queryReceiver) {
            if (key !== "from") return Reflect.get(query, key, queryReceiver)
            return (table: unknown) => {
              if (table !== schema.preventionRiskImportBatches) return query.from(table)
              spy.staleBatchRead = false
              return readAsStaged(query.from(table))
            }
          },
        })
      }
    },
  })
}

/* El Proxy envuelve `transaction` para saber cuántas hay abiertas y, cuando una
 * prueba lo pide, para servir la lectura vieja de un lote (`withStaleBatchRead`). */
g.__db = new Proxy(testDb as unknown as Record<PropertyKey, unknown>, {
  get(target, property, receiver) {
    if (property === "transaction") {
      return async (run: (tx: DB) => Promise<unknown>) => {
        spy.openTransactions += 1
        spy.transactionsStarted += 1
        try { return await (target as unknown as DB).transaction(((tx: DB) => run(spy.staleBatchRead ? withStaleBatchRead(tx) : tx)) as never) }
        finally { spy.openTransactions -= 1 }
      }
    }
    return Reflect.get(target, property, receiver)
  },
}) as unknown as DB

vi.mock("@/db", () => ({ get db() { return g.__db } }))

const { previewRiskImport, commitRiskImport } = await import("@/lib/services/miper/import")
const { createMiper } = await import("@/lib/services/miper/matrices")
const { listMiperPortfolio } = await import("@/lib/services/miper/portfolio")
const { getMiperWorkspace } = await import("@/lib/services/miper/queries")
const { buildMiperSnapshot } = await import("@/lib/services/miper/snapshots")

const WS = "ws-imp"
const WS_LIVE = "ws-live"
const author = {
  userId: "u-autora",
  scope: { mode: "some" as const, ids: [WS, WS_LIVE] },
  permissions: ["prevention:risk:view", "prevention:risk:edit"],
}

/* ── El Excel del RE-04, hecho con ExcelJS ─────────────────────────────── */

const HEADER_ROW = 12
const SUB_HEADER_ROW = 13
const FIRST_DATA_ROW = 14

type ExcelRow = {
  number?: number
  activity?: string
  task?: string
  position?: string
  location?: string
  female?: number
  male?: number
  other?: number
  factor?: string
  routine?: string
  hazard?: string
  risk?: string
  damage?: string
  probability?: unknown
  consequence?: unknown
  mr?: unknown
  classification?: string
  measures?: string
  controlled?: string
  responsible?: string
  deadlines?: string
}

function rowCells(input: ExcelRow): unknown[] {
  return [
    input.number ?? null, input.activity ?? null, input.task ?? null, input.position ?? null, input.location ?? null,
    input.female ?? null, input.male ?? null, input.other ?? null,
    input.factor ?? null, input.routine ?? null, input.hazard ?? null, input.risk ?? null, input.damage ?? null,
    input.probability ?? null, input.consequence ?? null, input.mr ?? null, input.classification ?? null,
    input.measures ?? null, input.controlled ?? null, input.responsible ?? null, input.deadlines ?? null,
  ]
}

/**
 * Libro mínimo con la forma del RE-04 real: membrete, encabezado doble y datos.
 * `marker` va en el membrete: dos libros con las mismas filas y distinta marca
 * tienen distinto checksum, así que son lotes distintos para la misma faena.
 */
async function workbookOf(rows: ExcelRow[], marker = "Matriz de Identificación de Peligros y Evaluación de Riesgos (IPER)"): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet(RE04_SHEET_NAME)
  sheet.getCell("A1").value = marker
  RE04_COLUMNS.forEach((label, index) => { sheet.getRow(HEADER_ROW).getCell(index + 1).value = label })
  for (const [column, label] of [[14, "PROBABILIDAD"], [15, "CONSECUENCIA"], [16, "MR"], [17, "CLASIFICACIÓN DEL RIESGO"]] as Array<[number, string]>) {
    sheet.getRow(SUB_HEADER_ROW).getCell(column).value = label
  }
  rows.forEach((input, index) => {
    const row = sheet.getRow(FIRST_DATA_ROW + index)
    rowCells(input).forEach((value, column) => {
      if (value !== null && value !== undefined) row.getCell(column + 1).value = value as ExcelJS.CellValue
    })
  })
  return Buffer.from(await workbook.xlsx.writeBuffer())
}

const FIXTURE: ExcelRow[] = [
  {
    // 14: el MR del Excel (8) no coincide con P × C (16) y la fila es Intolerable.
    number: 1, activity: "Transporte de lodo", task: "Descarga", position: "Conductor", location: "Patio de lodos",
    female: 1, male: 3, other: 0, factor: "Mecánico", hazard: "Camión en pendiente", risk: "Volcamiento",
    damage: "Politraumatismo", probability: 4, consequence: 4, mr: 8, classification: "INTOLERABLE",
    measures: "IV. Controles administrativos: procedimiento de descarga", controlled: "NO CONTROLADO",
    responsible: "Supervisor", deadlines: "30-06-2026",
  },
  // 15: P fuera de la escala: no se carga.
  { number: 2, activity: "Transporte de lodo", factor: "Mecánico", hazard: "Camión sin balizas", probability: 3, consequence: 4, classification: "IMPORTANTE" },
  // 16: «SÍ, CONTROLADO» → yes.
  { number: 3, activity: "Mantenimiento", factor: "Físico", hazard: "Ruido de equipo", probability: 2, consequence: 2, mr: 4, classification: "MODERADO", controlled: "SÍ, CONTROLADO" },
  // 17: «NO RUTINARIA» → isRoutine = false.
  { number: 4, activity: "Mantenimiento", factor: "Químico", hazard: "Contacto con solvente", probability: 2, consequence: 4, mr: 8, classification: "IMPORTANTE", routine: "NO RUTINARIA", controlled: "PARCIALMENTE CONTROLADO" },
]

/**
 * Fase C: medidas con las formas del RE-04 de Biodiversa (frases reales,
 * responsables que son cargos, PLAZOS reales). Filas del Excel 14 a 17.
 * - 14: Importante, «PARCIALMENTE CONTROLADO - REQUIERE ACCIÓN INMEDIATA»,
 *   cuatro medidas por comas (una con paréntesis), plazo «INMEDIATO…».
 * - 15: Moderado, tres líneas (ingeniería y la lista de EPP), «TRIMESTRAL ».
 * - 16: Tolerable, dos medidas por «;»; una se repite con la fila 14.
 * - 17: P fuera de la escala: no se carga y sus medidas no piden decisión.
 */
const MEASURES_FIXTURE: ExcelRow[] = [
  {
    number: 1, activity: "Traslado de lodo", task: "Descarga", position: "Conductor", factor: "Mecánico", hazard: "Camión en pendiente",
    risk: "Volcamiento", damage: "Politraumatismo", probability: 2, consequence: 4, mr: 8, classification: "IMPORTANTE",
    measures: "USO DE EPP (CASCO, GUANTES, CALZADO DE SEGURIDAD), ORDEN Y LIMPIEZA, SEÑALIZACIÓN DE ÁREAS, CAPACITACIÓN EN TRABAJO SEGURO.",
    controlled: "PARCIALMENTE CONTROLADO - REQUIERE ACCIÓN INMEDIATA", responsible: "SUPERVISOR/PREVENCION", deadlines: "INMEDIATO / ANTES DE CONTINUAR LA TAREA",
  },
  {
    number: 2, activity: "Mantención", task: "Cambio de neumático", position: "Mecánico", factor: "Mecánico", hazard: "Herramientas manuales",
    risk: "Golpes", damage: "Contusiones", probability: 2, consequence: 2, mr: 4, classification: "MODERADO",
    measures: "INSTALAR RESGUARDOS EN MAQUINAS\nGUANTES, CASCO, CALZADO DE SEGURIDAD",
    controlled: "PARCIALMENTE CONTROLADO", responsible: "SUPERVISOR/PREVENCION", deadlines: "TRIMESTRAL ",
  },
  {
    number: 3, activity: "Mantención", task: "Orden de taller", position: "Mecánico", factor: "Físico", hazard: "Piso resbaladizo",
    risk: "Caída al mismo nivel", damage: "Esguince", probability: 1, consequence: 2, mr: 2, classification: "TOLERABLE",
    measures: "ORDEN Y LIMPIEZA; INSPECCIÓN DE HERRAMIENTAS", controlled: "SÍ, CONTROLADO", responsible: "PREVENCION", deadlines: "TRIMESTRAL",
  },
  { number: 4, activity: "Mantención", factor: "Físico", hazard: "Ruido", probability: 3, consequence: 2, measures: "PROTECTORES AUDITIVOS", responsible: "PREVENCION", deadlines: "MENSUAL" },
]

let fixture: Buffer = Buffer.alloc(0)

const ENTRIES = () => schema.preventionRiskEntries

async function entriesOf(matrixId: string) {
  return testDb.select().from(ENTRIES()).where(eq(ENTRIES().matrixId, matrixId)).orderBy(asc(ENTRIES().rowNumber))
}

async function batchRowsOf(batchId: string) {
  return testDb.select().from(schema.preventionRiskImportRows)
    .where(eq(schema.preventionRiskImportRows.batchId, batchId))
    .orderBy(asc(schema.preventionRiskImportRows.rowNumber))
}

async function matrixOf(matrixId: string) {
  const [row] = await testDb.select().from(schema.preventionRiskMatrices).where(eq(schema.preventionRiskMatrices.id, matrixId))
  return row!
}

async function drainPostCommit(ticks = 50) {
  for (let tick = 0; tick < ticks; tick += 1) await new Promise((resolve) => setTimeout(resolve, 0))
}

/** «Requieren mi acción» de la portada para la autora, en una faena. */
async function myActionsIn(worksiteId: string) {
  return (await listMiperPortfolio(author)).rows.find((row) => row.worksiteId === worksiteId)?.myActions ?? []
}

async function matricesOf(worksiteId: string, period: number) {
  return testDb.select({ id: schema.preventionRiskMatrices.id }).from(schema.preventionRiskMatrices)
    .where(and(eq(schema.preventionRiskMatrices.worksiteId, worksiteId), eq(schema.preventionRiskMatrices.period, period)))
}

async function batchOf(batchId: string) {
  const [batch] = await testDb.select().from(schema.preventionRiskImportBatches).where(eq(schema.preventionRiskImportBatches.id, batchId))
  return batch!
}

/** Los `import_applied` de una MIPER (`newState` del log). */
async function appliedOf(matrixId: string) {
  const log = await testDb.select().from(schema.auditLog)
    .where(and(eq(schema.auditLog.entityType, "risk_legal:risk:miper"), eq(schema.auditLog.entityId, matrixId)))
  return log.map((row) => JSON.parse(row.newState ?? "{}") as Record<string, unknown>).filter((state) => state.changeType === "import_applied")
}

beforeEach(() => {
  spy.recipientLookups = []
  spy.openTransactions = 0
  spy.transactionsStarted = 0
  spy.staleBatchRead = false
})

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  await testDb.insert(schema.worksites).values([
    { id: WS, name: "Faena Importación", code: "IMP" },
    { id: WS_LIVE, name: "Faena Vigente", code: "VIG" },
  ])
  await testDb.insert(schema.users).values([
    { id: "u-autora", name: "Autora MIPER", email: "autora@imp.cl", hashedPassword: "x", isActive: true, emailNotifications: false },
    { id: "u-prev", name: "Prevencionista de faena", email: "prev@imp.cl", hashedPassword: "x", isActive: true, emailNotifications: false },
    { id: "u-jefa", name: "Jefa de Prevención", email: "jefa@imp.cl", hashedPassword: "x", isActive: true, emailNotifications: false },
    { id: "u-legal", name: "Gerencia Legal y RRHH", email: "legal@imp.cl", hashedPassword: "x", isActive: true, emailNotifications: false },
  ])
  await testDb.insert(schema.permissions).values([
    { id: "perm-edit", name: "prevention:risk:edit", description: null, module: "prevention" },
    { id: "perm-review", name: "prevention:risk:review", description: null, module: "prevention" },
    { id: "perm-legal", name: "prevention:risk:approve_legal", description: null, module: "prevention" },
  ])
  await testDb.insert(schema.userPermissions).values([
    { userId: "u-autora", permissionId: "perm-edit" },
    { userId: "u-prev", permissionId: "perm-edit" },
    { userId: "u-jefa", permissionId: "perm-review" },
    { userId: "u-legal", permissionId: "perm-legal" },
  ])
  await testDb.insert(schema.worksiteUsers).values(
    [WS, WS_LIVE].flatMap((worksiteId) => ["u-autora", "u-prev", "u-jefa", "u-legal"].map((userId) => ({ userId, worksiteId }))),
  )
  /* El catálogo RE-04 (Mecánico, Físico, Químico…) lo siembra la migración 0344:
   * el mapeo de factores de la importación se prueba contra el catálogo real. */
  fixture = await workbookOf(FIXTURE)
}, 60_000)

/* ── Vista previa ───────────────────────────────────────────────────────── */

describe("vista previa del RE-04", () => {
  it("lee la hoja, mapea los textos y muestra los problemas por fila", async () => {
    const preview = await previewRiskImport(fixture, { worksiteId: WS, target: "draft", period: 2026, fileName: "RE-04 Biodiversa.xlsx" }, author)

    expect(preview.sheetName).toBe(RE04_SHEET_NAME)
    expect(preview.totals).toEqual({ total: 4, ready: 3, needsReview: 0, rejected: 1 })

    expect(preview.rows[0]!.rowNumber).toBe(14)
    expect(preview.rows[0]!.issues).toContainEqual(expect.objectContaining({ code: "mr_mismatch", excel: 8, calculated: 16 }))
    expect(preview.rows[0]!.normalized.classification).toBe("intolerable")
    expect(preview.rows[0]!.riskFactorId).toBe("riskfactor-mecanico")

    expect(preview.rows[1]!.issues).toContainEqual(expect.objectContaining({ code: "p_out_of_scale" }))
    expect(preview.rows[1]!.status).toBe("rejected")

    expect(preview.rows[2]!.normalized.controlledStatus).toBe("yes")
    expect(preview.rows[3]!.normalized.isRoutine).toBe(false)

    expect(preview.draft.blockedReason).toBeNull()
    expect(preview.live).toMatchObject({ matrixId: null, blockedReason: expect.stringContaining("no tiene una MIPER vigente") })

    const [batch] = await testDb.select().from(schema.preventionRiskImportBatches)
      .where(eq(schema.preventionRiskImportBatches.id, preview.batchId))
    expect(batch).toMatchObject({
      status: "staged",
      sourceFileName: "RE-04 Biodiversa.xlsx",
      // Sin storage: el `.xlsx` se parsea en memoria y queda el marcador de origen.
      sourceFilePath: `inline:${RE04_SHEET_NAME}`,
      sourceSheetName: RE04_SHEET_NAME,
      totalRows: 4,
      readyRows: 3,
      reviewRows: 1,
      createdByUserId: "u-autora",
    })
    expect(batch!.sourceChecksumSha256).toMatch(/^[0-9a-f]{64}$/)
    const rows = await batchRowsOf(preview.batchId)
    expect(rows.map((row) => row.status)).toEqual(["ready", "rejected", "ready", "ready"])
    expect(rows[1]!.issues).toContainEqual(expect.objectContaining({ code: "p_out_of_scale" }))
  })
})

/* ── Medidas detectadas en la vista previa (Fase C) ─────────────────────── */

describe("vista previa: medidas detectadas (Fase C)", () => {
  it("separa las medidas de la celda original, agrupa frases, responsables y plazos, sugiere tipo y plazo, y trae las personas de la faena", async () => {
    const preview = await previewRiskImport(await workbookOf(MEASURES_FIXTURE, "Vista previa con medidas"), { worksiteId: WS, target: "draft", period: 2034, fileName: "RE-04 medidas.xlsx" }, author)
    const analysis = preview.measureAnalysis

    // 4 + 4 + 2 medidas. La fila 17 (P = 3) no se carga nunca: no aporta.
    expect(analysis.measures).toHaveLength(10)
    expect(analysis.measures.some((measure) => measure.rowNumber === 17)).toBe(false)
    // El salto de línea de la fila 15 sobrevivió a ExcelJS y al `jsonb` del lote.
    expect(analysis.measures.filter((measure) => measure.rowNumber === 15).map((measure) => measure.text))
      .toEqual(["INSTALAR RESGUARDOS EN MAQUINAS", "GUANTES", "CASCO", "CALZADO DE SEGURIDAD"])
    // Las filas guardadas en el lote dan el mismo análisis: es lo que la carga
    // vuelve a calcular (Task 8), así que el `jsonb` no pierde nada.
    const stored = await batchRowsOf(preview.batchId)
    expect(analyzeRe04Measures(stored, { today: todayInChile(), users: preview.responsibleOptions })).toEqual(analysis)

    expect(analysis.phrases).toHaveLength(9)
    expect(analysis.phrases[0]).toMatchObject({ text: "ORDEN Y LIMPIEZA", count: 2, suggestion: { hierarchy: "administrative", source: "keyword" } })
    expect(analysis.phrases.find((phrase) => phrase.text.startsWith("USO DE EPP"))!.suggestion.hierarchy).toBe("ppe")
    expect(analysis.phrases.find((phrase) => phrase.text === "INSTALAR RESGUARDOS EN MAQUINAS")!.suggestion.hierarchy).toBe("engineering")

    expect(analysis.responsibles.map((group) => [group.text, group.count, group.suggestion])).toEqual([
      ["SUPERVISOR/PREVENCION", 8, { kind: "text", name: "SUPERVISOR/PREVENCION" }],
      ["PREVENCION", 2, { kind: "text", name: "PREVENCION" }],
    ])
    expect(analysis.deadlines.map((group) => [group.text, group.count, group.suggestion])).toEqual([
      ["TRIMESTRAL", 6, { kind: "existing", frequency: "TRIMESTRAL" }],
      ["INMEDIATO / ANTES DE CONTINUAR LA TAREA", 4, { kind: "pending", dueDate: todayInChile() }],
    ])

    // Los usuarios activos de la faena, para elegir responsable.
    expect(preview.responsibleOptions.map((option) => option.id).sort()).toEqual(["u-autora", "u-jefa", "u-legal", "u-prev"])
    // «PARCIALMENTE CONTROLADO - REQUIERE ACCIÓN INMEDIATA» es parcial (antes caía en «no»).
    expect(preview.rows[0]!.normalized.controlledStatus).toBe("partial")
  })

  it("un RE-04 sin medidas no pide decisiones", async () => {
    const preview = await previewRiskImport(await workbookOf([FIXTURE[2]!], "Sin medidas"), { worksiteId: WS, target: "draft", period: 2034 }, author)
    expect(preview.measureAnalysis).toEqual({ measures: [], phrases: [], responsibles: [], deadlines: [] })
  })
})

/* ── Responsables que se ofrecen (Fase C) ───────────────────────────────── */

describe("vista previa: personas que se ofrecen como responsables (Fase C)", () => {
  const WS_OTHER = "ws-otra"
  const allScope = (userId: string) => ({ userId, scope: { mode: "all" as const, ids: [] as [] }, permissions: ["prevention:risk:view", "prevention:risk:edit"] })
  /* Una fila por RESPONSABLE: el nombre de una persona de la faena, el de una
   * inactiva de la faena y el de una de otra faena. Son cargos, no personas. */
  const RESPONSIBLES_FIXTURE: ExcelRow[] = [
    { number: 1, activity: "Mantención", factor: "Físico", hazard: "Ruido", probability: 1, consequence: 2, measures: "CHARLA DE SEGURIDAD", responsible: "PREVENCIONISTA DE FAENA", deadlines: "MENSUAL" },
    { number: 2, activity: "Mantención", factor: "Físico", hazard: "Ruido", probability: 1, consequence: 2, measures: "INSPECCIÓN DE EXTINTORES", responsible: "SUPERVISORA INACTIVA", deadlines: "MENSUAL" },
    { number: 3, activity: "Mantención", factor: "Físico", hazard: "Ruido", probability: 1, consequence: 2, measures: "PERMISO DE TRABAJO", responsible: "JEFE DE OTRA FAENA", deadlines: "MENSUAL" },
  ]

  /* Sin permisos en la base: no cambian los avisos ni la portada de las demás pruebas. */
  beforeAll(async () => {
    await testDb.insert(schema.worksites).values({ id: WS_OTHER, name: "Otra faena", code: "OTR" })
    await testDb.insert(schema.users).values([
      { id: "u-inactiva", name: "Supervisora inactiva", email: "inactiva@imp.cl", hashedPassword: "x", isActive: false, emailNotifications: false },
      { id: "u-otra", name: "Jefe de otra faena", email: "otra@imp.cl", hashedPassword: "x", isActive: true, emailNotifications: false },
      { id: "u-gerencia", name: "Gerencia de operaciones", email: "gerencia@imp.cl", hashedPassword: "x", isActive: true, emailNotifications: false },
      { id: "u-ex", name: "Ex gerencia", email: "ex@imp.cl", hashedPassword: "x", isActive: false, emailNotifications: false },
    ])
    await testDb.insert(schema.worksiteUsers).values([
      { userId: "u-inactiva", worksiteId: WS },
      { userId: "u-otra", worksiteId: WS_OTHER },
    ])
  })

  it("ofrece sólo a las personas activas de la faena y sugiere a la que el Excel nombra", async () => {
    const preview = await previewRiskImport(await workbookOf(RESPONSIBLES_FIXTURE, "Responsables de la faena"), { worksiteId: WS, target: "draft", period: 2035 }, author)

    // Por nombre; ni la inactiva de la faena ni la de otra faena.
    expect(preview.responsibleOptions.map((option) => option.id)).toEqual(["u-autora", "u-legal", "u-jefa", "u-prev"])
    expect(Object.fromEntries(preview.measureAnalysis.responsibles.map((group) => [group.text, group.suggestion]))).toEqual({
      "PREVENCIONISTA DE FAENA": { kind: "user", userId: "u-prev" },
      "SUPERVISORA INACTIVA": { kind: "text", name: "SUPERVISORA INACTIVA" },
      "JEFE DE OTRA FAENA": { kind: "text", name: "JEFE DE OTRA FAENA" },
    })
  })

  it("quien importa sin ser de la faena se ofrece al final, sólo si está activo", async () => {
    const bytes = await workbookOf(RESPONSIBLES_FIXTURE, "Responsables: quien importa")

    const active = await previewRiskImport(bytes, { worksiteId: WS, target: "draft", period: 2035 }, allScope("u-gerencia"))
    expect(active.responsibleOptions.map((option) => option.id)).toEqual(["u-autora", "u-legal", "u-jefa", "u-prev", "u-gerencia"])

    const inactive = await previewRiskImport(bytes, { worksiteId: WS, target: "draft", period: 2035 }, allScope("u-ex"))
    expect(inactive.responsibleOptions.map((option) => option.id)).toEqual(["u-autora", "u-legal", "u-jefa", "u-prev"])
  })
})

/* ── Topes de la importación (Fase C) ───────────────────────────────────── */

describe("vista previa: topes de la importación (Fase C)", () => {
  it("rechaza más de IMPORT_LIMITS.values responsables distintos antes de guardar el lote", async () => {
    // 1.001 filas con la misma medida y un cargo distinto cada una.
    const rows: ExcelRow[] = Array.from({ length: 1001 }, (_, index) => ({
      number: index + 1, activity: "Mantención", factor: "Físico", hazard: "Ruido", probability: 1, consequence: 2,
      measures: "CHARLA DE SEGURIDAD", responsible: `Cargo ${String(index + 1).padStart(4, "0")}`,
    }))
    const bytes = await workbookOf(rows, "Sobre el tope de responsables")

    const error = await previewRiskImport(bytes, { worksiteId: WS, target: "draft", period: 2036 }, author).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(RiskLegalDomainError)
    expect((error as Error).message).toBe("El archivo trae más de 1000 responsables o plazos distintos. Divide el RE-04 en partes.")

    const checksum = createHash("sha256").update(bytes).digest("hex")
    const batches = await testDb.select({ id: schema.preventionRiskImportBatches.id }).from(schema.preventionRiskImportBatches)
      .where(eq(schema.preventionRiskImportBatches.sourceChecksumSha256, checksum))
    expect(batches).toEqual([])
  }, 60_000)

  it("rechaza un RESPONSABLE o un PLAZOS más largo que el tope de una clave (IMPORT_LIMITS.keyLength) antes de guardar el lote, diciendo la fila y la columna", async () => {
    const long = "SUPERVISOR DE TURNO Y PREVENCIÓN DE RIESGOS ".repeat(80).trim()
    expect(long.length).toBeGreaterThan(IMPORT_LIMITS.keyLength)
    const base: ExcelRow = { number: 1, activity: "Mantención", factor: "Físico", hazard: "Ruido", probability: 1, consequence: 2, measures: "CHARLA DE SEGURIDAD" }
    for (const [row, column] of [[{ ...base, responsible: long }, "RESPONSABLE"], [{ ...base, deadlines: long }, "PLAZOS"]] as const) {
      const bytes = await workbookOf([base, row], `Clave larga en ${column}`)
      const error = await previewRiskImport(bytes, { worksiteId: WS, target: "draft", period: 2036 }, author).catch((caught: unknown) => caught)
      expect(error).toBeInstanceOf(RiskLegalDomainError)
      expect((error as Error).message).toBe(`La fila 15 trae en ${column} un texto de más de 3.000 caracteres: acórtalo en el Excel y vuelve a revisar el archivo.`)

      const checksum = createHash("sha256").update(bytes).digest("hex")
      const batches = await testDb.select({ id: schema.preventionRiskImportBatches.id }).from(schema.preventionRiskImportBatches)
        .where(eq(schema.preventionRiskImportBatches.sourceChecksumSha256, checksum))
      expect(batches).toEqual([])
    }
  }, 60_000)
})

/* ── Carga en un borrador nuevo ─────────────────────────────────────────── */

describe("carga en un borrador", () => {
  it("escribe las filas que pasan, deja fuera la que no, traza el Excel y avisa la Intolerable después del COMMIT", async () => {
    const preview = await previewRiskImport(fixture, { worksiteId: WS, target: "draft", period: 2026, fileName: "RE-04 Biodiversa.xlsx" }, author)
    spy.recipientLookups = []

    const committed = await commitRiskImport({
      batchId: preview.batchId, worksiteId: WS, target: "draft", period: 2026, revisionReason: "Importación del RE-04 2026 de prueba.",
      ...suggestedMappings(preview.measureAnalysis),
    }, author)
    expect(committed).toMatchObject({ created: 3, skipped: 1, notified: 1, target: "draft" })
    // Fase C: la medida de la fila 14 («IV. Controles administrativos: …», «Supervisor», «30-06-2026»).
    expect(committed.measures).toEqual({ total: 1, existing: 0, pending: 1 })
    expect((await buildMiperSnapshot(testDb, committed.matrixId)).entries[0]!.controls).toEqual([expect.objectContaining({
      hierarchy: "administrative", description: "procedimiento de descarga", responsibleName: "Supervisor",
      dueDate: "2026-06-30", isExisting: false, verificationFrequency: null, status: "proposed",
    })])

    const entries = await entriesOf(committed.matrixId)
    expect(entries.map((entry) => entry.rowNumber)).toEqual([1, 2, 3])
    // El MR guardado es siempre P × C: 16, aunque el Excel dijera 8.
    expect(entries.map((entry) => entry.magnitude)).toEqual([16, 4, 8])
    expect(entries.map((entry) => entry.classification)).toEqual(["intolerable", "moderate", "important"])
    expect(entries.map((entry) => entry.sourceRowNumber)).toEqual([14, 16, 17])
    expect(entries[0]!.sourceOriginal).toMatchObject({ "PROBABILIDAD": 4, "MR": 8, "FACTORES DE RIESGO": "Mecánico" })
    expect(entries[0]!.sourceNormalized).toMatchObject({ controlledStatus: "no", magnitude: 16 })
    // El aviso informado queda escrito: el MR del Excel no manda.
    expect(entries[0]!.normalizationDecision).toBe("mr_mismatch")
    expect(entries[0]!.riskFactorId).toBe("riskfactor-mecanico")
    expect(entries[2]!.isRoutine).toBe(false)

    const batchData = await batchRowsOf(preview.batchId)
    expect(batchData.map((row) => row.status)).toEqual(["activated", "rejected", "activated", "activated"])
    expect(batchData.map((row) => row.resolution)).toEqual(["creada_en_borrador", "ignorada", "creada_en_borrador", "creada_en_borrador"])
    expect(batchData[0]!.riskEntryId).toBe(entries[0]!.id)
    expect(batchData[1]!.riskEntryId).toBeNull()

    const [batch] = await testDb.select().from(schema.preventionRiskImportBatches)
      .where(eq(schema.preventionRiskImportBatches.id, preview.batchId))
    expect(batch).toMatchObject({ status: "activated", activatedMatrixId: committed.matrixId, approvedByUserId: "u-autora", activatedByUserId: "u-autora" })
    expect(batch!.approvedAt).not.toBeNull()
    expect(batch!.activatedAt).not.toBeNull()

    // El lote es dueño de la matriz que él mismo creó.
    const matrix = await matrixOf(committed.matrixId)
    expect(matrix.sourceImportBatchId).toBe(preview.batchId)
    expect(matrix.status).toBe("draft")

    const log = await testDb.select().from(schema.auditLog)
      .where(and(eq(schema.auditLog.entityType, "risk_legal:risk:miper"), eq(schema.auditLog.entityId, committed.matrixId)))
    const changes = log.map((row) => (JSON.parse(row.newState ?? "{}") as { changeType?: string }).changeType)
    // Una por fila cargada + una de la matriz; ninguna `entry_created` (la fila
    // entró por el importador, no por la grilla).
    expect(changes.filter((change) => change === "import_applied")).toHaveLength(4)
    // Un `import_applied` por riesgo, con su cuenta de medidas (sólo la fila 14 trae una).
    expect((await appliedOf(committed.matrixId)).filter((state) => state.object === "entry").map((state) => state.measures).sort()).toEqual([0, 0, 1])
    expect(changes).not.toContain("entry_created")

    await drainPostCommit()
    const notices = await testDb.select().from(schema.notifications)
      .where(and(eq(schema.notifications.type, "miper_row_intolerable"), eq(schema.notifications.dedupeKey, `miper-row-intolerable:${entries[0]!.id}`)))
    // El prevencionista y la Jefa; el autor (que edita) no se avisa a sí mismo.
    expect(notices.map((notice) => notice.userId).sort()).toEqual(["u-jefa", "u-prev"])
    expect(notices.every((notice) => notice.entityId === committed.matrixId)).toBe(true)

    // Ninguna resolución de destinatarios ocurrió dentro de una transacción.
    expect(spy.recipientLookups.length).toBeGreaterThan(0)
    expect(spy.recipientLookups.every((lookup) => lookup.openTransactions === 0)).toBe(true)
  }, 60_000)
})

/* ── Carga al MIPER vigente ─────────────────────────────────────────────── */

describe("agregado al MIPER vigente", () => {
  it("no le pone dueño al lote y deja la matriz como «Cambios sin enviar»", async () => {
    const live = await createMiper({ worksiteId: WS_LIVE, period: 2026, revisionReason: "MIPER vigente para probar el agregado." }, author)
    const publishedAt = "2020-01-01T00:00:00.000Z"
    await testDb.update(schema.preventionRiskMatrices)
      .set({ status: "published", reviewState: "none", publishedAt, updatedAt: publishedAt, reviewedByUserId: "u-jefa", approvedByUserId: "u-legal" })
      .where(eq(schema.preventionRiskMatrices.id, live.id))
    // Antes de importar, «Requieren mi acción» no la tiene: no hay cambios sin enviar.
    expect((await myActionsIn(WS_LIVE)).some((action) => action.matrixId === live.id)).toBe(false)

    const preview = await previewRiskImport(fixture, { worksiteId: WS_LIVE, target: "live", fileName: "RE-04 Biodiversa.xlsx" }, author)
    expect(preview.live.matrixId).toBe(live.id)
    expect(preview.live.blockedReason).toBeNull()

    const committed = await commitRiskImport({ batchId: preview.batchId, worksiteId: WS_LIVE, target: "live", ...suggestedMappings(preview.measureAnalysis) }, author)
    expect(committed).toMatchObject({ created: 3, skipped: 1, target: "live" })

    const entries = await entriesOf(committed.matrixId)
    expect(entries.map((entry) => entry.rowNumber)).toEqual([1, 2, 3])
    expect(entries.map((entry) => entry.sourceRowNumber)).toEqual([14, 16, 17])

    // El índice único del lote lo impide: en una matriz viva queda en NULL y la
    // traza se lee por `_rows.risk_entry_id` y las columnas `source_*`.
    const matrix = await matrixOf(committed.matrixId)
    expect(matrix.sourceImportBatchId).toBeNull()
    expect(matrix.updatedAt > matrix.publishedAt!).toBe(true)

    const rows = await batchRowsOf(preview.batchId)
    expect(rows.map((row) => row.resolution)).toEqual(["agregada_al_vivo", "ignorada", "agregada_al_vivo", "agregada_al_vivo"])
    expect(rows[0]!.riskEntryId).toBe(entries[0]!.id)

    await drainPostCommit()
    expect((await myActionsIn(WS_LIVE)).find((action) => action.matrixId === live.id)?.reason).toBe("Cambios sin enviar")
  }, 60_000)
})

/* ── Factor fuera del catálogo ──────────────────────────────────────────── */

describe("factor de riesgo que el catálogo no tiene", () => {
  it("detiene la fila, ofrece crearlo y la carga cuando el factor existe", async () => {
    const bytes = await workbookOf([
      { number: 1, activity: "Nuevo proceso", factor: "Psicosocial nuevo", hazard: "Carga mental", probability: 2, consequence: 4, mr: 8, classification: "IMPORTANTE" },
    ])

    const first = await previewRiskImport(bytes, { worksiteId: WS, target: "draft", period: 2031, fileName: "RE-04 psicosocial.xlsx" }, author)
    expect(first.rows[0]!.status).toBe("needs_review")
    expect(first.rows[0]!.issues).toContainEqual(expect.objectContaining({ code: "unknown_factor", excel: "Psicosocial nuevo" }))
    expect(first.rows[0]!.riskFactorId).toBeNull()
    expect(first.totals).toMatchObject({ total: 1, ready: 0, needsReview: 1 })

    // Volver a revisar el mismo archivo no choca con el índice único
    // (faena, checksum): el lote sin cargar se reemplaza.
    const again = await previewRiskImport(bytes, { worksiteId: WS, target: "draft", period: 2031 }, author)
    expect(again.batchId).not.toBe(first.batchId)

    // La persona crea el factor en el catálogo y la misma fila ya se carga: el
    // catálogo se relee al momento de cargar.
    await testDb.insert(schema.preventionRiskFactors).values({ id: "riskfactor-psicosocial-nuevo", code: "psicosocial_carga_mental", name: "Psicosocial nuevo", sortOrder: 300 })
    const committed = await commitRiskImport({
      batchId: again.batchId, worksiteId: WS, target: "draft", period: 2031, revisionReason: "Importación con factor nuevo.",
    }, author)
    expect(committed).toMatchObject({ created: 1, skipped: 0 })

    const [entry] = await entriesOf(committed.matrixId)
    expect(entry!.riskFactorId).toBe("riskfactor-psicosocial-nuevo")
    const rows = await batchRowsOf(again.batchId)
    expect(rows.map((row) => row.status)).toEqual(["activated"])
  }, 60_000)

  it("asignar el factor del Excel a uno del catálogo carga la fila con ese factor; asignarlo a uno que no está activo rechaza la carga entera", async () => {
    const bytes = await workbookOf([
      { number: 1, activity: "Taller", factor: "MCANICO", hazard: "Atrapamiento", probability: 2, consequence: 2, mr: 4, classification: "MODERADO" },
      { number: 2, activity: "Taller", factor: "Físico", hazard: "Ruido", probability: 1, consequence: 1, mr: 1, classification: "TOLERABLE" },
    ])
    const preview = await previewRiskImport(bytes, { worksiteId: WS, target: "draft", period: 2033, fileName: "RE-04 errata.xlsx" }, author)
    expect(preview.rows.map((row) => row.status)).toEqual(["needs_review", "ready"])
    // La vista previa trae el catálogo para elegir: el diálogo sugiere desde acá.
    expect(preview.factorOptions).toContainEqual({ id: "riskfactor-mecanico", name: "Mecánico" })

    await expect(commitRiskImport({
      batchId: preview.batchId, worksiteId: WS, target: "draft", period: 2033, revisionReason: "Importación con errata.",
      factorMapping: { mcanico: "riskfactor-que-no-existe" },
    }, author)).rejects.toThrow(/ya no está activo/)

    const committed = await commitRiskImport({
      batchId: preview.batchId, worksiteId: WS, target: "draft", period: 2033, revisionReason: "Importación con errata.",
      factorMapping: { mcanico: "riskfactor-mecanico" },
    }, author)
    expect(committed).toMatchObject({ created: 2, skipped: 0 })
    const entries = await entriesOf(committed.matrixId)
    expect(entries.map((entry) => entry.riskFactorId)).toEqual(["riskfactor-mecanico", expect.any(String)])
  }, 60_000)

  it("un lote ya cargado no se vuelve a cargar", async () => {
    const bytes = await workbookOf([
      { number: 1, activity: "Único", factor: "Físico", hazard: "Ruido", probability: 1, consequence: 1, mr: 1, classification: "TOLERABLE" },
    ])
    const preview = await previewRiskImport(bytes, { worksiteId: WS, target: "draft", period: 2032 }, author)
    await commitRiskImport({ batchId: preview.batchId, worksiteId: WS, target: "draft", period: 2032, revisionReason: "Primera carga del lote." }, author)

    await expect(commitRiskImport({ batchId: preview.batchId, worksiteId: WS, target: "draft", period: 2032, revisionReason: "Segunda carga del mismo lote." }, author))
      .rejects.toThrow(/ya se cargó/)
    // Y el mismo archivo tampoco se puede volver a preparar para esa faena.
    await expect(previewRiskImport(bytes, { worksiteId: WS, target: "draft", period: 2032 }, author))
      .rejects.toThrow(/ya se cargó/)
  }, 60_000)
})

/* ── Carga con medidas (Fase C) ─────────────────────────────────────────── */

describe("carga con medidas (Fase C)", () => {
  it("crea las medidas de cada riesgo con su tipo, responsable y plazo o frecuencia, todas «propuesta» y en el orden del Excel; los pendientes bajan a los reales", async () => {
    const preview = await previewRiskImport(await workbookOf(MEASURES_FIXTURE, "Carga con medidas"), { worksiteId: WS, target: "draft", period: 2035 }, author)
    const mappings = suggestedMappings(preview.measureAnalysis)
    // La persona cambia una decisión: «PREVENCION» es la prevencionista de la faena.
    mappings.responsibleMapping[normalizeMiperName("PREVENCION")] = { kind: "user", userId: "u-prev" }
    const committed = await commitRiskImport({
      batchId: preview.batchId, worksiteId: WS, target: "draft", period: 2035, revisionReason: "Importación con medidas de prueba.", ...mappings,
    }, author)
    expect(committed).toMatchObject({ created: 3, skipped: 1, measures: { total: 10, existing: 6, pending: 4 } })

    const entries = await entriesOf(committed.matrixId)
    const controls = await testDb.select().from(schema.preventionRiskControls).where(inArray(schema.preventionRiskControls.riskEntryId, entries.map((entry) => entry.id)))
    expect(controls).toHaveLength(10)
    // Existentes o por implementar, todas quedan propuestas hasta que alguien las verifique.
    expect(controls.every((control) => control.status === "proposed")).toBe(true)

    const [first, second, third] = (await buildMiperSnapshot(testDb, committed.matrixId)).entries
    // Orden del Excel dentro de cada riesgo, aunque todas nacen en la misma transacción.
    expect(first!.controls.map((control) => control.description)).toEqual([
      "USO DE EPP (CASCO, GUANTES, CALZADO DE SEGURIDAD)", "ORDEN Y LIMPIEZA", "SEÑALIZACIÓN DE ÁREAS", "CAPACITACIÓN EN TRABAJO SEGURO",
    ])
    expect(first!.controls[0]).toMatchObject({
      hierarchy: "ppe", responsibleUserId: null, responsibleName: "SUPERVISOR/PREVENCION", isExisting: false, verificationFrequency: null, dueDate: todayInChile(),
    })
    expect(first!.controlledStatus).toBe("partial")
    expect(second!.controls.map((control) => [control.description, control.hierarchy])).toEqual([
      ["INSTALAR RESGUARDOS EN MAQUINAS", "engineering"], ["GUANTES", "ppe"], ["CASCO", "ppe"], ["CALZADO DE SEGURIDAD", "ppe"],
    ])
    expect(second!.controls[0]).toMatchObject({ isExisting: true, verificationFrequency: "TRIMESTRAL", dueDate: null })
    expect(third!.controls.map((control) => [control.description, control.responsibleUserId, control.responsibleName])).toEqual([
      ["ORDEN Y LIMPIEZA", "u-prev", "Prevencionista de faena"], ["INSPECCIÓN DE HERRAMIENTAS", "u-prev", "Prevencionista de faena"],
    ])

    // Un `import_applied` por riesgo con su cuenta, y el de la matriz con el total.
    const applied = await appliedOf(committed.matrixId)
    expect(applied.filter((state) => state.object === "entry").map((state) => state.measures).sort()).toEqual([2, 4, 4])
    expect(applied.find((state) => state.object === "matrix")).toMatchObject({ created: 3, skipped: 1, measures: 10, existing: 6, pending: 4 })

    // Los pendientes bajan a los reales: ningún riesgo queda con errores. El Importante tiene medidas
    // por implementar con responsable y plazo, y las existentes no piden plazo.
    const { completeness } = await getMiperWorkspace(committed.matrixId, author)
    expect(completeness.filter((issue) => issue.severity === "error" && issue.entryId)).toEqual([])
  }, 60_000)

  it("rechaza en el servidor un mapeo incompleto, uno con claves que el lote no tiene y uno armado para otro archivo; no crea nada", async () => {
    const preview = await previewRiskImport(await workbookOf(MEASURES_FIXTURE, "Rechazos"), { worksiteId: WS, target: "draft", period: 2036 }, author)
    const full = suggestedMappings(preview.measureAnalysis)
    const commit = (mappings: Partial<ImportMappings>) => commitRiskImport({
      batchId: preview.batchId, worksiteId: WS, target: "draft", period: 2036, revisionReason: "Intento de carga que se rechaza.", ...full, ...mappings,
    }, author)

    const { [normalizeMeasure("CASCO")]: _casco, ...withoutCasco } = full.measureMapping
    await expect(commit({ measureMapping: withoutCasco })).rejects.toThrow("falta decidir el tipo de 1 medida")
    await expect(commit({ responsibleMapping: {} })).rejects.toThrow("falta decidir el responsable de 2 valores")
    await expect(commit({ deadlineMapping: { ...full.deadlineMapping, semestral: { kind: "existing", frequency: "SEMESTRAL" } } }))
      .rejects.toThrow("trae decisiones para 1 valor que el archivo no tiene")
    // Review Focus 1: las decisiones de OTRO archivo (otra vista previa) no sirven para este lote.
    const other = await previewRiskImport(await workbookOf([MEASURES_FIXTURE[2]!], "Otro archivo"), { worksiteId: WS, target: "draft", period: 2036 }, author)
    await expect(commit(suggestedMappings(other.measureAnalysis))).rejects.toThrow("Vuelve a revisar el archivo.")
    // Un tipo fuera del enum o una fecha que no existe en el calendario los rechaza el ESQUEMA,
    // antes de abrir la transacción. Una fecha así contaría como plazo válido en la completitud y
    // en «Atención requerida»; un tipo así sólo lo frenaría el CHECK de la base, ya adentro.
    spy.transactionsStarted = 0
    await expect(commit({ measureMapping: { ...full.measureMapping, [normalizeMeasure("CASCO")]: "helmet" as never } })).rejects.toBeInstanceOf(ZodError)
    const immediate = normalizeMiperName("INMEDIATO / ANTES DE CONTINUAR LA TAREA")
    await expect(commit({ deadlineMapping: { ...full.deadlineMapping, [immediate]: { kind: "pending", dueDate: "2026-02-31" } } })).rejects.toBeInstanceOf(ZodError)
    expect(spy.transactionsStarted).toBe(0)

    // Nada se creó: ni el borrador ni medidas, y el lote sigue preparado.
    expect(await matricesOf(WS, 2036)).toHaveLength(0)
    expect((await batchOf(preview.batchId)).status).toBe("staged")
  }, 60_000)

  it("un responsable que ya no está activo o que no es de la faena se rechaza, aunque la vista previa lo ofreciera (Review Focus 2)", async () => {
    await testDb.insert(schema.users).values({ id: "u-otra-faena", name: "Supervisor de otra faena", email: "otra-faena@imp.cl", hashedPassword: "x", isActive: true, emailNotifications: false })
    const preview = await previewRiskImport(await workbookOf(MEASURES_FIXTURE, "Responsables"), { worksiteId: WS, target: "draft", period: 2037 }, author)
    const mappings = suggestedMappings(preview.measureAnalysis)
    const commit = (userId: string) => commitRiskImport({
      batchId: preview.batchId, worksiteId: WS, target: "draft", period: 2037, revisionReason: "Carga con un responsable inválido.", ...mappings,
      responsibleMapping: { ...mappings.responsibleMapping, [normalizeMiperName("PREVENCION")]: { kind: "user", userId } },
    }, author)

    await expect(commit("u-otra-faena")).rejects.toThrow("La persona responsable no es de la faena o está inactiva.")
    // u-legal es de la faena, pero se da de baja entre la vista previa y la carga.
    await testDb.update(schema.users).set({ isActive: false }).where(eq(schema.users.id, "u-legal"))
    try {
      await expect(commit("u-legal")).rejects.toThrow(/inactiva/)
    } finally {
      await testDb.update(schema.users).set({ isActive: true }).where(eq(schema.users.id, "u-legal"))
    }
    expect(await matricesOf(WS, 2037)).toHaveLength(0)
  }, 60_000)

  it("si algo falla a mitad de la carga no queda nada: ni el borrador, ni riesgos, ni medidas (una sola transacción)", async () => {
    // Falla la última medida de la última fila: para entonces ya se escribieron el borrador, dos
    // riesgos y sus medidas. Antes de la Fase C el borrador se creaba en otra transacción y quedaba.
    await pg.exec(`
      CREATE FUNCTION qa_falla_medida() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.description = 'INSPECCIÓN DE HERRAMIENTAS' THEN RAISE EXCEPTION 'falla forzada de la prueba'; END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER qa_falla_medida BEFORE INSERT ON prevention_risk_controls FOR EACH ROW EXECUTE FUNCTION qa_falla_medida();
    `)
    try {
      const preview = await previewRiskImport(await workbookOf(MEASURES_FIXTURE, "Rollback"), { worksiteId: WS, target: "draft", period: 2038 }, author)
      await expect(commitRiskImport({
        batchId: preview.batchId, worksiteId: WS, target: "draft", period: 2038, revisionReason: "Carga que falla a mitad.", ...suggestedMappings(preview.measureAnalysis),
      }, author)).rejects.toMatchObject({
        // La causa es el trigger, no un rechazo anterior: un rechazo antes de escribir no probaría el rollback.
        cause: expect.objectContaining({ message: expect.stringContaining("falla forzada de la prueba") }),
      })
      expect(await matricesOf(WS, 2038)).toHaveLength(0)
      expect((await batchOf(preview.batchId)).status).toBe("staged")
      expect((await batchRowsOf(preview.batchId)).every((row) => row.riskEntryId === null)).toBe(true)
    } finally {
      await pg.exec("DROP TRIGGER qa_falla_medida ON prevention_risk_controls; DROP FUNCTION qa_falla_medida();")
    }
  }, 60_000)
})

/* ── Carga concurrente del mismo lote ───────────────────────────────────── */

describe("carga concurrente del mismo lote", () => {
  const WS_DOUBLE = "ws-doble"
  const editor = { userId: "u-autora", scope: { mode: "some" as const, ids: [WS_DOUBLE] }, permissions: ["prevention:risk:view", "prevention:risk:edit"] }

  /* PGlite tiene UNA conexión y serializa las transacciones: acá la segunda carga
   * siempre empieza después del COMMIT de la primera, así que esta prueba fija el
   * resultado pero no puede reproducir la carrera. La que se da en Postgres
   * —las dos releen el lote `staged` antes de que la primera confirme y, al
   * vigente, la segunda vuelve a insertar todo— la cierra el `FOR UPDATE` de la
   * relectura del lote (`loadBatch(tx, …, { lock: true })`). */
  it("dos cargas a la vez del mismo lote (doble clic, dos pestañas): una carga y la otra se rechaza; nada se duplica en el vigente", async () => {
    await testDb.insert(schema.worksites).values({ id: WS_DOUBLE, name: "Faena doble clic", code: "DBL" })
    const live = await createMiper({ worksiteId: WS_DOUBLE, period: 2026, revisionReason: "MIPER vigente para probar el doble clic." }, editor)
    const publishedAt = "2020-01-01T00:00:00.000Z"
    await testDb.update(schema.preventionRiskMatrices)
      .set({ status: "published", reviewState: "none", publishedAt, updatedAt: publishedAt, reviewedByUserId: "u-jefa", approvedByUserId: "u-legal" })
      .where(eq(schema.preventionRiskMatrices.id, live.id))
    const preview = await previewRiskImport(await workbookOf(MEASURES_FIXTURE, "Doble clic"), { worksiteId: WS_DOUBLE, target: "live" }, editor)
    const input = { batchId: preview.batchId, worksiteId: WS_DOUBLE, target: "live", ...suggestedMappings(preview.measureAnalysis) }

    const results = await Promise.allSettled([commitRiskImport(input, editor), commitRiskImport(input, editor)])
    expect(results.map((result) => result.status).sort()).toEqual(["fulfilled", "rejected"])
    expect(results.find((result): result is PromiseRejectedResult => result.status === "rejected")!.reason)
      .toMatchObject({ message: "Este lote de importación ya se cargó en una MIPER." })

    // Los 3 riesgos y las 10 medidas, una sola vez.
    const entries = await entriesOf(live.id)
    expect(entries).toHaveLength(3)
    const controls = await testDb.select({ id: schema.preventionRiskControls.id }).from(schema.preventionRiskControls)
      .where(inArray(schema.preventionRiskControls.riskEntryId, entries.map((entry) => entry.id)))
    expect(controls).toHaveLength(10)
    // Y una tercera, ya en serie, también se rechaza.
    await expect(commitRiskImport(input, editor)).rejects.toThrow("ya se cargó")
    expect(await entriesOf(live.id)).toHaveLength(3)
  }, 60_000)

  it("volver a revisar el mismo archivo mientras se carga al vigente no borra el lote ya cargado: se rechaza con «ya se cargó»", async () => {
    const WS_RACE = "ws-carrera"
    const racer = { ...editor, scope: { mode: "some" as const, ids: [WS_RACE] } }
    await testDb.insert(schema.worksites).values({ id: WS_RACE, name: "Faena carrera", code: "CAR" })
    const live = await createMiper({ worksiteId: WS_RACE, period: 2026, revisionReason: "MIPER vigente para probar la carrera." }, racer)
    const publishedAt = "2020-01-01T00:00:00.000Z"
    await testDb.update(schema.preventionRiskMatrices)
      .set({ status: "published", reviewState: "none", publishedAt, updatedAt: publishedAt, reviewedByUserId: "u-jefa", approvedByUserId: "u-legal" })
      .where(eq(schema.preventionRiskMatrices.id, live.id))
    const bytes = await workbookOf(MEASURES_FIXTURE, "Carrera vista previa y carga")
    const preview = await previewRiskImport(bytes, { worksiteId: WS_RACE, target: "live" }, racer)
    await commitRiskImport({ batchId: preview.batchId, worksiteId: WS_RACE, target: "live", ...suggestedMappings(preview.measureAnalysis) }, racer)
    const loadedRows = await batchRowsOf(preview.batchId)
    expect(loadedRows.filter((row) => row.riskEntryId !== null)).toHaveLength(3)

    // La segunda vista previa leyó el lote antes de que la carga confirmara.
    spy.staleBatchRead = true
    await expect(previewRiskImport(bytes, { worksiteId: WS_RACE, target: "live" }, racer)).rejects.toThrow(
      "Este archivo ya se cargó en una MIPER. Vuelve a exportarlo desde el RE-04 o cambia una fila para importarlo de nuevo.",
    )
    expect(spy.staleBatchRead).toBe(false)

    // El lote cargado sigue ahí, con sus filas y su traza a los riesgos; no apareció otro.
    expect((await batchOf(preview.batchId)).status).toBe("activated")
    expect(await batchRowsOf(preview.batchId)).toEqual(loadedRows)
    const checksum = createHash("sha256").update(bytes).digest("hex")
    const batches = await testDb.select({ id: schema.preventionRiskImportBatches.id }).from(schema.preventionRiskImportBatches)
      .where(eq(schema.preventionRiskImportBatches.sourceChecksumSha256, checksum))
    expect(batches).toEqual([{ id: preview.batchId }])
  }, 60_000)
})
