/**
 * Servicio de los importadores del control (telemetría y entradas de
 * suministro): vista previa, confirmación idempotente, reversión e historial.
 *
 * Idempotencia en dos capas: el hash del archivo bloquea reimportar el mismo
 * archivo (con `pg_advisory_xact_lock` y revisión bajo el lock) y cada fila hace
 * upsert por su llave natural, de modo que archivos que se superponen no
 * duplican nada. Una fila que actualiza un registro existente conserva el lote
 * que lo creó: revertir el lote nuevo elimina lo que ese lote insertó.
 */
import type { Session } from "next-auth"
import { and, desc, eq, inArray, notInArray, sql } from "drizzle-orm"
import { db, type Tx } from "@/db"
import {
  fuelControlImportBatches,
  fuelControlImportRejections,
  fuelSupplyInputs,
  fuelSupplyMedia,
  fuelTelemetryDaily,
  fuelVehicles,
  users,
  worksites,
} from "@/db/schema"
import { recordAudit } from "@/lib/audit"
import { isGlobalRole, resolveWorksiteScope, canAccessWorksite } from "@/lib/auth/scope"
import { nanoid } from "@/lib/id"
import {
  buildVehicleIndex,
  buildWorksiteIndex,
  sha256Hex,
  type ControlImportKind,
  type ImportRowIssue,
} from "./shared"
import { DEFAULT_TELEMETRY_SOURCE, normalizeSourceSlug, parseTelemetryWorkbook, resolveTelemetryRows, type ResolvedTelemetryRow } from "./telemetry"
import { parseSupplyInputsWorkbook, resolveSupplyRows, type ResolvedSupplyRow } from "./supply-inputs"

const CHUNK = 500
const MAX_STORED_REJECTIONS = 5000

export interface ControlImportInput {
  buffer: Uint8Array
  fileName: string
  /** Telemetría: fuente libre («VisionLink»). */
  source?: string
  /** Entradas de suministro: medio elegido en el paso de carga. */
  supplyMediumId?: string
}

export interface PreviewSampleRow {
  rowIndex: number
  action: "insert" | "update"
  cells: string[]
}

export interface ControlImportPreview {
  kind: ControlImportKind
  fileHash: string
  totalRows: number
  validRows: number
  toInsert: number
  toUpdate: number
  rejected: ImportRowIssue[]
  /** Cabeceras y primeras filas válidas, para comprobar a ojo que el archivo se leyó bien. */
  sampleHeaders: string[]
  sample: PreviewSampleRow[]
  periodFrom: string | null
  periodTo: string | null
  /** Equipos distintos (telemetría) o litros totales (entradas). */
  distinctVehicles: number
  totalLiters: number
  /** Etiqueta de la fuente o del medio con que se importará. */
  targetLabel: string
  alreadyImported: { batchId: string; importedAt: string } | null
}

export interface ControlImportResult {
  batchId: string
  inserted: number
  updated: number
  rejected: ImportRowIssue[]
  rejectedCount: number
}

type Failure = { ok: false; message: string }

type Prepared =
  | Failure
  | {
      ok: true
      kind: ControlImportKind
      fileHash: string
      totalRows: number
      issues: ImportRowIssue[]
      telemetry: ResolvedTelemetryRow[]
      supply: ResolvedSupplyRow[]
      source: string
      medium: { id: string; name: string } | null
      rawRows: Map<number, Record<string, unknown>>
    }

function sortIssues(issues: ImportRowIssue[]): ImportRowIssue[] {
  return [...issues].sort((left, right) => left.rowIndex - right.rowIndex)
}

/** Lee, valida y resuelve el archivo con las mismas reglas para la vista previa y la confirmación. */
async function prepare(session: Session, kind: ControlImportKind, input: ControlImportInput, client: Tx | typeof db = db): Promise<Prepared> {
  const fileHash = sha256Hex(input.buffer)
  const access = (worksiteId: string) => canAccessWorksite(session, worksiteId)

  if (kind === "telemetry") {
    const source = normalizeSourceSlug(input.source?.trim() || DEFAULT_TELEMETRY_SOURCE)
    if (!source) return { ok: false, message: "Indica la fuente de la telemetría (por ejemplo VisionLink)" }
    const parsed = await parseTelemetryWorkbook(input.buffer)
    if (parsed.fileIssue) return { ok: false, message: parsed.fileIssue }
    if (parsed.totalRows === 0) return { ok: false, message: "El archivo no contiene filas de datos" }
    const vehicles = await client.select({ id: fuelVehicles.id, code: fuelVehicles.code, plate: fuelVehicles.plate, worksiteId: fuelVehicles.worksiteId }).from(fuelVehicles)
    const resolved = resolveTelemetryRows(parsed.rows, buildVehicleIndex(vehicles).find, access)
    return {
      ok: true, kind, fileHash, totalRows: parsed.totalRows, source, medium: null, supply: [],
      telemetry: resolved.valid,
      issues: sortIssues([...parsed.issues, ...resolved.issues]),
      rawRows: parsed.rawRows,
    }
  }

  const mediumId = input.supplyMediumId?.trim()
  if (!mediumId) return { ok: false, message: "Elige el medio de suministro del archivo" }
  const [medium] = await client.select({ id: fuelSupplyMedia.id, name: fuelSupplyMedia.name, isActive: fuelSupplyMedia.isActive }).from(fuelSupplyMedia).where(eq(fuelSupplyMedia.id, mediumId))
  if (!medium || !medium.isActive) return { ok: false, message: "El medio de suministro no existe o está inactivo" }
  const parsed = await parseSupplyInputsWorkbook(input.buffer)
  if (parsed.fileIssue) return { ok: false, message: parsed.fileIssue }
  if (parsed.totalRows === 0) return { ok: false, message: "El archivo no contiene filas de datos" }
  const [vehicles, sites] = await Promise.all([
    client.select({ id: fuelVehicles.id, code: fuelVehicles.code, plate: fuelVehicles.plate, worksiteId: fuelVehicles.worksiteId }).from(fuelVehicles),
    client.select({ id: worksites.id, name: worksites.name, code: worksites.code }).from(worksites),
  ])
  const resolved = resolveSupplyRows(parsed.rows, buildWorksiteIndex(sites).find, buildVehicleIndex(vehicles).find, access)
  return {
    ok: true, kind, fileHash, totalRows: parsed.totalRows, source: "", medium: { id: medium.id, name: medium.name }, telemetry: [],
    supply: resolved.valid,
    issues: sortIssues([...parsed.issues, ...resolved.issues]),
    rawRows: parsed.rawRows,
  }
}

async function findActiveBatchByHash(kind: ControlImportKind, fileHash: string, client: Tx | typeof db = db) {
  const [batch] = await client.select({ id: fuelControlImportBatches.id, createdAt: fuelControlImportBatches.createdAt })
    .from(fuelControlImportBatches)
    .where(and(eq(fuelControlImportBatches.kind, kind), eq(fuelControlImportBatches.fileHash, fileHash), eq(fuelControlImportBatches.status, "imported")))
    .limit(1)
  return batch ?? null
}

function chunked<T>(items: T[], size = CHUNK): T[][] {
  const out: T[][] = []
  for (let index = 0; index < items.length; index += size) out.push(items.slice(index, index + size))
  return out
}

async function existingTelemetryKeys(client: Tx | typeof db, source: string, rows: ResolvedTelemetryRow[]): Promise<Set<string>> {
  const keys = new Set<string>()
  const vehicleIds = [...new Set(rows.map((row) => row.vehicleId))]
  for (const part of chunked(vehicleIds, 1000)) {
    const found = await client.select({ vehicleId: fuelTelemetryDaily.vehicleId, day: fuelTelemetryDaily.day })
      .from(fuelTelemetryDaily)
      .where(and(eq(fuelTelemetryDaily.source, source), inArray(fuelTelemetryDaily.vehicleId, part)))
    for (const row of found) keys.add(`${row.vehicleId}|${row.day}`)
  }
  return keys
}

async function existingSupplyReferences(client: Tx | typeof db, mediumId: string, rows: ResolvedSupplyRow[]): Promise<Set<string>> {
  const references = new Set<string>()
  for (const part of chunked(rows.map((row) => row.reference), 1000)) {
    const found = await client.select({ reference: fuelSupplyInputs.reference }).from(fuelSupplyInputs)
      .where(and(eq(fuelSupplyInputs.supplyMediumId, mediumId), inArray(fuelSupplyInputs.reference, part)))
    for (const row of found) references.add(row.reference)
  }
  return references
}

function periodOf(days: string[]): { from: string | null; to: string | null } {
  if (days.length === 0) return { from: null, to: null }
  const sorted = [...days].sort()
  return { from: sorted[0]!, to: sorted[sorted.length - 1]! }
}

export async function previewControlImport(session: Session, kind: ControlImportKind, input: ControlImportInput): Promise<{ ok: true; data: ControlImportPreview } | Failure> {
  const prepared = await prepare(session, kind, input)
  if (!prepared.ok) return prepared
  const alreadyImported = await findActiveBatchByHash(kind, prepared.fileHash)
  const base = {
    kind, fileHash: prepared.fileHash, totalRows: prepared.totalRows, rejected: prepared.issues,
    alreadyImported: alreadyImported ? { batchId: alreadyImported.id, importedAt: alreadyImported.createdAt } : null,
  }

  if (kind === "telemetry") {
    const existing = await existingTelemetryKeys(db, prepared.source, prepared.telemetry)
    const isUpdate = (row: ResolvedTelemetryRow) => existing.has(`${row.vehicleId}|${row.day}`)
    const period = periodOf(prepared.telemetry.map((row) => row.day))
    const toUpdate = prepared.telemetry.filter(isUpdate).length
    return {
      ok: true,
      data: {
        ...base, validRows: prepared.telemetry.length, toUpdate, toInsert: prepared.telemetry.length - toUpdate,
        sampleHeaders: ["Fila", "Equipo", "Fecha", "H. funcionamiento", "H. en vacío"],
        sample: prepared.telemetry.slice(0, 8).map((row) => ({
          rowIndex: row.rowIndex, action: isUpdate(row) ? "update" : "insert",
          cells: [String(row.rowIndex), row.equipment, row.day, String(row.operatingHours), String(row.idleHours)],
        })),
        periodFrom: period.from, periodTo: period.to,
        distinctVehicles: new Set(prepared.telemetry.map((row) => row.vehicleId)).size,
        totalLiters: 0, targetLabel: prepared.source,
      },
    }
  }

  const existing = await existingSupplyReferences(db, prepared.medium!.id, prepared.supply)
  const isUpdate = (row: ResolvedSupplyRow) => existing.has(row.reference)
  const period = periodOf(prepared.supply.map((row) => row.day))
  const toUpdate = prepared.supply.filter(isUpdate).length
  return {
    ok: true,
    data: {
      ...base, validRows: prepared.supply.length, toUpdate, toInsert: prepared.supply.length - toUpdate,
      sampleHeaders: ["Fila", "Fecha", "Faena", "Litros", "Referencia"],
      sample: prepared.supply.slice(0, 8).map((row) => ({
        rowIndex: row.rowIndex, action: isUpdate(row) ? "update" : "insert",
        cells: [String(row.rowIndex), row.day, row.worksite, String(row.liters), row.reference],
      })),
      periodFrom: period.from, periodTo: period.to,
      distinctVehicles: 0,
      totalLiters: prepared.supply.reduce((sum, row) => sum + row.liters, 0),
      targetLabel: prepared.medium!.name,
    },
  }
}

export async function commitControlImport(session: Session, kind: ControlImportKind, input: ControlImportInput): Promise<{ ok: true; data: ControlImportResult } | Failure> {
  const prepared = await prepare(session, kind, input)
  if (!prepared.ok) return prepared
  const validCount = kind === "telemetry" ? prepared.telemetry.length : prepared.supply.length
  if (validCount === 0) return { ok: false, message: "No hay filas válidas para importar. Corrige las filas rechazadas y vuelve a subir el archivo." }
  const userId = session.user.id

  const outcome = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`fuel_control_import:${kind}:${prepared.fileHash}`}))`)
    const duplicate = await findActiveBatchByHash(kind, prepared.fileHash, tx)
    if (duplicate) return { ok: false as const, message: `Este archivo ya fue importado (lote ${duplicate.id}). Si fue un error, reviértelo desde el historial y vuelve a subirlo.` }

    const batchId = nanoid()
    let updated = 0
    if (kind === "telemetry") {
      const existing = await existingTelemetryKeys(tx, prepared.source, prepared.telemetry)
      updated = prepared.telemetry.filter((row) => existing.has(`${row.vehicleId}|${row.day}`)).length
    } else {
      const existing = await existingSupplyReferences(tx, prepared.medium!.id, prepared.supply)
      updated = prepared.supply.filter((row) => existing.has(row.reference)).length
    }
    const inserted = validCount - updated

    await tx.insert(fuelControlImportBatches).values({
      id: batchId, kind, fileName: input.fileName.slice(0, 200), fileHash: prepared.fileHash, status: "imported",
      totalRows: prepared.totalRows, insertedRows: inserted, updatedRows: updated, rejectedRows: prepared.issues.length, importedBy: userId,
    })

    if (kind === "telemetry") {
      for (const part of chunked(prepared.telemetry)) {
        await tx.insert(fuelTelemetryDaily).values(part.map((row) => ({
          id: nanoid(), batchId, vehicleId: row.vehicleId, source: prepared.source, day: row.day, month: row.month,
          operatingHours: row.operatingHours, idleHours: row.idleHours, litersWorking: row.litersWorking, litersIdle: row.litersIdle,
        }))).onConflictDoUpdate({
          target: [fuelTelemetryDaily.vehicleId, fuelTelemetryDaily.day, fuelTelemetryDaily.source],
          set: {
            operatingHours: sql`excluded.operating_hours`, idleHours: sql`excluded.idle_hours`,
            litersWorking: sql`excluded.liters_working`, litersIdle: sql`excluded.liters_idle`, updatedAt: sql`now()`,
          },
        })
      }
    } else {
      for (const part of chunked(prepared.supply)) {
        await tx.insert(fuelSupplyInputs).values(part.map((row) => ({
          id: nanoid(), batchId, supplyMediumId: prepared.medium!.id, worksiteId: row.worksiteId, vehicleId: row.vehicleId,
          occurredAt: row.occurredAt, month: row.month, liters: row.liters, reference: row.reference, rawRow: row.rawRow,
        }))).onConflictDoUpdate({
          target: [fuelSupplyInputs.supplyMediumId, fuelSupplyInputs.reference],
          set: {
            worksiteId: sql`excluded.worksite_id`, vehicleId: sql`excluded.vehicle_id`, occurredAt: sql`excluded.occurred_at`,
            month: sql`excluded.month`, liters: sql`excluded.liters`, rawRow: sql`excluded.raw_row`, updatedAt: sql`now()`,
          },
        })
      }
    }

    const stored = prepared.issues.slice(0, MAX_STORED_REJECTIONS)
    for (const part of chunked(stored)) {
      await tx.insert(fuelControlImportRejections).values(part.map((issue) => ({
        id: nanoid(), batchKind: kind, batchId, rowIndex: issue.rowIndex, field: issue.field, message: issue.message, rawRow: prepared.rawRows.get(issue.rowIndex) ?? null,
      })))
    }

    const period = periodOf([...prepared.telemetry, ...prepared.supply].map((row) => row.day))
    await recordAudit({
      userId, userEmail: session.user.email ?? undefined, action: "create", entityType: "fuel_control_import_batch", entityId: batchId,
      entityCode: input.fileName.slice(0, 80),
      newState: {
        kind, target: kind === "telemetry" ? prepared.source : prepared.medium!.name, fileName: input.fileName, fileHash: prepared.fileHash,
        totalRows: prepared.totalRows, insertedRows: inserted, updatedRows: updated, rejectedRows: prepared.issues.length, period,
      },
      reason: "Importación de archivo",
    }, tx)
    return { ok: true as const, batchId, inserted, updated }
  })

  if (!outcome.ok) return outcome
  return { ok: true, data: { batchId: outcome.batchId, inserted: outcome.inserted, updated: outcome.updated, rejected: prepared.issues.slice(0, 200), rejectedCount: prepared.issues.length } }
}

// ── Historial y reversión ──────────────────────────────────────────────────

export interface ControlImportBatchRow {
  id: string
  kind: ControlImportKind
  fileName: string
  status: "imported" | "reverted"
  totalRows: number
  insertedRows: number
  updatedRows: number
  rejectedRows: number
  importedByName: string | null
  createdAt: string
}

/** Lotes que el usuario puede ver: todos para roles globales; los demás, solo los suyos. */
export async function listControlImportBatches(session: Session, limit = 50): Promise<ControlImportBatchRow[]> {
  const rows = await db.select({
    id: fuelControlImportBatches.id, kind: fuelControlImportBatches.kind, fileName: fuelControlImportBatches.fileName,
    status: fuelControlImportBatches.status, totalRows: fuelControlImportBatches.totalRows, insertedRows: fuelControlImportBatches.insertedRows,
    updatedRows: fuelControlImportBatches.updatedRows, rejectedRows: fuelControlImportBatches.rejectedRows,
    importedByName: users.name, createdAt: fuelControlImportBatches.createdAt,
  })
    .from(fuelControlImportBatches)
    .leftJoin(users, eq(users.id, fuelControlImportBatches.importedBy))
    .where(isGlobalRole(session) ? undefined : eq(fuelControlImportBatches.importedBy, session.user.id))
    .orderBy(desc(fuelControlImportBatches.createdAt))
    .limit(limit)
  return rows.map((row) => ({ ...row, kind: row.kind as ControlImportKind, status: row.status as "imported" | "reverted" }))
}

/** Filas del lote fuera de la faena del usuario: un lote mixto solo lo revierte quien ve todas sus faenas. */
async function rowsOutsideScope(tx: Tx, session: Session, kind: ControlImportKind, batchId: string): Promise<number> {
  const scope = resolveWorksiteScope(session)
  if (scope.mode === "all") return 0
  const ids = scope.mode === "some" ? scope.ids : ["__none__"]
  if (kind === "telemetry") {
    const [row] = await tx.select({ count: sql<number>`count(*)::int` }).from(fuelTelemetryDaily)
      .innerJoin(fuelVehicles, eq(fuelVehicles.id, fuelTelemetryDaily.vehicleId))
      .where(and(eq(fuelTelemetryDaily.batchId, batchId), notInArray(fuelVehicles.worksiteId, ids)))
    return row?.count ?? 0
  }
  const [row] = await tx.select({ count: sql<number>`count(*)::int` }).from(fuelSupplyInputs)
    .where(and(eq(fuelSupplyInputs.batchId, batchId), notInArray(fuelSupplyInputs.worksiteId, ids)))
  return row?.count ?? 0
}

export async function revertControlImportBatch(session: Session, batchId: string): Promise<{ ok: true; deletedRows: number } | Failure> {
  return db.transaction(async (tx) => {
    const [batch] = await tx.select().from(fuelControlImportBatches).where(eq(fuelControlImportBatches.id, batchId)).for("update")
    if (!batch) return { ok: false as const, message: "Lote no encontrado" }
    if (!isGlobalRole(session) && batch.importedBy !== session.user.id) return { ok: false as const, message: "Lote no encontrado" }
    if (batch.status === "reverted") return { ok: false as const, message: "Este lote ya fue revertido" }
    const kind = batch.kind as ControlImportKind
    if (await rowsOutsideScope(tx, session, kind, batchId) > 0) {
      return { ok: false as const, message: "El lote incluye filas de faenas fuera de tu alcance; pídele a alguien con acceso a todas ellas que lo revierta" }
    }
    const deleted = kind === "telemetry"
      ? await tx.delete(fuelTelemetryDaily).where(eq(fuelTelemetryDaily.batchId, batchId)).returning({ id: fuelTelemetryDaily.id })
      : await tx.delete(fuelSupplyInputs).where(eq(fuelSupplyInputs.batchId, batchId)).returning({ id: fuelSupplyInputs.id })
    await tx.update(fuelControlImportBatches).set({ status: "reverted" }).where(eq(fuelControlImportBatches.id, batchId))
    await recordAudit({
      userId: session.user.id, userEmail: session.user.email ?? undefined, action: "update", entityType: "fuel_control_import_batch", entityId: batchId,
      entityCode: batch.fileName.slice(0, 80), oldState: { status: batch.status, insertedRows: batch.insertedRows }, newState: { status: "reverted", deletedRows: deleted.length },
      reason: "Reversión del lote importado",
    }, tx)
    return { ok: true as const, deletedRows: deleted.length }
  })
}

/** Rechazos guardados de un lote (para descargarlos y corregirlos). */
export async function listBatchRejections(session: Session, batchId: string): Promise<{ ok: true; fileName: string; rows: Array<ImportRowIssue & { raw: Record<string, unknown> | null }> } | Failure> {
  const [batch] = await db.select({ id: fuelControlImportBatches.id, kind: fuelControlImportBatches.kind, fileName: fuelControlImportBatches.fileName, importedBy: fuelControlImportBatches.importedBy })
    .from(fuelControlImportBatches).where(eq(fuelControlImportBatches.id, batchId))
  if (!batch || (!isGlobalRole(session) && batch.importedBy !== session.user.id)) return { ok: false, message: "Lote no encontrado" }
  const rows = await db.select({ rowIndex: fuelControlImportRejections.rowIndex, field: fuelControlImportRejections.field, message: fuelControlImportRejections.message, raw: fuelControlImportRejections.rawRow })
    .from(fuelControlImportRejections)
    .where(and(eq(fuelControlImportRejections.batchKind, batch.kind), eq(fuelControlImportRejections.batchId, batchId)))
    .orderBy(fuelControlImportRejections.rowIndex)
  return { ok: true, fileName: batch.fileName, rows: rows.map((row) => ({ rowIndex: row.rowIndex, field: row.field ?? "", message: row.message, raw: (row.raw as Record<string, unknown> | null) ?? null })) }
}
