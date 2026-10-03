/**
 * Importación del RE-04 real (§9.3 del rediseño; Task 7 de la F3).
 *
 * El camino es el del formato: **vista previa** (el archivo se lee y se congela
 * en las tablas de importación que ya existen) y **carga** (las filas que pasan
 * los problemas por fila se escriben en la matriz). Las tablas
 * `prevention_risk_import_batches` / `prevention_risk_import_rows` se reutilizan
 * **tal cual**: sus estados siguen siendo `staged → approved → activated` con
 * `resolution` por fila (`creada_en_borrador` | `agregada_al_vivo` | `ignorada`)
 * y `risk_entry_id` apuntando a la fila creada. No se agregó ningún estado.
 *
 * Tres decisiones que la tarea fijó y que conviene tener a la vista:
 *
 * 1. **Sin storage.** El `.xlsx` se parsea en memoria con ExcelJS y no se
 *    escribe en ningún directorio: la columna obligatoria `source_file_path`
 *    queda con un marcador de origen —`inline:RE-04 IPER`— y el checksum del
 *    archivo vive en `source_checksum_sha256`, que es lo que de verdad
 *    identifica la carga (el índice único es `(worksite_id, checksum)`).
 * 2. **`source_import_batch_id` sólo en el borrador nuevo.** El índice único
 *    parcial `prevention_risk_matrices_source_batch_unique` impide que un lote
 *    apunte a más de una matriz, así que al agregar filas a una matriz viva el
 *    lote queda sin dueño (`NULL`) y la traza se lee por
 *    `prevention_risk_import_rows.risk_entry_id` más las columnas `source_*` de
 *    la fila.
 * 3. **El MR y la clasificación del Excel no mandan.** Se informan como
 *    `mr_mismatch` / `classification_mismatch` y lo que se guarda es
 *    `p × c` + `classify(p, c)`, que además son columnas generadas: la
 *    plataforma no puede escribir una incoherencia aunque quisiera.
 * 4. **Medidas (Fase C).** La vista previa devuelve `measureAnalysis` (frases,
 *    responsables y plazos distintos, con su sugerencia) y la carga lo vuelve a
 *    calcular desde las filas del lote: nunca confía en las claves del cliente.
 *
 * El aviso de «fila Intolerable» sale **después del COMMIT** —`entries.ts` hace
 * lo mismo desde `saveMiperEntry`— porque los destinatarios se resuelven con la
 * conexión global `db` y resolverlos dentro del callback de la transacción
 * cuelga PGlite (una sola conexión) y, en producción, dejaría el aviso emitido
 * antes del COMMIT (S-05).
 */
import { createHash } from "node:crypto"
import ExcelJS from "exceljs"
import { and, asc, eq, ne, sql } from "drizzle-orm"
import { db } from "@/db"
import {
  preventionRiskControls, preventionRiskEntries, preventionRiskFactors, preventionRiskImportBatches, preventionRiskImportRows, preventionRiskMatrices,
} from "@/db/schema"
import { nanoid } from "@/lib/id"
import { cleanMiperName, normalizeMiperName } from "@/lib/prevention/miper/names"
import {
  isEmptyRe04Row, parseRe04Matrix, RE04_COLUMNS, RE04_SHEET_NAME, riskImportStatus,
  type Re04Normalized, type RiskImportIssue, type RiskImportRowStatus,
} from "@/lib/prevention/miper/re04-import"
import { isScaleValue, type RiskClassification } from "@/lib/prevention/miper/methodology"
import {
  analyzeRe04Measures, mappingProblems, type ImportMappings, type ImportMeasure, type MeasureAnalysis, type ResponsibleDecision,
} from "@/lib/prevention/miper/re04-measures"
import { IMPORT_LIMITS, riskImportCommitSchema, riskImportPreviewSchema } from "@/lib/validation/prevention-module/miper"
import { RiskLegalDomainError } from "@/lib/services/prevention-risk-legal-errors"
import { codeYear, countOf, todayInChile } from "@/lib/utils"
import { resolveDictionaryId } from "./dictionaries"
import { createMiperWithClient } from "./matrices"
import { notifyMiperRowIntolerable } from "./notifications"
import {
  assertActiveUsers, assertEditable, type Client, lockMatrix, type MiperAccess, miperHistory, nowIso, OUT_OF_SCOPE, requireAccess,
  userNames, worksiteResponsibleOptions,
} from "./shared"

const EDIT = "prevention:risk:edit"

/** Marcador de origen: no hay storage, el archivo se leyó en memoria. */
const ORIGIN_PREFIX = "inline:"

export type RiskImportTarget = "draft" | "live"

export type RiskImportRowView = {
  /** Fila del Excel: es el número que la persona ve al abrir el archivo. */
  rowNumber: number
  status: RiskImportRowStatus
  issues: RiskImportIssue[]
  original: Record<string, unknown>
  normalized: Re04Normalized
  riskFactorId: string | null
  riskFactorName: string | null
  magnitude: number | null
  classification: RiskClassification | null
  fingerprintSha256: string
}

export type RiskImportPreview = {
  batchId: string
  sheetName: string
  target: RiskImportTarget
  rows: RiskImportRowView[]
  totals: { total: number; ready: number; needsReview: number; rejected: number }
  /** Destino «borrador»: el período con el que se crearía. */
  draft: { period: number; blockedReason: string | null }
  /** Destino «al vigente»: a qué matriz se agregaría. */
  live: { matrixId: string | null; title: string | null; blockedReason: string | null }
  /**
   * Fase C: las medidas del archivo y lo que hay que decidir una vez por valor
   * distinto (tipo de cada frase, responsables, plazos), con su sugerencia.
   */
  measureAnalysis: MeasureAnalysis
  /** Personas que se pueden elegir como responsable: las activas de la faena y quien importa. */
  responsibleOptions: Array<{ id: string; name: string }>
}

export type RiskImportCommitResult = {
  batchId: string
  matrixId: string
  target: RiskImportTarget
  /** Filas escritas. */
  created: number
  /** Filas que quedaron fuera (P/C fuera de escala o factor sin resolver). */
  skipped: number
  /** Filas Intolerables avisadas después del COMMIT. */
  notified: number
  /** Fase C: medidas creadas, todas «propuesta»: existentes y por implementar. */
  measures: { total: number; existing: number; pending: number }
}

function toBuffer(file: Uint8Array | ArrayBuffer | Buffer): Buffer {
  if (Buffer.isBuffer(file)) return file
  if (file instanceof ArrayBuffer) return Buffer.from(file)
  return Buffer.from(file.buffer, file.byteOffset, file.byteLength)
}

/** Sólo texto, número, booleano o fecha: lo que se puede guardar en `jsonb`. */
function cellValue(value: ExcelJS.CellValue): string | number | boolean | null {
  if (value === null || value === undefined) return null
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  if (typeof value === "object") {
    const candidate = value as { richText?: Array<{ text?: string }>; result?: unknown; text?: unknown; error?: unknown }
    if (Array.isArray(candidate.richText)) return candidate.richText.map((part) => part.text ?? "").join("")
    if (candidate.result !== undefined && candidate.result !== null) return cellValue(candidate.result as ExcelJS.CellValue)
    if (typeof candidate.error === "string") return candidate.error
    if (typeof candidate.text === "string") return candidate.text
  }
  return null
}

function headerKey(value: unknown): string {
  if (typeof value !== "string" && typeof value !== "number") return ""
  return normalizeMiperName(String(value)).replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim()
}

/**
 * Lee la hoja *RE-04 IPER* y devuelve la matriz de celdas sin el encabezado. El
 * encabezado se ubica por el rótulo de ACTIVIDAD (no por un número fijo de
 * fila: el formato real agrega membretes) y se reconoce el sub-encabezado
 * —PROBABILIDAD / CONSECUENCIA / MR— para saber dónde empiezan los datos.
 */
async function readRe04Sheet(bytes: Buffer) {
  const workbook = new ExcelJS.Workbook()
  try {
    await workbook.xlsx.load(bytes as never, { ignoreNodes: ["dataValidations", "conditionalFormatting", "hyperlinks"] })
  } catch {
    throw new RiskLegalDomainError("No se pudo leer el archivo. Adjunta el Excel del RE-04 (.xlsx, sin contraseña).")
  }
  const wanted = normalizeMiperName(RE04_SHEET_NAME)
  const sheet = workbook.worksheets.find((candidate) => normalizeMiperName(candidate.name) === wanted) ?? workbook.worksheets[0]
  if (!sheet) throw new RiskLegalDomainError("El archivo no tiene ninguna hoja de cálculo.")

  const width = RE04_COLUMNS.length
  const lastRow = sheet.rowCount ?? 0
  const rowValues = (rowNumber: number): unknown[] => {
    const row = sheet.getRow(rowNumber)
    const cells: unknown[] = []
    for (let column = 1; column <= width; column += 1) cells.push(cellValue(row.getCell(column).value))
    return cells
  }

  let headerRow = 0
  for (let rowNumber = 1; rowNumber <= Math.min(lastRow, 40); rowNumber += 1) {
    if (rowValues(rowNumber).some((cell) => headerKey(cell) === "actividad")) { headerRow = rowNumber; break }
  }
  if (headerRow === 0) {
    throw new RiskLegalDomainError(`No se encontró el encabezado de la hoja «${RE04_SHEET_NAME}» (columna ACTIVIDAD).`)
  }
  const subHeader = new Set(["probabilidad", "consecuencia", "mr", "clasificacion del riesgo"])
  const hasSubHeader = rowValues(headerRow + 1).some((cell) => subHeader.has(headerKey(cell)))
  const startRow = headerRow + (hasSubHeader ? 2 : 1)

  const rows: unknown[][] = []
  for (let rowNumber = startRow; rowNumber <= lastRow; rowNumber += 1) rows.push(rowValues(rowNumber))
  // Restos de formato del final: una fila sin ningún valor no es un riesgo.
  while (rows.length > 0 && isEmptyRe04Row(rows[rows.length - 1]!)) rows.pop()
  if (rows.length === 0) throw new RiskLegalDomainError("La hoja no tiene filas de riesgos que importar.")
  return { sheetName: sheet.name, startRow, rows }
}

async function activeFactors(client: Client) {
  const rows = await client.select({ id: preventionRiskFactors.id, name: preventionRiskFactors.name })
    .from(preventionRiskFactors).where(eq(preventionRiskFactors.isActive, true))
  return {
    byKey: new Map(rows.map((factor) => [normalizeMiperName(factor.name), factor.id])),
    keys: new Set(rows.map((factor) => normalizeMiperName(factor.name))),
  }
}

function factorKeyOf(normalized: Re04Normalized) {
  const name = cleanMiperName(normalized.riskFactor)
  return name === null ? null : normalizeMiperName(name)
}

/** ¿La fila se detiene? P/C fuera de escala, o un factor que el catálogo no tiene. */
function rowBlocked(issues: readonly RiskImportIssue[], normalized: Re04Normalized, riskFactorId: string | null) {
  if (issues.some((issue) => issue.code === "p_out_of_scale" || issue.code === "c_out_of_scale")) return true
  if (!isScaleValue(normalized.probability) || !isScaleValue(normalized.consequence)) return true
  return issues.some((issue) => issue.code === "unknown_factor") && riskFactorId === null
}

/** Fase C: lo que cabe en una importación (`IMPORT_LIMITS`). Más que eso se divide en partes. */
function assertWithinImportLimits(analysis: MeasureAnalysis) {
  if (analysis.phrases.length > IMPORT_LIMITS.phrases) {
    throw new RiskLegalDomainError(`El archivo trae ${countOf(analysis.phrases.length, "medida distinta", "medidas distintas")}: el máximo por importación es ${IMPORT_LIMITS.phrases}. Divide el RE-04 en partes.`)
  }
  if (Math.max(analysis.responsibles.length, analysis.deadlines.length) > IMPORT_LIMITS.values) {
    throw new RiskLegalDomainError(`El archivo trae más de ${IMPORT_LIMITS.values} responsables o plazos distintos. Divide el RE-04 en partes.`)
  }
}

/**
 * Vista previa: lee el archivo, mapea textos y factores contra el catálogo,
 * congela el lote y devuelve los problemas **por fila** con la fila del Excel,
 * el valor leído y el cálculo mandante.
 */
export async function previewRiskImport(
  file: Uint8Array | ArrayBuffer | Buffer,
  options: unknown,
  access: MiperAccess,
): Promise<RiskImportPreview> {
  const data = riskImportPreviewSchema.parse(options)
  requireAccess(access, EDIT, data.worksiteId)

  const bytes = toBuffer(file)
  if (bytes.byteLength === 0) throw new RiskLegalDomainError("El archivo está vacío.")

  const sheet = await readRe04Sheet(bytes)
  const factors = await activeFactors(db)
  const parsed = parseRe04Matrix({ startRow: sheet.startRow, rows: sheet.rows }, { knownFactors: factors.keys })

  const rows: RiskImportRowView[] = parsed.rows.map((row) => {
    const key = factorKeyOf(row.normalized)
    return {
      rowNumber: row.rowNumber,
      status: riskImportStatus(row.issues),
      issues: row.issues,
      original: row.original,
      normalized: row.normalized,
      riskFactorId: key === null ? null : factors.byKey.get(key) ?? null,
      riskFactorName: cleanMiperName(row.normalized.riskFactor),
      magnitude: row.normalized.magnitude,
      classification: row.normalized.classification,
      fingerprintSha256: row.fingerprintSha256,
    }
  })

  /* Fase C: las medidas se leen de la celda original (con sus saltos de línea),
   * no de `normalized.measures`, y cada frase, responsable y plazo distinto se
   * decide una vez (D6). Los topes se aplican antes de guardar el lote. */
  const responsibleOptions = await worksiteResponsibleOptions(db, data.worksiteId, access.userId)
  const measureAnalysis = analyzeRe04Measures(rows, { today: todayInChile(), users: responsibleOptions })
  assertWithinImportLimits(measureAnalysis)

  /* Los dos destinos se comprueban acá para que la vista previa pueda decir por
   * qué no se puede cargar en vez de fallar al apretar el botón. */
  const period = data.period ?? codeYear()
  const [occupied] = await db.select({ period: preventionRiskMatrices.period }).from(preventionRiskMatrices)
    .where(and(
      eq(preventionRiskMatrices.worksiteId, data.worksiteId),
      eq(preventionRiskMatrices.period, period),
      ne(preventionRiskMatrices.status, "superseded"),
    )).limit(1)
  const [vigente] = await db.select({
    id: preventionRiskMatrices.id, title: preventionRiskMatrices.title, isLegacy: preventionRiskMatrices.isLegacy,
  }).from(preventionRiskMatrices)
    .where(and(eq(preventionRiskMatrices.worksiteId, data.worksiteId), eq(preventionRiskMatrices.status, "published"))).limit(1)

  const checksum = createHash("sha256").update(bytes).digest("hex")
  const ready = rows.filter((row) => row.status === "ready").length

  const batchId = await db.transaction(async (tx) => {
    /* Mismo archivo y misma faena: el índice único es (worksite_id, checksum).
     * Un lote todavía no cargado se reemplaza —volver a revisar el mismo archivo
     * no puede fallar—; uno ya cargado se rechaza con su motivo. */
    const [existing] = await tx.select({ id: preventionRiskImportBatches.id, status: preventionRiskImportBatches.status })
      .from(preventionRiskImportBatches)
      .where(and(eq(preventionRiskImportBatches.worksiteId, data.worksiteId), eq(preventionRiskImportBatches.sourceChecksumSha256, checksum)))
      .limit(1)
    if (existing?.status === "activated") {
      throw new RiskLegalDomainError("Este archivo ya se cargó en una MIPER. Vuelve a exportarlo desde el RE-04 o cambia una fila para importarlo de nuevo.")
    }
    if (existing) await tx.delete(preventionRiskImportBatches).where(eq(preventionRiskImportBatches.id, existing.id))

    const id = `riskimport-${nanoid()}`
    await tx.insert(preventionRiskImportBatches).values({
      id,
      worksiteId: data.worksiteId,
      sourceFileName: data.fileName ?? "RE-04.xlsx",
      /* Sin storage: el marcador de origen. El checksum es la identidad real. */
      sourceFilePath: `${ORIGIN_PREFIX}${sheet.sheetName}`,
      sourceChecksumSha256: checksum,
      sourceSizeBytes: bytes.byteLength,
      sourceSheetName: sheet.sheetName,
      status: "staged",
      totalRows: rows.length,
      readyRows: ready,
      reviewRows: rows.length - ready,
      createdByUserId: access.userId,
    })
    await tx.insert(preventionRiskImportRows).values(rows.map((row) => ({
      id: `riskimportrow-${nanoid()}`,
      batchId: id,
      rowNumber: row.rowNumber,
      original: row.original,
      normalized: row.normalized,
      fingerprintSha256: row.fingerprintSha256,
      status: row.status,
      issues: row.issues,
    })))
    return id
  })

  return {
    batchId,
    sheetName: sheet.sheetName,
    target: data.target,
    rows,
    totals: {
      total: rows.length,
      ready,
      needsReview: rows.filter((row) => row.status === "needs_review").length,
      rejected: rows.filter((row) => row.status === "rejected").length,
    },
    draft: {
      period,
      blockedReason: occupied ? `Ya existe un MIPER del período ${period} para esta faena: ábrelo o agrega las filas al vigente.` : null,
    },
    live: {
      matrixId: vigente?.id ?? null,
      title: vigente?.title ?? null,
      blockedReason: !vigente
        ? "La faena no tiene una MIPER vigente a la que agregar las filas: cárgalas en un borrador."
        : vigente.isLegacy
          ? "La MIPER vigente usa la metodología anterior y es de solo lectura."
          : null,
    },
    measureAnalysis,
    responsibleOptions,
  }
}

/** El lote preparado, con su estado: es lo primero que hay que saber. */
async function loadBatch(client: Client, batchId: string, worksiteId: string) {
  const [batch] = await client.select().from(preventionRiskImportBatches)
    .where(and(eq(preventionRiskImportBatches.id, batchId), eq(preventionRiskImportBatches.worksiteId, worksiteId))).limit(1)
  if (!batch) throw new RiskLegalDomainError(OUT_OF_SCOPE)
  if (batch.status === "activated") throw new RiskLegalDomainError("Este lote de importación ya se cargó en una MIPER.")
  return batch
}

/**
 * Carga el lote preparado. Destino `draft`: crea el MIPER en borrador (con el
 * período y el motivo de cualquier alta) y escribe las filas ahí. Destino
 * `live`: agrega las filas al MIPER vigente, que queda con «Cambios sin enviar».
 *
 * Fase C: UNA transacción para todo —el borrador, las filas, sus medidas y la
 * traza—, con el cliente de la transacción (la conexión global `db` no se toca
 * dentro del callback). Antes el borrador se creaba en su propia transacción y
 * un fallo a mitad dejaba un borrador vacío. Las decisiones de la vista previa
 * se validan contra las claves que el servidor vuelve a calcular desde el lote.
 */
export async function commitRiskImport(input: unknown, access: MiperAccess): Promise<RiskImportCommitResult> {
  const data = riskImportCommitSchema.parse(input)
  requireAccess(access, EDIT, data.worksiteId)

  /* El lote se comprueba antes de abrir la transacción: si ya se cargó, el error
   * tiene que decir eso y no «ya existe un MIPER del período» (que es lo que
   * respondería el alta al chocar con la matriz que la primera carga creó). */
  await loadBatch(db, data.batchId, data.worksiteId)
  const today = todayInChile()

  const result = await db.transaction(async (tx) => {
    // Relectura autoritativa dentro de la transacción.
    const batch = await loadBatch(tx, data.batchId, data.worksiteId)
    const batchRows = await tx.select().from(preventionRiskImportRows)
      .where(eq(preventionRiskImportRows.batchId, batch.id)).orderBy(asc(preventionRiskImportRows.rowNumber))

    /* Las claves de las decisiones se recalculan desde el lote, nunca se toman
     * del cliente: una que falte o que sobre (otra vista previa, un cliente
     * adulterado) rechaza la carga antes de escribir nada. */
    const analysis = analyzeRe04Measures(batchRows, { today })
    const problems = mappingProblems(analysis, data)
    if (problems.length > 0) throw new RiskLegalDomainError(problems.join(" "))
    const responsibleNames = await importResponsibleNames(tx, data.worksiteId, data.responsibleMapping, access)

    const revisionReason = data.revisionReason?.trim() || "Importación RE-04 desde Excel"
    const draftId = data.target === "draft"
      ? (await createMiperWithClient(tx, { worksiteId: data.worksiteId, period: data.period ?? codeYear(), revisionReason }, access)).id
      : null
    const matrix = draftId !== null
      ? await lockMatrix(tx, draftId)
      : await lockMatrix(tx, (await liveMatrix(tx, data.worksiteId)).id)
    assertEditable(matrix)

    // El catálogo se relee acá: entre la vista previa y la carga la persona pudo
    // crear el factor que faltaba, y eso es exactamente lo que la fila esperaba.
    const factors = await activeFactors(tx)
    const [max] = await tx.select({ maxRow: sql<number>`coalesce(max(${preventionRiskEntries.rowNumber}), 0)::int` })
      .from(preventionRiskEntries).where(eq(preventionRiskEntries.matrixId, matrix.id))

    const now = nowIso()
    const resolution = data.target === "draft" ? "creada_en_borrador" : "agregada_al_vivo"
    const intolerable: Array<{ entryId: string; rowNumber: number }> = []
    const measuresByRow = new Map<number, ImportMeasure[]>()
    for (const measure of analysis.measures) measuresByRow.set(measure.rowNumber, [...(measuresByRow.get(measure.rowNumber) ?? []), measure])
    const measures = { total: 0, existing: 0, pending: 0 }
    let created = 0
    let skipped = 0
    let nextRow = (max?.maxRow ?? 0) + 1

    for (const row of batchRows) {
      const issues = (row.issues ?? []) as RiskImportIssue[]
      const normalized = row.normalized as Re04Normalized
      const key = factorKeyOf(normalized)
      const riskFactorId = key === null ? null : factors.byKey.get(key) ?? null

      if (rowBlocked(issues, normalized, riskFactorId)) {
        skipped += 1
        // La fila detenida no se carga; `resolution` deja dicho que se ignoró y
        // el estado sigue señalando por qué (fuera de escala, o falta el factor).
        await tx.update(preventionRiskImportRows).set({
          resolution: "ignorada",
          status: issues.some((issue) => issue.code === "p_out_of_scale" || issue.code === "c_out_of_scale") ? "rejected" : "needs_review",
        }).where(eq(preventionRiskImportRows.id, row.id))
        continue
      }

      const [entry] = await tx.insert(preventionRiskEntries).values({
        id: `riskentry-${nanoid()}`,
        matrixId: matrix.id,
        rowNumber: nextRow,
        hazardCode: `R-${nanoid(8)}`,
        ...(await entryColumns(tx, matrix.worksiteId, normalized, riskFactorId, {
          rowNumber: row.rowNumber,
          original: row.original as Record<string, unknown>,
          normalized: row.normalized as Record<string, unknown>,
          issues,
        })),
        version: 1,
        createdAt: now,
        updatedAt: now,
      }).returning({
        id: preventionRiskEntries.id, rowNumber: preventionRiskEntries.rowNumber, classification: preventionRiskEntries.classification,
      })
      nextRow += 1
      created += 1

      const rowMeasures = measuresByRow.get(row.rowNumber) ?? []
      if (rowMeasures.length > 0) {
        const controls = rowMeasures.map((measure, index) => importedControl(measure, index, entry!.id, now, data, responsibleNames))
        await tx.insert(preventionRiskControls).values(controls)
        for (const control of controls) {
          measures.total += 1
          if (control.isExisting) measures.existing += 1
          else measures.pending += 1
        }
      }

      await tx.update(preventionRiskImportRows).set({
        status: "activated", resolution, riskEntryId: entry!.id, resolvedByUserId: access.userId, resolvedAt: now,
      }).where(eq(preventionRiskImportRows.id, row.id))
      await miperHistory(tx, {
        matrixId: matrix.id, worksiteId: matrix.worksiteId, object: "entry", objectId: entry!.id, changeType: "import_applied",
        after: { batchId: batch.id, sourceRowNumber: row.rowNumber, riskEntryId: entry!.id, resolution, rowNumber: entry!.rowNumber, measures: rowMeasures.length },
        actorUserId: access.userId, actingAs: EDIT,
      })
      if (entry!.classification === "intolerable") {
        intolerable.push({ entryId: entry!.id, rowNumber: entry!.rowNumber ?? nextRow - 1 })
      }
    }

    /* `updated_at` es lo que «Requieren mi acción» lee como «cambios sin enviar»:
     * sin esto las filas agregadas al vigente no aparecerían. */
    await tx.update(preventionRiskMatrices).set({
      updatedAt: now,
      // El lote sólo es dueño de la matriz que él mismo crea (índice único).
      ...(draftId !== null ? { sourceImportBatchId: batch.id } : {}),
    }).where(eq(preventionRiskMatrices.id, matrix.id))

    const ready = batchRows.filter((row) => riskImportStatus((row.issues ?? []) as RiskImportIssue[]) === "ready").length
    await tx.update(preventionRiskImportBatches).set({
      status: "activated",
      approvedByUserId: access.userId, approvedAt: now,
      activatedByUserId: access.userId, activatedAt: now, activatedMatrixId: matrix.id,
      totalRows: batchRows.length, readyRows: ready, reviewRows: batchRows.length - ready,
    }).where(eq(preventionRiskImportBatches.id, batch.id))

    await miperHistory(tx, {
      matrixId: matrix.id, worksiteId: matrix.worksiteId, object: "matrix", objectId: matrix.id, changeType: "import_applied",
      after: {
        batchId: batch.id, target: data.target, sourceFileName: batch.sourceFileName,
        sourceImportBatchId: draftId !== null ? batch.id : null, created, skipped,
        measures: measures.total, existing: measures.existing, pending: measures.pending,
      },
      actorUserId: access.userId, actingAs: EDIT,
    })

    return { matrixId: matrix.id, matrixTitle: matrix.title, worksiteId: matrix.worksiteId, created, skipped, intolerable, measures }
  })

  /* Post-COMMIT y una vez por fila: la deduplicación por fila
   * (`miper-row-intolerable:{entryId}`) hace seguras las repeticiones. */
  for (const row of result.intolerable) {
    notifyMiperRowIntolerable({
      matrixId: result.matrixId, worksiteId: result.worksiteId, matrixTitle: result.matrixTitle,
      entryId: row.entryId, rowNumber: row.rowNumber, actorUserId: access.userId,
    })
  }

  return {
    batchId: data.batchId,
    matrixId: result.matrixId,
    target: data.target,
    created: result.created,
    skipped: result.skipped,
    notified: result.intolerable.length,
    measures: result.measures,
  }
}

/**
 * Responsables elegidos como persona: activos y de la faena (o quien importa),
 * lo mismo que ofreció la vista previa (`worksiteResponsibleOptions`). Un id que
 * no está ahí viene de un cliente adulterado o de una baja entre la vista previa
 * y la carga: se rechaza, no se carga a medias.
 */
async function importResponsibleNames(client: Client, worksiteId: string, mapping: Readonly<Record<string, ResponsibleDecision>>, access: MiperAccess) {
  const ids = [...new Set(Object.values(mapping).flatMap((decision) => (decision.kind === "user" ? [decision.userId] : [])))]
  if (ids.length === 0) return new Map<string, string>()
  await assertActiveUsers(client, ids)
  const allowed = new Set((await worksiteResponsibleOptions(client, worksiteId, access.userId)).map((option) => option.id))
  if (ids.some((id) => !allowed.has(id))) throw new RiskLegalDomainError("La persona responsable no es de la faena o está inactiva.")
  return userNames(client, ids)
}

/**
 * La medida importada (Fase C). Siempre «propuesta» —existente o por
 * implementar— hasta que alguien la verifique: así no baja «Riesgos críticos sin
 * control» sin evidencia (decisión del usuario). D5: la existente lleva su
 * frecuencia y no plazo; la por implementar, su plazo.
 */
function importedControl(measure: ImportMeasure, index: number, riskEntryId: string, now: string, mappings: ImportMappings, names: ReadonlyMap<string, string>) {
  const responsible = mappings.responsibleMapping[measure.responsibleKey]!
  const deadline = mappings.deadlineMapping[measure.deadlineKey]!
  return {
    id: `riskcontrol-${nanoid()}`,
    riskEntryId,
    hierarchy: mappings.measureMapping[measure.phraseKey]!,
    description: measure.text,
    isExisting: deadline.kind === "existing",
    verificationFrequency: deadline.kind === "existing" ? cleanMiperName(deadline.frequency) : null,
    dueDate: deadline.kind === "pending" ? deadline.dueDate : null,
    responsibleUserId: responsible.kind === "user" ? responsible.userId : null,
    responsibleSnapshot: responsible.kind === "user" ? names.get(responsible.userId) ?? null
      : responsible.kind === "text" ? cleanMiperName(responsible.name) : null,
    status: "proposed",
    /* Todas nacen en la misma transacción: un milisegundo más por medida conserva
     * el orden del Excel (la foto ordena por `created_at` y desempata por id). */
    createdAt: new Date(Date.parse(now) + index).toISOString(),
    updatedAt: now,
  }
}

async function liveMatrix(client: Client, worksiteId: string) {
  const [vigente] = await client.select({ id: preventionRiskMatrices.id }).from(preventionRiskMatrices)
    .where(and(eq(preventionRiskMatrices.worksiteId, worksiteId), eq(preventionRiskMatrices.status, "published")))
    .for("update").limit(1)
  if (!vigente) throw new RiskLegalDomainError("La faena no tiene una MIPER vigente a la que agregar las filas: cárgalas en un borrador.")
  return vigente
}

/**
 * Columnas de la fila del RE-04. Los textos de diccionario (actividad, tarea,
 * puesto, lugar) se resuelven o se crean como en la grilla (`resolveDictionaryId`);
 * `source_*` guarda la traza del Excel y `normalization_decision` deja escrito
 * qué avisos se informaron y no se guardaron.
 */
async function entryColumns(
  client: Client,
  worksiteId: string,
  values: Re04Normalized,
  riskFactorId: string | null,
  trace: { rowNumber: number; original: Record<string, unknown>; normalized: Record<string, unknown>; issues: readonly RiskImportIssue[] },
) {
  const informed = trace.issues.filter((issue) => issue.code === "mr_mismatch" || issue.code === "classification_mismatch").map((issue) => issue.code)
  return {
    processId: await resolveDictionaryId(client, "activity", worksiteId, values.activity),
    taskId: await resolveDictionaryId(client, "task", worksiteId, values.task),
    positionId: await resolveDictionaryId(client, "position", worksiteId, values.position),
    locationId: await resolveDictionaryId(client, "location", worksiteId, values.location),
    hazard: cleanMiperName(values.hazard),
    risk: cleanMiperName(values.risk),
    probableDamage: cleanMiperName(values.probableDamage),
    exposedFemale: values.exposedFemale ?? 0,
    exposedMale: values.exposedMale ?? 0,
    exposedOther: values.exposedOther ?? 0,
    isRoutine: values.isRoutine,
    // `magnitude` y `classification` son generadas: no se insertan.
    probability: values.probability,
    consequence: values.consequence,
    controlledStatus: values.controlledStatus,
    riskFactorId,
    sourceRowNumber: trace.rowNumber,
    sourceOriginal: trace.original,
    sourceNormalized: trace.normalized,
    normalizationDecision: informed.length > 0 ? informed.join(",") : null,
  }
}
