import { and, asc, eq, ilike, inArray, isNull, or, sql, type SQL } from "drizzle-orm"
import { db, type DB, type Tx } from "@/db"
import { fuelVehicles, mantHistoricalRecords, worksiteAliases, worksites } from "@/db/schema"
import { recordAudit } from "@/lib/audit"
import { nanoid } from "@/lib/id"
import { countsFromPlatform, cutoverNotice } from "@/lib/mantencion/forms-cutover"
import { visibleHistoricalFields } from "@/lib/mantencion/historical-privacy"
import { equipmentCurrentlyInWorksites, type MantViewer } from "./access"
import type { MantActor } from "./equipment-history"
import { parseHistoricalWorkbook, resolveHistoricalEquipment, resolveHistoricalWorksite, type HistoricalRow } from "./historical-workbook"
import type { MantActionResult } from "./result"

const PAGE_SIZE = 25
const BATCH_SIZE = 200
type Client = DB | Tx
type Stored = Pick<typeof mantHistoricalRecords.$inferSelect, "sourceKey" | "fingerprint" | "vehicleId" | "worksiteId" | "sourceFile" | "sourceSheet" | "sourceRow">
interface PlannedRow {
  row: HistoricalRow; vehicleId: string | null; worksiteId: string | null; equipmentMatch: "linked" | "unmatched" | "conflict"
  existing: Stored | undefined; relink: boolean
  /** Misma clave de origen que una fila ya guardada, pero con otro contenido (p. ej. la cargó el consolidado). Se conserva lo cargado. */
  differs: boolean
}
export interface HistoricalSummary {
  total: number; created: number; unchanged: number; relinked: number; linked: number; unmatched: number; conflicts: number; unresolvedWorksites: number
  /** Ya estaban cargadas con otro contenido (clave de origen igual, huella distinta): no se tocaron. */
  differing: number
  /** Posibles duplicados: entran como filas nuevas, pero conviene revisarlas. */
  possibleDuplicates: number
  /** Respuestas del archivo cuya fecha de trabajo es el corte de los formularios o posterior. */
  afterCutover: number
}
export interface HistoricalPreview {
  summary: HistoricalSummary
  pending: Array<{ sheet: string; rowNumber: number; equipment: string; worksite: string; issue: string }>
  /** Hasta 50 avisos de posible duplicado, con hoja y fila. */
  duplicates: Array<{ sheet: string; rowNumber: number; message: string }>
}

const PLAIN_DATE = /^\d{4}-\d{2}-\d{2}/
/**
 * Fecha del trabajo de una fila del historial: la de ingreso a taller si es una fecha válida y, si no, el día del envío.
 * Es la misma definición que usa el Panel (`HISTORICAL_DATE` en `maintenance-work.ts`).
 */
export const historicalWorkDate = (row: { entryDate: string | null; submittedAt: string }) =>
  row.entryDate && PLAIN_DATE.test(row.entryDate) ? row.entryDate.slice(0, 10) : row.submittedAt.slice(0, 10)

/** Misma expresión que `historicalWorkDate`, en SQL (para filtrar y ordenar). */
const HISTORICAL_WORK_DATE = sql<string>`CASE WHEN ${mantHistoricalRecords.entryDate} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' THEN left(${mantHistoricalRecords.entryDate}, 10) ELSE left(${mantHistoricalRecords.submittedAt}, 10) END`

/** `YYYY-MM-DD` que existe en el calendario; cualquier otra cosa se ignora. */
export function validPlainDate(value: string | undefined): string | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined
  const [year, month, day] = value.split("-").map(Number) as [number, number, number]
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? value : undefined
}

const sourceFileName = (fileName: string) => fileName.split(/[\\/]/).pop()?.slice(0, 150) || "consolidado.xlsx"

async function plan(client: Client, rows: HistoricalRow[], fileName: string): Promise<MantActionResult<{ rows: PlannedRow[]; preview: HistoricalPreview }>> {
  const [vehicles, sites, aliases] = await Promise.all([
    client.select({ id: fuelVehicles.id, code: fuelVehicles.code, plate: fuelVehicles.plate }).from(fuelVehicles),
    client.select({ id: worksites.id, name: worksites.name }).from(worksites),
    client.select({ worksiteId: worksiteAliases.worksiteId, aliasKey: worksiteAliases.aliasKey }).from(worksiteAliases),
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
  // Ninguna de estas situaciones aborta la carga (decisión 2026-11-22): una exportación de Forms trae todo el
  // histórico y el consolidado ya cargó esas respuestas con otro contenido. Lo ya guardado manda y no se sobrescribe.
  const existingForRow = new Map<string, Stored>()
  const duplicates: HistoricalPreview["duplicates"] = []
  let possibleDuplicates = 0
  const warn = (row: HistoricalRow, message: string) => {
    possibleDuplicates += 1
    if (duplicates.length < 50) duplicates.push({ sheet: row.sheet, rowNumber: row.rowNumber, message })
  }
  for (const row of rows) {
    const exact = byKey.get(row.sourceKey)
    if (exact) { existingForRow.set(row.sourceKey, exact); continue }
    const candidates = byFingerprint.get(row.fingerprint) ?? []
    if (!candidates.length) {
      if (byOrigin.has(JSON.stringify([row.sheet, row.rowNumber]))) warn(row, "posible duplicado: esa hoja y fila ya se había cargado con otro contenido (suele pasar cuando se borra una respuesta en Forms y las filas se corren)")
      continue
    }
    const sameOrigin = candidates.filter((record) => record.sourceFile === fileName && record.sourceSheet === row.sheet && record.sourceRow === row.rowNumber)
    if (sameOrigin.length === 1) { existingForRow.set(row.sourceKey, sameOrigin[0]!); continue }
    warn(row, "posible duplicado: coincide con una respuesta ya cargada con otra clave de origen (el mismo correo la envió más de una vez)")
  }
  const planned = rows.map((row): PlannedRow => {
    const existing = existingForRow.get(row.sourceKey)
    const match = resolveHistoricalEquipment(row.equipmentText, vehicles)
    const worksiteId = existing?.worksiteId ?? resolveHistoricalWorksite(row.worksiteText, sites, aliases)
    const vehicleId = existing?.vehicleId ?? match.vehicleId
    return {
      row, existing, vehicleId, worksiteId,
      equipmentMatch: vehicleId ? "linked" : match.state,
      relink: !!existing && ((!existing.vehicleId && !!vehicleId) || (!existing.worksiteId && !!worksiteId)),
      differs: !!existing && existing.fingerprint !== row.fingerprint,
    }
  })
  const count = (fn: (item: PlannedRow) => boolean) => planned.filter(fn).length
  const summary: HistoricalSummary = {
    total: planned.length, created: count((item) => !item.existing),
    unchanged: count((item) => !!item.existing && !item.relink), relinked: count((item) => item.relink),
    linked: count((item) => !!item.vehicleId), unmatched: count((item) => item.equipmentMatch === "unmatched"),
    conflicts: count((item) => item.equipmentMatch === "conflict"), unresolvedWorksites: count((item) => !item.worksiteId),
    differing: count((item) => item.differs), possibleDuplicates,
    afterCutover: count((item) => countsFromPlatform(historicalWorkDate(item.row))),
  }
  const pending = planned.filter((item) => !item.vehicleId || !item.worksiteId).slice(0, 50).map((item) => ({
    sheet: item.row.sheet, rowNumber: item.row.rowNumber, equipment: item.row.equipmentText, worksite: item.row.worksiteText,
    issue: [!item.vehicleId ? (item.equipmentMatch === "conflict" ? "Código y patente requieren revisión" : "Equipo no encontrado") : "", !item.worksiteId ? "Faena sin identificar" : ""].filter(Boolean).join("; "),
  }))
  return { ok: true, data: { rows: planned, preview: { summary, pending, duplicates } } }
}

export async function previewHistoricalImport(buffer: ArrayBuffer, fileName = ""): Promise<MantActionResult<HistoricalPreview>> {
  const parsed = await parseHistoricalWorkbook(buffer)
  if (!parsed.ok) return parsed
  const result = await plan(db, parsed.rows, sourceFileName(fileName))
  return result.ok ? { ok: true, data: result.data.preview } : result
}

/** Frase del aviso del corte de los formularios (vista previa, resumen y mensaje de la carga). */
export { cutoverNotice }

/** Vuelve a validar bajo un lock común; lo ya guardado no se sobrescribe y los dudosos entran con aviso. */
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
    const notes = [
      summary.differing ? `${summary.differing} ya estaban cargadas con contenido distinto (se conservó lo cargado).` : "",
      summary.possibleDuplicates ? `${summary.possibleDuplicates} posibles duplicados.` : "",
      summary.afterCutover ? cutoverNotice(summary.afterCutover) : "",
    ].filter(Boolean)
    return { ok: true as const, data: summary, message: [`${summary.created} trabajos importados; ${summary.relinked} completados con equipo o faena.`, ...notes].join(" ") }
  })
}

/**
 * Las identidades de los autores de Forms no están probadas: permiso «propios» no abre este historial.
 * La hoja de vida sigue al equipo: una fila se ve si su faena O la faena ACTUAL de su equipo vinculado
 * (`vehicle_id`) está en el alcance. Una fila sin equipo vinculado sólo cuenta por su faena.
 */
function historicalVisibility(viewer: MantViewer): SQL {
  if (viewer.permissions.includes("mant:records:view_all")) return sql`true`
  if (viewer.permissions.includes("mant:records:view_worksite")) {
    if (viewer.isGlobal) return sql`true`
    if (viewer.worksiteIds.length) {
      return or(
        inArray(mantHistoricalRecords.worksiteId, [...viewer.worksiteIds]),
        equipmentCurrentlyInWorksites(mantHistoricalRecords.vehicleId, viewer.worksiteIds),
      )!
    }
  }
  return sql`false`
}

/** La faena del filtro `?faena=`: sólo vale si existe y el usuario puede ver sus trabajos; si no, se ignora. */
export async function resolveHistoricalWorksiteFilter(viewer: MantViewer, worksiteId: string | undefined): Promise<{ id: string; name: string } | null> {
  if (!worksiteId) return null
  const seesAll = viewer.permissions.includes("mant:records:view_all") || (viewer.permissions.includes("mant:records:view_worksite") && viewer.isGlobal)
  if (!seesAll && !viewer.worksiteIds.includes(worksiteId)) return null
  const [site] = await db.select({ id: worksites.id, name: worksites.name }).from(worksites).where(eq(worksites.id, worksiteId)).limit(1)
  return site ?? null
}

export async function listHistoricalRecords(viewer: MantViewer, options: { page?: number; search?: string; vehicleId?: string; pending?: "equipment" | "conflict" | "worksite"; from?: string; to?: string; worksiteId?: string }) {
  const requestedPage = Number.isInteger(options.page) && options.page! > 0 ? Math.min(options.page!, 100_000) : 1
  const query = options.search?.trim().slice(0, 100)
  const pattern = query ? `%${query.replace(/[\\%_]/g, "\\$&")}%` : undefined
  const from = validPlainDate(options.from)
  const to = validPlainDate(options.to)
  const worksite = await resolveHistoricalWorksiteFilter(viewer, options.worksiteId)
  const where = and(
    historicalVisibility(viewer),
    options.vehicleId ? eq(mantHistoricalRecords.vehicleId, options.vehicleId) : undefined,
    options.pending === "equipment" ? isNull(mantHistoricalRecords.vehicleId) : undefined,
    options.pending === "conflict" ? eq(mantHistoricalRecords.equipmentMatch, "conflict") : undefined,
    options.pending === "worksite" ? isNull(mantHistoricalRecords.worksiteId) : undefined,
    from ? sql`${HISTORICAL_WORK_DATE} >= ${from}` : undefined,
    to ? sql`${HISTORICAL_WORK_DATE} <= ${to}` : undefined,
    worksite ? eq(mantHistoricalRecords.worksiteId, worksite.id) : undefined,
    pattern ? or(ilike(mantHistoricalRecords.equipmentText, pattern), ilike(mantHistoricalRecords.orderText, pattern), ilike(mantHistoricalRecords.description, pattern), ilike(mantHistoricalRecords.worksiteText, pattern), ilike(worksites.name, pattern)) : undefined,
  )
  const [count] = await db.select({ total: sql<number>`count(*)::int` }).from(mantHistoricalRecords).leftJoin(worksites, eq(worksites.id, mantHistoricalRecords.worksiteId)).where(where)
  const total = count?.total ?? 0
  const page = Math.min(requestedPage, Math.max(1, Math.ceil(total / PAGE_SIZE)))
  const rows = await db.select({
      sourceKey: mantHistoricalRecords.sourceKey, worksiteText: mantHistoricalRecords.worksiteText, equipmentText: mantHistoricalRecords.equipmentText,
      worksiteId: mantHistoricalRecords.worksiteId, worksiteName: worksites.name, vehicleId: mantHistoricalRecords.vehicleId, equipmentMatch: mantHistoricalRecords.equipmentMatch, orderText: mantHistoricalRecords.orderText,
      kindText: mantHistoricalRecords.kindText, description: mantHistoricalRecords.description, entryDate: mantHistoricalRecords.entryDate, submittedAt: mantHistoricalRecords.submittedAt,
      // Columnas que agrega el consolidado (Trinorma); vacías en las filas que sólo vienen del formulario.
      actionType: mantHistoricalRecords.actionType, laborHours: mantHistoricalRecords.laborHours, contractText: mantHistoricalRecords.contractText, isTest: mantHistoricalRecords.isTest, qualityNotes: mantHistoricalRecords.qualityNotes, hoursText: mantHistoricalRecords.hoursText,
    }).from(mantHistoricalRecords).leftJoin(worksites, eq(worksites.id, mantHistoricalRecords.worksiteId)).where(where)
      .orderBy(sql`${HISTORICAL_WORK_DATE} desc`, asc(mantHistoricalRecords.sourceKey))
      .limit(PAGE_SIZE).offset((page - 1) * PAGE_SIZE)
  return { rows, total, page, pageSize: PAGE_SIZE, applied: { from: from ?? null, to: to ?? null, worksite } }
}

/** Un trabajo del historial para mostrarlo: la fila original sale sin los campos ocultos (la cuenta de correo). */
export async function getHistoricalRecord(viewer: MantViewer, sourceKey: string) {
  if (!/^[a-f0-9]{64}$/.test(sourceKey)) return null
  const [found] = await db.select({ record: mantHistoricalRecords, worksiteName: worksites.name }).from(mantHistoricalRecords)
    .leftJoin(worksites, eq(worksites.id, mantHistoricalRecords.worksiteId))
    .where(and(eq(mantHistoricalRecords.sourceKey, sourceKey), historicalVisibility(viewer))).limit(1)
  return found ? { ...found.record, worksiteName: found.worksiteName, fields: visibleHistoricalFields(found.record.fields) } : null
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
  if (!/^[a-f0-9]{64}$/.test(sourceKey) || (!input.vehicleId && !input.worksiteId)) return { ok: false, message: "Elige un equipo o una faena para identificar." }
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('mant-historical-import'))`)
    const [current] = await tx.select().from(mantHistoricalRecords).where(eq(mantHistoricalRecords.sourceKey, sourceKey)).limit(1)
    if (!current) return { ok: false as const, message: "No se encontró el trabajo." }
    if ((input.vehicleId && current.vehicleId) || (input.worksiteId && current.worksiteId)) return { ok: false as const, message: "El equipo o la faena ya estaba identificado. Recarga la página para revisarlo." }
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
    return { ok: true as const, message: "Equipo y faena guardados." }
  })
}
