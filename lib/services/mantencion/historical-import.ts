import { and, asc, eq, ilike, inArray, isNull, or, sql, type SQL } from "drizzle-orm"
import { db, type DB, type Tx } from "@/db"
import { fuelVehicles, mantHistoricalRecords, worksites } from "@/db/schema"
import { recordAudit } from "@/lib/audit"
import { nanoid } from "@/lib/id"
import type { MantViewer } from "./access"
import type { MantActor } from "./equipment-history"
import { parseHistoricalWorkbook, resolveHistoricalEquipment, resolveHistoricalWorksite, type HistoricalRow } from "./historical-workbook"
import type { MantActionResult } from "./result"

const PAGE_SIZE = 25
const BATCH_SIZE = 200
type Client = DB | Tx
type Stored = Pick<typeof mantHistoricalRecords.$inferSelect, "sourceKey" | "fingerprint" | "vehicleId" | "worksiteId" | "sourceFile" | "sourceSheet" | "sourceRow">
interface PlannedRow { row: HistoricalRow; vehicleId: string | null; worksiteId: string | null; equipmentMatch: "linked" | "unmatched" | "conflict"; existing: Stored | undefined; relink: boolean }
export interface HistoricalSummary { total: number; created: number; unchanged: number; relinked: number; linked: number; unmatched: number; conflicts: number; unresolvedWorksites: number }
export interface HistoricalPreview { summary: HistoricalSummary; pending: Array<{ sheet: string; rowNumber: number; equipment: string; worksite: string; issue: string }> }

const sourceFileName = (fileName: string) => fileName.split(/[\\/]/).pop()?.slice(0, 150) || "consolidado.xlsx"

async function plan(client: Client, rows: HistoricalRow[], fileName: string): Promise<MantActionResult<{ rows: PlannedRow[]; preview: HistoricalPreview }>> {
  const [vehicles, sites] = await Promise.all([
    client.select({ id: fuelVehicles.id, code: fuelVehicles.code, plate: fuelVehicles.plate }).from(fuelVehicles),
    client.select({ id: worksites.id, name: worksites.name }).from(worksites),
  ])
  const stored = new Map<string, Stored>()
  const fields = {
    sourceKey: mantHistoricalRecords.sourceKey, fingerprint: mantHistoricalRecords.fingerprint,
    vehicleId: mantHistoricalRecords.vehicleId, worksiteId: mantHistoricalRecords.worksiteId,
    sourceFile: mantHistoricalRecords.sourceFile, sourceSheet: mantHistoricalRecords.sourceSheet, sourceRow: mantHistoricalRecords.sourceRow,
  }
  const sameFile = await client.select(fields).from(mantHistoricalRecords).where(eq(mantHistoricalRecords.sourceFile, fileName))
  for (const record of sameFile) stored.set(record.sourceKey, record)
  for (let start = 0; start < rows.length; start += BATCH_SIZE) {
    const batch = rows.slice(start, start + BATCH_SIZE)
    const existing = await client.select(fields).from(mantHistoricalRecords).where(or(
      inArray(mantHistoricalRecords.sourceKey, batch.map((row) => row.sourceKey)),
      inArray(mantHistoricalRecords.fingerprint, batch.map((row) => row.fingerprint)),
    ))
    for (const record of existing) stored.set(record.sourceKey, record)
  }
  const byKey = stored
  const byFingerprint = new Map<string, Stored[]>()
  const byOrigin = new Map<string, Stored[]>()
  for (const record of stored.values()) {
    const candidates = byFingerprint.get(record.fingerprint) ?? []
    candidates.push(record)
    byFingerprint.set(record.fingerprint, candidates)
    if (record.sourceFile === fileName) {
      const origin = JSON.stringify([record.sourceSheet, record.sourceRow])
      const matches = byOrigin.get(origin) ?? []
      matches.push(record)
      byOrigin.set(origin, matches)
    }
  }
  const changed = rows.find((row) => byKey.has(row.sourceKey) && byKey.get(row.sourceKey)!.fingerprint !== row.fingerprint)
  if (changed) return { ok: false, message: `${changed.sheet}, fila ${changed.rowNumber}: la respuesta ya fue importada con contenido diferente. No se sobrescribió; revisa el archivo de origen.` }
  const existingForRow = new Map<string, Stored>()
  for (const row of rows) {
    const exact = byKey.get(row.sourceKey)
    if (exact) { existingForRow.set(row.sourceKey, exact); continue }
    const candidates = byFingerprint.get(row.fingerprint) ?? []
    if (!candidates.length) {
      if (byOrigin.has(JSON.stringify([row.sheet, row.rowNumber]))) return { ok: false, message: `${row.sheet}, fila ${row.rowNumber}: la respuesta ya fue importada con contenido diferente. No se sobrescribió; revisa el archivo de origen.` }
      continue
    }
    const sameOrigin = candidates.filter((record) => record.sourceFile === fileName && record.sourceSheet === row.sheet && record.sourceRow === row.rowNumber)
    if (sameOrigin.length !== 1) return { ok: false, message: `${row.sheet}, fila ${row.rowNumber}: coincide con una respuesta anterior, pero no se puede verificar su origen. Revisa el posible duplicado.` }
    existingForRow.set(row.sourceKey, sameOrigin[0]!)
  }
  const planned = rows.map((row): PlannedRow => {
    const existing = existingForRow.get(row.sourceKey)
    const match = resolveHistoricalEquipment(row.equipmentText, vehicles)
    const worksiteId = existing?.worksiteId ?? resolveHistoricalWorksite(row.worksiteText, sites)
    const vehicleId = existing?.vehicleId ?? match.vehicleId
    return {
      row, existing, vehicleId, worksiteId,
      equipmentMatch: vehicleId ? "linked" : match.state,
      relink: !!existing && ((!existing.vehicleId && !!vehicleId) || (!existing.worksiteId && !!worksiteId)),
    }
  })
  const count = (fn: (item: PlannedRow) => boolean) => planned.filter(fn).length
  const summary: HistoricalSummary = {
    total: planned.length, created: count((item) => !item.existing),
    unchanged: count((item) => !!item.existing && !item.relink), relinked: count((item) => item.relink),
    linked: count((item) => !!item.vehicleId), unmatched: count((item) => item.equipmentMatch === "unmatched"),
    conflicts: count((item) => item.equipmentMatch === "conflict"), unresolvedWorksites: count((item) => !item.worksiteId),
  }
  const pending = planned.filter((item) => !item.vehicleId || !item.worksiteId).slice(0, 50).map((item) => ({
    sheet: item.row.sheet, rowNumber: item.row.rowNumber, equipment: item.row.equipmentText, worksite: item.row.worksiteText,
    issue: [!item.vehicleId ? (item.equipmentMatch === "conflict" ? "Código y patente requieren revisión" : "Equipo no encontrado") : "", !item.worksiteId ? "Faena sin vincular" : ""].filter(Boolean).join("; "),
  }))
  return { ok: true, data: { rows: planned, preview: { summary, pending } } }
}

export async function previewHistoricalImport(buffer: ArrayBuffer, fileName = ""): Promise<MantActionResult<HistoricalPreview>> {
  const parsed = await parseHistoricalWorkbook(buffer)
  if (!parsed.ok) return parsed
  const result = await plan(db, parsed.rows, sourceFileName(fileName))
  return result.ok ? { ok: true, data: result.data.preview } : result
}

/** Vuelve a validar bajo un lock común; una respuesta modificada aborta toda la carga. */
export async function commitHistoricalImport(actor: MantActor, buffer: ArrayBuffer, fileName: string): Promise<MantActionResult<HistoricalSummary>> {
  const parsed = await parseHistoricalWorkbook(buffer)
  if (!parsed.ok) return parsed
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('mant-historical-import'))`)
    const file = sourceFileName(fileName)
    const planned = await plan(tx, parsed.rows, file)
    if (!planned.ok) return planned
    const additions = planned.data.rows.filter((item) => !item.existing).map(({ row, vehicleId, worksiteId, equipmentMatch }) => ({
      sourceKey: row.sourceKey, fingerprint: row.fingerprint, sourceFile: file, sourceSheet: row.sheet, sourceRow: row.rowNumber,
      submittedAt: row.submittedAt, worksiteText: row.worksiteText, worksiteId, equipmentText: row.equipmentText,
      vehicleId, equipmentMatch, orderText: row.orderText, kindText: row.kindText, readingText: row.readingText,
      description: row.description, entryDate: row.entryDate, exitDate: row.exitDate, hoursText: row.hoursText,
      fields: row.fields, importedBy: actor.userId,
    }))
    for (let start = 0; start < additions.length; start += BATCH_SIZE) await tx.insert(mantHistoricalRecords).values(additions.slice(start, start + BATCH_SIZE))
    for (const item of planned.data.rows.filter((candidate) => candidate.relink)) {
      await tx.update(mantHistoricalRecords).set({ vehicleId: item.vehicleId, worksiteId: item.worksiteId, equipmentMatch: item.equipmentMatch }).where(eq(mantHistoricalRecords.sourceKey, item.existing!.sourceKey))
    }
    const summary = planned.data.preview.summary
    if (summary.created || summary.relinked) await recordAudit({
      userId: actor.userId, userEmail: actor.email ?? undefined, action: "create", entityType: "mant_historical_import", entityId: nanoid(),
      newState: { fileName: file, ...summary },
    }, tx)
    return { ok: true as const, data: summary, message: `${summary.created} trabajos importados; ${summary.relinked} vínculos completados.` }
  })
}

/** Las identidades de los autores de Forms no están probadas: permiso «propios» no abre este historial. */
function historicalVisibility(viewer: MantViewer): SQL {
  if (viewer.permissions.includes("mant:records:view_all")) return sql`true`
  if (viewer.permissions.includes("mant:records:view_worksite")) {
    if (viewer.isGlobal) return sql`true`
    if (viewer.worksiteIds.length) return inArray(mantHistoricalRecords.worksiteId, [...viewer.worksiteIds])
  }
  return sql`false`
}

export async function listHistoricalRecords(viewer: MantViewer, options: { page?: number; search?: string; vehicleId?: string; pending?: "equipment" | "conflict" | "worksite" }) {
  const requestedPage = Number.isInteger(options.page) && options.page! > 0 ? Math.min(options.page!, 100_000) : 1
  const query = options.search?.trim().slice(0, 100)
  const pattern = query ? `%${query.replace(/[\\%_]/g, "\\$&")}%` : undefined
  const where = and(
    historicalVisibility(viewer),
    options.vehicleId ? eq(mantHistoricalRecords.vehicleId, options.vehicleId) : undefined,
    options.pending === "equipment" ? isNull(mantHistoricalRecords.vehicleId) : undefined,
    options.pending === "conflict" ? eq(mantHistoricalRecords.equipmentMatch, "conflict") : undefined,
    options.pending === "worksite" ? isNull(mantHistoricalRecords.worksiteId) : undefined,
    pattern ? or(ilike(mantHistoricalRecords.equipmentText, pattern), ilike(mantHistoricalRecords.orderText, pattern), ilike(mantHistoricalRecords.description, pattern), ilike(mantHistoricalRecords.worksiteText, pattern)) : undefined,
  )
  const [count] = await db.select({ total: sql<number>`count(*)::int` }).from(mantHistoricalRecords).where(where)
  const total = count?.total ?? 0
  const page = Math.min(requestedPage, Math.max(1, Math.ceil(total / PAGE_SIZE)))
  const rows = await db.select({
      sourceKey: mantHistoricalRecords.sourceKey, worksiteText: mantHistoricalRecords.worksiteText, equipmentText: mantHistoricalRecords.equipmentText,
      worksiteId: mantHistoricalRecords.worksiteId, vehicleId: mantHistoricalRecords.vehicleId, equipmentMatch: mantHistoricalRecords.equipmentMatch, orderText: mantHistoricalRecords.orderText,
      kindText: mantHistoricalRecords.kindText, description: mantHistoricalRecords.description, entryDate: mantHistoricalRecords.entryDate, submittedAt: mantHistoricalRecords.submittedAt,
    }).from(mantHistoricalRecords).where(where)
      .orderBy(sql`coalesce(${mantHistoricalRecords.entryDate}, left(${mantHistoricalRecords.submittedAt}, 10)) desc`, asc(mantHistoricalRecords.sourceKey))
      .limit(PAGE_SIZE).offset((page - 1) * PAGE_SIZE)
  return { rows, total, page, pageSize: PAGE_SIZE }
}

export async function getHistoricalRecord(viewer: MantViewer, sourceKey: string) {
  if (!/^[a-f0-9]{64}$/.test(sourceKey)) return null
  const [record] = await db.select().from(mantHistoricalRecords).where(and(eq(mantHistoricalRecords.sourceKey, sourceKey), historicalVisibility(viewer))).limit(1)
  return record ?? null
}

export async function historicalLinkOptions() {
  const [vehicles, sites] = await Promise.all([
    db.select({ id: fuelVehicles.id, code: fuelVehicles.code, plate: fuelVehicles.plate }).from(fuelVehicles).orderBy(asc(fuelVehicles.code), asc(fuelVehicles.plate)),
    db.select({ id: worksites.id, name: worksites.name }).from(worksites).orderBy(asc(worksites.name)),
  ])
  return { vehicles, sites }
}

/** La conciliación manual sólo completa vínculos vacíos y conserva el contenido de origen. */
export async function linkHistoricalRecord(actor: MantActor, sourceKey: string, input: { vehicleId?: string; worksiteId?: string }): Promise<MantActionResult> {
  if (!/^[a-f0-9]{64}$/.test(sourceKey) || (!input.vehicleId && !input.worksiteId)) return { ok: false, message: "Elige un equipo o una faena para vincular." }
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('mant-historical-import'))`)
    const [current] = await tx.select().from(mantHistoricalRecords).where(eq(mantHistoricalRecords.sourceKey, sourceKey)).limit(1)
    if (!current) return { ok: false as const, message: "No se encontró el antecedente." }
    if ((input.vehicleId && current.vehicleId) || (input.worksiteId && current.worksiteId)) return { ok: false as const, message: "El vínculo ya fue resuelto. Recarga la página para revisarlo." }
    if (input.vehicleId) {
      const [vehicle] = await tx.select({ id: fuelVehicles.id }).from(fuelVehicles).where(eq(fuelVehicles.id, input.vehicleId)).limit(1)
      if (!vehicle) return { ok: false as const, message: "El equipo elegido no existe." }
    }
    if (input.worksiteId) {
      const [site] = await tx.select({ id: worksites.id }).from(worksites).where(eq(worksites.id, input.worksiteId)).limit(1)
      if (!site) return { ok: false as const, message: "La faena elegida no existe." }
    }
    const vehicleId = input.vehicleId || current.vehicleId
    const worksiteId = input.worksiteId || current.worksiteId
    await tx.update(mantHistoricalRecords).set({ vehicleId, worksiteId, equipmentMatch: vehicleId ? "linked" : current.equipmentMatch }).where(eq(mantHistoricalRecords.sourceKey, sourceKey))
    await recordAudit({
      userId: actor.userId, userEmail: actor.email ?? undefined, action: "update", entityType: "mant_historical_record", entityId: sourceKey,
      oldState: { vehicleId: current.vehicleId, worksiteId: current.worksiteId }, newState: { vehicleId, worksiteId },
    }, tx)
    return { ok: true as const, message: "Vínculos guardados." }
  })
}
