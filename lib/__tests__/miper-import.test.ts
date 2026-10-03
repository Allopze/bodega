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
import path from "node:path"
import ExcelJS from "exceljs"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { and, asc, eq } from "drizzle-orm"
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { RE04_COLUMNS, RE04_SHEET_NAME } from "@/lib/prevention/miper/re04-import"

/** Evidencia de que ningún aviso se resolvió dentro de una transacción. */
const spy = vi.hoisted(() => ({
  openTransactions: 0,
  recipientLookups: [] as Array<{ permission: string; worksiteId: string; openTransactions: number }>,
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

/* El Proxy sólo envuelve `transaction` para saber cuántas hay abiertas. */
g.__db = new Proxy(testDb as unknown as Record<PropertyKey, unknown>, {
  get(target, property, receiver) {
    if (property === "transaction") {
      return async (run: (tx: unknown) => Promise<unknown>) => {
        spy.openTransactions += 1
        try { return await (target as unknown as DB).transaction(run as never) }
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

/** Libro mínimo con la forma del RE-04 real: membrete, encabezado doble y datos. */
async function workbookOf(rows: ExcelRow[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet(RE04_SHEET_NAME)
  sheet.getCell("A1").value = "Matriz de Identificación de Peligros y Evaluación de Riesgos (IPER)"
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

beforeEach(() => {
  spy.recipientLookups = []
  spy.openTransactions = 0
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

/* ── Carga en un borrador nuevo ─────────────────────────────────────────── */

describe("carga en un borrador", () => {
  it("escribe las filas que pasan, deja fuera la que no, traza el Excel y avisa la Intolerable después del COMMIT", async () => {
    const preview = await previewRiskImport(fixture, { worksiteId: WS, target: "draft", period: 2026, fileName: "RE-04 Biodiversa.xlsx" }, author)
    spy.recipientLookups = []

    const committed = await commitRiskImport({
      batchId: preview.batchId, worksiteId: WS, target: "draft", period: 2026, revisionReason: "Importación del RE-04 2026 de prueba.",
    }, author)
    expect(committed).toMatchObject({ created: 3, skipped: 1, notified: 1, target: "draft" })

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

    const committed = await commitRiskImport({ batchId: preview.batchId, worksiteId: WS_LIVE, target: "live" }, author)
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
