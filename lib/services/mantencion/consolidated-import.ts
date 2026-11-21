import { eq, inArray, sql } from "drizzle-orm"
import { db, type DB, type Tx } from "@/db"
import {
  fuelVehicles, mantHistoricalFindings, mantHistoricalInspections, mantHistoricalRecords, mantHistoricalScheduleChecks,
  worksiteAliases, worksites,
} from "@/db/schema"
import { recordAudit } from "@/lib/audit"
import { nanoid } from "@/lib/id"
import { equipmentCodeKey, matchVehicle, plateKey, type IdentifiedVehicle } from "@/lib/mantencion/equipment-identity"
import { nameKey } from "@/lib/mantencion/normalize"
import { getOperationalSettings } from "@/lib/services/system-settings"
import { todayInChile } from "@/lib/utils"
import type { MantActor } from "./equipment-history"
import {
  CONSOLIDATED_SHEETS, parseConsolidatedWorkbook,
  type ConsolidatedData, type ConsolidatedRejected,
} from "./consolidated-workbook"
import { resolveHistoricalEquipment, resolveHistoricalWorksite } from "./historical-workbook"
import type { MantActionResult } from "./result"

/**
 * Importador del consolidado de Chome (2026-11-21, Trinorma): MANTENCIONES →
 * `mant_historical_records`, INSPECCIONES → `mant_historical_inspections`,
 * HALLAZGOS_INSPECCION → `mant_historical_findings`, PAUTAS_PREVENTIVAS →
 * `mant_historical_schedule_checks`.
 *
 * Reglas que no se negocian (datos que no se pueden perder ni duplicar):
 * - Una sola transacción bajo `pg_advisory_xact_lock(hashtext('mant-historical-import'))`, el mismo
 *   lock del importador del formulario y de la conciliación manual.
 * - La identidad de cada fila es su `source_key` (ver `consolidated-workbook.ts`), no el ID que le puso
 *   el consolidado. Importar el mismo archivo dos veces no cambia nada.
 * - Una fila que ya existe (venga del archivo que venga) sólo se COMPLETA: columnas nuevas vacías y
 *   vínculos de equipo o faena vacíos. Nunca se tocan `fields`, `fingerprint`, el origen ni un vínculo
 *   hecho a mano; lo que no coincide se informa como diferencia y no aborta (es otra planilla, con
 *   otras columnas, de las mismas respuestas).
 * - Nada se descarta en silencio: cada fila rechazada, de prueba excluida o sin vincular queda en el informe.
 * - Sin `apply` la transacción se deshace: la simulación corre el mismo código y devuelve lo que
 *   `apply` haría.
 */

type Client = DB | Tx
type StoredRecord = Pick<typeof mantHistoricalRecords.$inferSelect, "sourceKey" | "vehicleId" | "worksiteId" | "equipmentMatch" | "entryDate" | "exitDate" | "sourceRecordId" | "originSource" | "actionType" | "laborHours" | "downtimeDays" | "specialties" | "contractText" | "qualityNotes" | "isTest">
type StoredInspection = Pick<typeof mantHistoricalInspections.$inferSelect, "sourceKey" | "vehicleId" | "worksiteId" | "equipmentMatch" | "inspectionDate" | "reading" | "goodCount" | "regularCount" | "badCount" | "missingCount" | "notApplicableCount">
type StoredSchedule = Pick<typeof mantHistoricalScheduleChecks.$inferSelect, "sourceKey" | "vehicleId" | "worksiteId" | "equipmentMatch" | "performedOn" | "compliance" | "doneCount" | "notDoneCount" | "isTest">
const BATCH_SIZE = 200
const LOCK = sql`select pg_advisory_xact_lock(hashtext('mant-historical-import'))`
export const IMPORT_ENTITY_TYPE = "mant_historical_import"

export interface SheetCounts {
  /** Filas leídas de la hoja, incluidas las que se rechazaron. */
  total: number
  created: number
  /** Ya existían y se les completó una columna nueva o un vínculo vacío. */
  completed: number
  unchanged: number
  /** Filas con al menos un dato distinto de lo ya cargado. Sólo se informan: no se cambian. */
  withDifference: number
  rejected: number
  /** Filas marcadas como prueba en el archivo. */
  test: number
  /** De ellas, las que no se importaron porque el parámetro de exclusión está activo. */
  testExcluded: number
  linked: number
  unmatched: number
  conflicts: number
  withoutWorksite: number
}

export interface NotImportedRow extends ConsolidatedRejected { kind: "rejected" | "test" }
export interface ReportRow { sheet: string; rowNumber: number; recordId: string | null; detail: string }
export interface CountedText { sheet: string; text: string; count: number }

export interface ConsolidatedReport {
  fileName: string
  /** `false` = simulación (la transacción se deshizo). */
  applied: boolean
  excludeTestRows: boolean
  sheets: Record<"maintenance" | "inspections" | "findings" | "scheduleChecks", SheetCounts>
  notImported: NotImportedRow[]
  differences: ReportRow[]
  conflicts: ReportRow[]
  /** Filas guardadas como conflicto de equipo que el consolidado resuelve a un solo equipo (se completó el vínculo vacío). */
  resolvedConflicts: ReportRow[]
  warnings: ReportRow[]
  withoutWorksite: CountedText[]
  unmatchedEquipment: CountedText[]
  /** Equipos del consolidado (hoja EQUIPOS) que no están en la flota. */
  fleetMissing: Array<{ code: string; plate: string; type: string }>
  plateDifferences: Array<{ code: string; filePlate: string; fleetPlate: string | null; detail: string }>
  quality: Array<{ source: string; problem: string; count: number | null }>
  notes: string[]
}

const emptyCounts = (): SheetCounts => ({ total: 0, created: 0, completed: 0, unchanged: 0, withDifference: 0, rejected: 0, test: 0, testExcluded: 0, linked: 0, unmatched: 0, conflicts: 0, withoutWorksite: 0 })

/* ── Ayudas ──────────────────────────────────────────────────────────────── */

type MatchState = "linked" | "unmatched" | "conflict"
interface Resolved { vehicleId: string | null; state: MatchState; reason?: string }

function resolveEquipment(code: string, plate: string, fallbackText: string, vehicles: readonly IdentifiedVehicle[]): Resolved {
  if (equipmentCodeKey(code)) return matchVehicle({ code, plate }, vehicles)
  if (plateKey(plate)) {
    const byPlate = matchVehicle({ plate }, vehicles)
    if (byPlate.state !== "unmatched") return byPlate
  }
  // Sin código: como el importador del formulario, con el texto original del equipo.
  if (fallbackText) {
    const legacy = resolveHistoricalEquipment(fallbackText, vehicles)
    if (legacy.state !== "unmatched") return { ...legacy, reason: legacy.state === "conflict" ? "El texto del equipo requiere revisión." : undefined }
  }
  return { vehicleId: null, state: "unmatched" }
}

const sameNumber = (a: number, b: number) => Math.abs(a - b) < 1e-6
const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((value, index) => value === b[index])
const batches = <T>(items: readonly T[]) => Array.from({ length: Math.ceil(items.length / BATCH_SIZE) }, (_, i) => items.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE))

interface Context {
  fileName: string
  vehicles: IdentifiedVehicle[]
  sites: Array<{ id: string; name: string }>
  aliases: Array<{ worksiteId: string; aliasKey: string }>
  excludeTests: boolean
  notEquipment: Set<string>
  userId: string
  notImported: NotImportedRow[]
  differences: ReportRow[]
  conflicts: ReportRow[]
  resolvedConflicts: ReportRow[]
  warnings: ReportRow[]
  withoutWorksite: Map<string, CountedText>
  unmatched: Map<string, CountedText>
}

function tally(map: Map<string, CountedText>, sheet: string, text: string) {
  const key = `${sheet}\n${text}`
  const entry = map.get(key)
  if (entry) entry.count++
  else map.set(key, { sheet, text, count: 1 })
}

/** Aplica el estado final de una fila a los conteos de su hoja. */
function tallyLinks(counts: SheetCounts, ctx: Context, sheet: string, row: { rowNumber: number }, recordId: string | null, link: { vehicleId: string | null; state: MatchState; reason?: string }, worksiteId: string | null, ids: { code: string; plate: string }, worksiteText: string) {
  if (link.vehicleId) counts.linked++
  else if (link.state === "conflict") {
    counts.conflicts++
    ctx.conflicts.push({ sheet, rowNumber: row.rowNumber, recordId, detail: `${[ids.code, ids.plate].filter(Boolean).join(" / ") || "sin código ni patente"}: ${(link.reason ?? "el código y la patente no coinciden con un solo equipo").replace(/\.$/, "")}.` })
  } else {
    counts.unmatched++
    tally(ctx.unmatched, sheet, ids.code || ids.plate || "(sin código ni patente)")
  }
  if (!worksiteId) {
    counts.withoutWorksite++
    tally(ctx.withoutWorksite, sheet, worksiteText || "(vacía)")
  }
}

/** Completa un vínculo de equipo vacío; si la fila estaba en conflicto y el archivo lo resuelve, queda dicho en el informe. */
function noteResolvedConflict(ctx: Context, sheet: string, rowNumber: number, recordId: string | null, current: { vehicleId: string | null; equipmentMatch: string }, match: { vehicleId: string | null }) {
  if (!current.vehicleId && match.vehicleId && current.equipmentMatch === "conflict") {
    ctx.resolvedConflicts.push({ sheet, rowNumber, recordId, detail: "estaba guardada como conflicto de código y patente; el consolidado la resuelve a un solo equipo y se completó el vínculo" })
  }
}

function addDifference(ctx: Context, sheet: string, rowNumber: number, recordId: string | null, differences: string[], counts: SheetCounts) {
  if (!differences.length) return
  counts.withDifference++
  ctx.differences.push({ sheet, rowNumber, recordId, detail: differences.join("; ") })
}

/* ── MANTENCIONES ────────────────────────────────────────────────────────── */

async function importMaintenance(tx: Client, ctx: Context, data: ConsolidatedData, parserRejected: number): Promise<{ counts: SheetCounts; write: () => Promise<void> }> {
  const sheet = CONSOLIDATED_SHEETS.maintenance
  const counts = emptyCounts()
  counts.total = data.maintenance.length + parserRejected
  counts.rejected = parserRejected
  const stored = new Map<string, StoredRecord>()
  const columns = {
    sourceKey: mantHistoricalRecords.sourceKey, vehicleId: mantHistoricalRecords.vehicleId, worksiteId: mantHistoricalRecords.worksiteId,
    equipmentMatch: mantHistoricalRecords.equipmentMatch, entryDate: mantHistoricalRecords.entryDate, exitDate: mantHistoricalRecords.exitDate,
    sourceRecordId: mantHistoricalRecords.sourceRecordId, originSource: mantHistoricalRecords.originSource, actionType: mantHistoricalRecords.actionType,
    laborHours: mantHistoricalRecords.laborHours, downtimeDays: mantHistoricalRecords.downtimeDays, specialties: mantHistoricalRecords.specialties,
    contractText: mantHistoricalRecords.contractText, qualityNotes: mantHistoricalRecords.qualityNotes, isTest: mantHistoricalRecords.isTest,
  }
  for (const batch of batches(data.maintenance)) {
    const found = await tx.select(columns).from(mantHistoricalRecords).where(inArray(mantHistoricalRecords.sourceKey, batch.map((row) => row.sourceKey)))
    for (const record of found) stored.set(record.sourceKey, record)
  }
  const inserts: Array<typeof mantHistoricalRecords.$inferInsert> = []
  const updates: Array<{ sourceKey: string; set: Partial<typeof mantHistoricalRecords.$inferInsert> }> = []

  for (const row of data.maintenance) {
    const recordId = row.sourceRecordId
    if (row.isTest) counts.test++
    for (const warning of row.warnings) ctx.warnings.push({ sheet, rowNumber: row.rowNumber, recordId, detail: warning })
    const current = stored.get(row.sourceKey)

    if (!current) {
      // Lo que no es un equipo (persona, lugar, genérico) no entra: se rechaza con su motivo, sin copiar el texto.
      if ([row.code, row.originalEquipment].some((value) => value && ctx.notEquipment.has(nameKey(value)))) {
        counts.rejected++
        ctx.notImported.push({ sheet, rowNumber: row.rowNumber, recordId, reason: "No es un equipo (persona, lugar o texto genérico, según la hoja EQUIPOS).", kind: "rejected" })
        continue
      }
      if (row.isTest && ctx.excludeTests) {
        counts.testExcluded++
        ctx.notImported.push({ sheet, rowNumber: row.rowNumber, recordId, reason: "Posible prueba: no se importó porque «Excluir filas de prueba» está activo en los parámetros de Mantención.", kind: "test" })
        continue
      }
    }

    const match = resolveEquipment(row.code, row.plate, row.originalEquipment, ctx.vehicles)
    const worksiteId = resolveHistoricalWorksite(row.worksiteText, ctx.sites, ctx.aliases)

    if (!current) {
      counts.created++
      tallyLinks(counts, ctx, sheet, row, recordId, match, worksiteId, row, row.worksiteText)
      inserts.push({
        sourceKey: row.sourceKey, fingerprint: row.fingerprint, sourceFile: ctx.fileName, sourceSheet: row.sheet, sourceRow: row.rowNumber,
        submittedAt: row.submittedAt, worksiteText: row.worksiteText, worksiteId, equipmentText: row.equipmentText,
        vehicleId: match.vehicleId, equipmentMatch: match.state, orderText: row.orderText, kindText: row.kindText, readingText: row.readingText,
        description: row.description, entryDate: row.entryDate, exitDate: row.exitDate, hoursText: row.hoursText, fields: row.fields, importedBy: ctx.userId,
        sourceRecordId: row.sourceRecordId, originSource: row.originSource, actionType: row.actionType, laborHours: row.laborHours,
        downtimeDays: row.downtimeDays, specialties: row.specialties, contractText: row.contractText, qualityNotes: row.qualityNotes, isTest: row.isTest,
      })
      continue
    }

    // Ya existe: sólo se completa. Lo que no coincide se informa.
    const set: Partial<typeof mantHistoricalRecords.$inferInsert> = {}
    const differences: string[] = []
    const fill = <T,>(key: keyof StoredRecord, label: string, value: T | null, incoming: T | null, same: (a: T, b: T) => boolean, show: (v: T) => string) => {
      if (incoming === null || incoming === undefined) return
      if (value === null || value === undefined) (set as Record<string, unknown>)[key] = incoming
      else if (!same(value, incoming)) differences.push(`${label}: guardado ${show(value)}, el archivo trae ${show(incoming)}`)
    }
    const eq = <T,>(a: T, b: T) => a === b
    const text = (value: unknown) => String(value)
    const other = () => "otro valor"
    fill("sourceRecordId", "ID de registro", current.sourceRecordId, row.sourceRecordId, eq, text)
    fill("originSource", "fuente", current.originSource, row.originSource, eq, other)
    fill("actionType", "tipo de acción", current.actionType, row.actionType, eq, text)
    fill("laborHours", "horas", current.laborHours, row.laborHours, sameNumber, text)
    fill("downtimeDays", "días detenido", current.downtimeDays, row.downtimeDays, sameNumber, text)
    fill("specialties", "especialidades", current.specialties, row.specialties, (a, b) => sameList(a, b), (value) => value.join(", "))
    fill("contractText", "contrato", current.contractText, row.contractText, eq, other)
    fill("qualityNotes", "observaciones de calidad", current.qualityNotes, row.qualityNotes, eq, other)
    if (row.isTest && !current.isTest) set.isTest = true
    else if (!row.isTest && current.isTest) differences.push("posible prueba: guardada como prueba, el archivo no la marca")
    // Fechas de ingreso y salida: columnas de origen; no se corrigen, pero el consolidado trae años corregidos y conviene saberlo.
    for (const [label, stored, incoming] of [["fecha de ingreso", current.entryDate, row.entryDate], ["fecha de salida", current.exitDate, row.exitDate]] as const) {
      if (incoming && stored !== incoming) differences.push(`${label}: guardada ${stored ?? "vacía"}, el archivo trae ${incoming}`)
    }

    let vehicleId = current.vehicleId
    const equipmentMatch = current.equipmentMatch
    noteResolvedConflict(ctx, sheet, row.rowNumber, recordId, current, match)
    if (!current.vehicleId && match.vehicleId) { set.vehicleId = match.vehicleId; set.equipmentMatch = "linked"; vehicleId = match.vehicleId }
    else if (current.vehicleId && match.vehicleId && current.vehicleId !== match.vehicleId) differences.push("equipo: el vínculo guardado es otro equipo que el que resuelve el archivo (se conserva el guardado)")
    let finalWorksite = current.worksiteId
    if (!current.worksiteId && worksiteId) { set.worksiteId = worksiteId; finalWorksite = worksiteId }
    else if (current.worksiteId && worksiteId && current.worksiteId !== worksiteId) differences.push("faena: el vínculo guardado es otra faena que la que resuelve el archivo (se conserva la guardada)")

    tallyLinks(counts, ctx, sheet, row, recordId, { vehicleId, state: vehicleId ? "linked" : equipmentMatch === "conflict" ? "conflict" : "unmatched", reason: match.reason }, finalWorksite, row, row.worksiteText)
    addDifference(ctx, sheet, row.rowNumber, recordId, differences, counts)
    if (Object.keys(set).length) { counts.completed++; updates.push({ sourceKey: row.sourceKey, set }) } else counts.unchanged++
  }

  return {
    counts,
    write: async () => {
      for (const batch of batches(inserts)) await tx.insert(mantHistoricalRecords).values(batch)
      for (const { sourceKey, set } of updates) await tx.update(mantHistoricalRecords).set(set).where(eq(mantHistoricalRecords.sourceKey, sourceKey))
    },
  }
}

/* ── INSPECCIONES y HALLAZGOS ────────────────────────────────────────────── */

async function importInspections(tx: Client, ctx: Context, data: ConsolidatedData, parserRejected: number) {
  const sheet = CONSOLIDATED_SHEETS.inspections
  const counts = emptyCounts()
  counts.total = data.inspections.length + parserRejected
  counts.rejected = parserRejected
  const columns = {
    sourceKey: mantHistoricalInspections.sourceKey, vehicleId: mantHistoricalInspections.vehicleId, worksiteId: mantHistoricalInspections.worksiteId,
    equipmentMatch: mantHistoricalInspections.equipmentMatch, inspectionDate: mantHistoricalInspections.inspectionDate, reading: mantHistoricalInspections.reading,
    goodCount: mantHistoricalInspections.goodCount, regularCount: mantHistoricalInspections.regularCount, badCount: mantHistoricalInspections.badCount,
    missingCount: mantHistoricalInspections.missingCount, notApplicableCount: mantHistoricalInspections.notApplicableCount,
  }
  const stored = new Map<string, StoredInspection>()
  for (const batch of batches(data.inspections)) {
    for (const record of await tx.select(columns).from(mantHistoricalInspections).where(inArray(mantHistoricalInspections.sourceKey, batch.map((row) => row.sourceKey)))) stored.set(record.sourceKey, record)
  }
  const inserts: Array<typeof mantHistoricalInspections.$inferInsert> = []
  const updates: Array<{ sourceKey: string; set: Partial<typeof mantHistoricalInspections.$inferInsert> }> = []
  for (const row of data.inspections) {
    const recordId = row.sourceRecordId
    for (const warning of row.warnings) ctx.warnings.push({ sheet, rowNumber: row.rowNumber, recordId, detail: warning })
    if (row.keyCollision) ctx.warnings.push({ sheet, rowNumber: row.rowNumber, recordId, detail: "Otra fila tiene la misma marca temporal, formulario, unidad y patente: se le agregó un número de orden a la clave." })
    const match = resolveEquipment(row.code, row.plate, "", ctx.vehicles)
    const worksiteId = resolveHistoricalWorksite(row.worksiteText, ctx.sites, ctx.aliases)
    const current = stored.get(row.sourceKey)
    if (!current) {
      counts.created++
      tallyLinks(counts, ctx, sheet, row, recordId, match, worksiteId, row, row.worksiteText)
      inserts.push({
        sourceKey: row.sourceKey, fingerprint: row.fingerprint, sourceFile: ctx.fileName, sourceSheet: row.sheet, sourceRow: row.rowNumber,
        sourceRecordId: row.sourceRecordId, submittedAt: row.submittedAt, inspectionDate: row.inspectionDate, formKind: row.formKind, unitKind: row.unitKind,
        equipmentText: row.equipmentText, vehicleId: match.vehicleId, equipmentMatch: match.state, worksiteText: row.worksiteText, worksiteId,
        reading: row.reading, goodCount: row.goodCount, regularCount: row.regularCount, badCount: row.badCount, missingCount: row.missingCount,
        notApplicableCount: row.notApplicableCount, fields: row.fields, importedBy: ctx.userId,
      })
      continue
    }
    const set: Partial<typeof mantHistoricalInspections.$inferInsert> = {}
    const differences: string[] = []
    const compare = (label: string, stored: number | string | null, incoming: number | string | null) => {
      if (incoming === null || stored === null) return
      if (typeof stored === "number" && typeof incoming === "number" ? !sameNumber(stored, incoming) : stored !== incoming) differences.push(`${label}: guardado ${stored}, el archivo trae ${incoming}`)
    }
    compare("día inspeccionado", current.inspectionDate, row.inspectionDate)
    compare("kilometraje", current.reading, row.reading)
    compare("ítems en buen estado", current.goodCount, row.goodCount)
    compare("ítems regulares", current.regularCount, row.regularCount)
    compare("ítems en mal estado", current.badCount, row.badCount)
    compare("ítems que no tiene", current.missingCount, row.missingCount)
    compare("ítems que no aplican", current.notApplicableCount, row.notApplicableCount)
    let vehicleId = current.vehicleId
    noteResolvedConflict(ctx, sheet, row.rowNumber, recordId, current, match)
    if (!current.vehicleId && match.vehicleId) { set.vehicleId = match.vehicleId; set.equipmentMatch = "linked"; vehicleId = match.vehicleId }
    else if (current.vehicleId && match.vehicleId && current.vehicleId !== match.vehicleId) differences.push("equipo: el vínculo guardado es otro equipo que el que resuelve el archivo (se conserva el guardado)")
    let finalWorksite = current.worksiteId
    if (!current.worksiteId && worksiteId) { set.worksiteId = worksiteId; finalWorksite = worksiteId }
    else if (current.worksiteId && worksiteId && current.worksiteId !== worksiteId) differences.push("faena: el vínculo guardado es otra faena que la que resuelve el archivo (se conserva la guardada)")
    tallyLinks(counts, ctx, sheet, row, recordId, { vehicleId, state: vehicleId ? "linked" : current.equipmentMatch === "conflict" ? "conflict" : "unmatched", reason: match.reason }, finalWorksite, row, row.worksiteText)
    addDifference(ctx, sheet, row.rowNumber, recordId, differences, counts)
    if (Object.keys(set).length) { counts.completed++; updates.push({ sourceKey: row.sourceKey, set }) } else counts.unchanged++
  }
  return {
    counts,
    write: async () => {
      for (const batch of batches(inserts)) await tx.insert(mantHistoricalInspections).values(batch)
      for (const { sourceKey, set } of updates) await tx.update(mantHistoricalInspections).set(set).where(eq(mantHistoricalInspections.sourceKey, sourceKey))
    },
  }
}

async function importFindings(tx: Client, ctx: Context, data: ConsolidatedData, parserRejected: number) {
  const sheet = CONSOLIDATED_SHEETS.findings
  const counts = emptyCounts()
  counts.total = data.findings.length + parserRejected
  counts.rejected = parserRejected
  const stored = new Map<string, { sourceKey: string; inspectionSourceKey: string; foundOn: string; condition: string }>()
  for (const batch of batches(data.findings)) {
    for (const record of await tx.select({ sourceKey: mantHistoricalFindings.sourceKey, inspectionSourceKey: mantHistoricalFindings.inspectionSourceKey, foundOn: mantHistoricalFindings.foundOn, condition: mantHistoricalFindings.condition })
      .from(mantHistoricalFindings).where(inArray(mantHistoricalFindings.sourceKey, batch.map((row) => row.sourceKey)))) stored.set(record.sourceKey, record)
  }
  const inserts: Array<typeof mantHistoricalFindings.$inferInsert> = []
  for (const row of data.findings) {
    if (row.keyCollision) ctx.warnings.push({ sheet, rowNumber: row.rowNumber, recordId: null, detail: "El ítem se repite en la misma inspección: se agregó la fila con un número de orden." })
    const current = stored.get(row.sourceKey)
    if (!current) {
      counts.created++
      inserts.push({ sourceKey: row.sourceKey, inspectionSourceKey: row.inspectionSourceKey, sourceRow: row.rowNumber, foundOn: row.foundOn, section: row.section, item: row.item, condition: row.condition })
      continue
    }
    const differences: string[] = []
    if (current.condition !== row.condition) differences.push(`estado: guardado ${current.condition}, el archivo trae ${row.condition}`)
    if (current.foundOn !== row.foundOn) differences.push(`día: guardado ${current.foundOn}, el archivo trae ${row.foundOn}`)
    if (current.inspectionSourceKey !== row.inspectionSourceKey) differences.push("inspección: la fila guardada pertenece a otra inspección")
    addDifference(ctx, sheet, row.rowNumber, null, differences, counts)
    counts.unchanged++
  }
  return { counts, write: async () => { for (const batch of batches(inserts)) await tx.insert(mantHistoricalFindings).values(batch) } }
}

/* ── PAUTAS_PREVENTIVAS ──────────────────────────────────────────────────── */

async function importScheduleChecks(tx: Client, ctx: Context, data: ConsolidatedData, parserRejected: number) {
  const sheet = CONSOLIDATED_SHEETS.scheduleChecks
  const counts = emptyCounts()
  counts.total = data.scheduleChecks.length + parserRejected
  counts.rejected = parserRejected
  const columns = {
    sourceKey: mantHistoricalScheduleChecks.sourceKey, vehicleId: mantHistoricalScheduleChecks.vehicleId, worksiteId: mantHistoricalScheduleChecks.worksiteId,
    equipmentMatch: mantHistoricalScheduleChecks.equipmentMatch, performedOn: mantHistoricalScheduleChecks.performedOn, compliance: mantHistoricalScheduleChecks.compliance,
    doneCount: mantHistoricalScheduleChecks.doneCount, notDoneCount: mantHistoricalScheduleChecks.notDoneCount, isTest: mantHistoricalScheduleChecks.isTest,
  }
  const stored = new Map<string, StoredSchedule>()
  for (const batch of batches(data.scheduleChecks)) {
    for (const record of await tx.select(columns).from(mantHistoricalScheduleChecks).where(inArray(mantHistoricalScheduleChecks.sourceKey, batch.map((row) => row.sourceKey)))) stored.set(record.sourceKey, record)
  }
  const inserts: Array<typeof mantHistoricalScheduleChecks.$inferInsert> = []
  const updates: Array<{ sourceKey: string; set: Partial<typeof mantHistoricalScheduleChecks.$inferInsert> }> = []
  for (const row of data.scheduleChecks) {
    for (const warning of row.warnings) ctx.warnings.push({ sheet, rowNumber: row.rowNumber, recordId: null, detail: warning })
    if (row.keyCollision) ctx.warnings.push({ sheet, rowNumber: row.rowNumber, recordId: null, detail: "Otra pauta tiene la misma marca temporal, patente y pauta: se le agregó un número de orden a la clave." })
    const current = stored.get(row.sourceKey)
    if (row.isTest) counts.test++
    if (!current && row.isTest && ctx.excludeTests) {
      counts.testExcluded++
      ctx.notImported.push({ sheet, rowNumber: row.rowNumber, recordId: null, reason: "Pauta de prueba (ES_PRUEBA): no se importó porque «Excluir filas de prueba» está activo en los parámetros de Mantención.", kind: "test" })
      continue
    }
    const match = resolveEquipment(row.code, row.plate, "", ctx.vehicles)
    const worksiteId = resolveHistoricalWorksite(row.worksiteText, ctx.sites, ctx.aliases)
    if (!current) {
      counts.created++
      tallyLinks(counts, ctx, sheet, row, null, match, worksiteId, row, row.worksiteText)
      inserts.push({
        sourceKey: row.sourceKey, fingerprint: row.fingerprint, sourceFile: ctx.fileName, sourceSheet: row.sheet, sourceRow: row.rowNumber,
        submittedAt: row.submittedAt, performedOn: row.performedOn, formKind: row.formKind, scheduleLabel: row.scheduleLabel, equipmentText: row.equipmentText,
        vehicleId: match.vehicleId, equipmentMatch: match.state, worksiteText: row.worksiteText, worksiteId, reading: row.reading,
        doneCount: row.doneCount, notDoneCount: row.notDoneCount, notApplicableCount: row.notApplicableCount, compliance: row.compliance,
        isTest: row.isTest, fields: row.fields, importedBy: ctx.userId,
      })
      continue
    }
    const set: Partial<typeof mantHistoricalScheduleChecks.$inferInsert> = {}
    const differences: string[] = []
    if (current.compliance !== null && row.compliance !== null && !sameNumber(current.compliance, row.compliance)) differences.push(`cumplimiento: guardado ${current.compliance}, el archivo trae ${row.compliance}`)
    if (current.doneCount !== row.doneCount) differences.push(`ítems realizados: guardado ${current.doneCount}, el archivo trae ${row.doneCount}`)
    if (current.notDoneCount !== row.notDoneCount) differences.push(`ítems no realizados: guardado ${current.notDoneCount}, el archivo trae ${row.notDoneCount}`)
    if (current.isTest !== row.isTest) differences.push(`prueba: guardada como ${current.isTest ? "prueba" : "pauta real"}, el archivo la trae como ${row.isTest ? "prueba" : "pauta real"}`)
    if (current.performedOn && row.performedOn && current.performedOn !== row.performedOn) differences.push(`fecha de la pauta: guardada ${current.performedOn}, el archivo trae ${row.performedOn}`)
    let vehicleId = current.vehicleId
    noteResolvedConflict(ctx, sheet, row.rowNumber, null, current, match)
    if (!current.vehicleId && match.vehicleId) { set.vehicleId = match.vehicleId; set.equipmentMatch = "linked"; vehicleId = match.vehicleId }
    else if (current.vehicleId && match.vehicleId && current.vehicleId !== match.vehicleId) differences.push("equipo: el vínculo guardado es otro equipo que el que resuelve el archivo (se conserva el guardado)")
    let finalWorksite = current.worksiteId
    if (!current.worksiteId && worksiteId) { set.worksiteId = worksiteId; finalWorksite = worksiteId }
    else if (current.worksiteId && worksiteId && current.worksiteId !== worksiteId) differences.push("faena: el vínculo guardado es otra faena que la que resuelve el archivo (se conserva la guardada)")
    tallyLinks(counts, ctx, sheet, row, null, { vehicleId, state: vehicleId ? "linked" : current.equipmentMatch === "conflict" ? "conflict" : "unmatched", reason: match.reason }, finalWorksite, row, row.worksiteText)
    addDifference(ctx, sheet, row.rowNumber, null, differences, counts)
    if (Object.keys(set).length) { counts.completed++; updates.push({ sourceKey: row.sourceKey, set }) } else counts.unchanged++
  }
  return {
    counts,
    write: async () => {
      for (const batch of batches(inserts)) await tx.insert(mantHistoricalScheduleChecks).values(batch)
      for (const { sourceKey, set } of updates) await tx.update(mantHistoricalScheduleChecks).set(set).where(eq(mantHistoricalScheduleChecks.sourceKey, sourceKey))
    },
  }
}

/* ── Orquestación ────────────────────────────────────────────────────────── */

class SimulationRollback extends Error {
  constructor(readonly report: ConsolidatedReport) { super("simulación: transacción deshecha") }
}

const sourceFileName = (fileName: string) => fileName.split(/[\\/]/).pop()?.slice(0, 150) || "consolidado.xlsx"

/** Equipos del consolidado que no están en la flota y patentes que no coinciden. Sólo se informa: la flota no se toca. */
function compareFleet(data: ConsolidatedData, vehicles: Array<IdentifiedVehicle>) {
  const fleetMissing: ConsolidatedReport["fleetMissing"] = []
  const plateDifferences: ConsolidatedReport["plateDifferences"] = []
  const byId = new Map(vehicles.map((vehicle) => [vehicle.id, vehicle]))
  for (const row of data.equipment) {
    if (row.notEquipment || (!row.code && !row.plate)) continue
    const match = matchVehicle({ code: row.code, plate: row.plate }, vehicles)
    if (match.state === "unmatched") fleetMissing.push({ code: row.code, plate: row.plate, type: row.type })
    else if (match.state === "conflict") plateDifferences.push({ code: row.code, filePlate: row.plate, fleetPlate: null, detail: match.reason })
    else {
      const vehicle = byId.get(match.vehicleId)
      if (vehicle && plateKey(row.plate) && plateKey(vehicle.plate) && plateKey(row.plate) !== plateKey(vehicle.plate)) {
        plateDifferences.push({ code: row.code, filePlate: row.plate, fleetPlate: vehicle.plate, detail: "La patente del consolidado no es la de la flota." })
      }
    }
  }
  return { fleetMissing, plateDifferences }
}

export interface ConsolidatedImportOptions {
  /** Sin `apply` la transacción se deshace y el informe dice lo que se habría hecho. */
  apply: boolean
  /** Fuerza el parámetro `mantencionExcludeTestRows`; por defecto se lee de la configuración. */
  excludeTestRows?: boolean
}

/**
 * Importa el consolidado. Devuelve el informe; con `apply: false` no deja nada escrito. Un archivo que
 * no es el consolidado (hoja o columna obligatoria ausente) aborta antes de abrir la transacción.
 */
export async function importConsolidated(
  actor: MantActor,
  buffer: ArrayBuffer | Uint8Array,
  fileName: string,
  options: ConsolidatedImportOptions,
): Promise<MantActionResult<ConsolidatedReport>> {
  const parsed = await parseConsolidatedWorkbook(buffer)
  if (!parsed.ok) return parsed
  const data = parsed.data
  const file = sourceFileName(fileName)
  const rejectedIn = (sheet: string) => data.rejected.filter((row) => row.sheet === sheet).length
  try {
    const report = await db.transaction(async (tx) => {
      await tx.execute(LOCK)
      const [vehicles, sites, aliases, settings] = await Promise.all([
        tx.select({ id: fuelVehicles.id, code: fuelVehicles.code, plate: fuelVehicles.plate }).from(fuelVehicles),
        tx.select({ id: worksites.id, name: worksites.name }).from(worksites),
        tx.select({ worksiteId: worksiteAliases.worksiteId, aliasKey: worksiteAliases.aliasKey }).from(worksiteAliases),
        getOperationalSettings(tx),
      ])
      const excludeTests = options.excludeTestRows ?? settings.mantencionExcludeTestRows === 1
      const ctx: Context = {
        fileName: file, vehicles, sites, aliases, excludeTests, userId: actor.userId,
        notEquipment: new Set(data.equipment.filter((row) => row.notEquipment && row.code).map((row) => nameKey(row.code))),
        notImported: data.rejected.map((row) => ({ ...row, kind: "rejected" as const })),
        differences: [], conflicts: [], resolvedConflicts: [], warnings: [], withoutWorksite: new Map(), unmatched: new Map(),
      }
      // Las inspecciones van antes que sus hallazgos (clave foránea).
      const maintenance = await importMaintenance(tx, ctx, data, rejectedIn(CONSOLIDATED_SHEETS.maintenance))
      const inspections = await importInspections(tx, ctx, data, rejectedIn(CONSOLIDATED_SHEETS.inspections))
      const findings = await importFindings(tx, ctx, data, rejectedIn(CONSOLIDATED_SHEETS.findings))
      const scheduleChecks = await importScheduleChecks(tx, ctx, data, rejectedIn(CONSOLIDATED_SHEETS.scheduleChecks))
      await maintenance.write()
      await inspections.write()
      await findings.write()
      await scheduleChecks.write()

      const sheetCounts = { maintenance: maintenance.counts, inspections: inspections.counts, findings: findings.counts, scheduleChecks: scheduleChecks.counts }
      const changed = Object.values(sheetCounts).some((counts) => counts.created || counts.completed)
      const fleet = compareFleet(data, vehicles)
      const result: ConsolidatedReport = {
        fileName: file, applied: options.apply, excludeTestRows: excludeTests, sheets: sheetCounts,
        notImported: ctx.notImported, differences: ctx.differences, conflicts: ctx.conflicts, resolvedConflicts: ctx.resolvedConflicts, warnings: ctx.warnings,
        withoutWorksite: [...ctx.withoutWorksite.values()].sort((a, b) => b.count - a.count || a.text.localeCompare(b.text)),
        unmatchedEquipment: [...ctx.unmatched.values()].sort((a, b) => b.count - a.count || a.text.localeCompare(b.text)),
        fleetMissing: fleet.fleetMissing, plateDifferences: fleet.plateDifferences, quality: data.quality, notes: data.notes,
      }
      if (changed) {
        await recordAudit({
          userId: actor.userId, userEmail: actor.email ?? undefined, action: "create", entityType: IMPORT_ENTITY_TYPE, entityId: nanoid(),
          newState: { source: "consolidado", fileName: file, simulation: !options.apply, sheets: sheetCounts },
        }, tx)
      }
      if (!options.apply) throw new SimulationRollback(result)
      return result
    })
    return { ok: true, data: report }
  } catch (error) {
    if (error instanceof SimulationRollback) return { ok: true, data: error.report }
    throw error
  }
}

/* ── Informe ─────────────────────────────────────────────────────────────── */

const SHEET_LABELS: Record<keyof ConsolidatedReport["sheets"], string> = {
  maintenance: CONSOLIDATED_SHEETS.maintenance, inspections: CONSOLIDATED_SHEETS.inspections,
  findings: CONSOLIDATED_SHEETS.findings, scheduleChecks: CONSOLIDATED_SHEETS.scheduleChecks,
}
const LIST_LIMIT = 200
const cell = (value: string | number | null) => String(value ?? "").replace(/\|/g, "/").replace(/\s+/g, " ").trim()

function list(lines: string[], rows: string[], empty: string): void {
  if (!rows.length) { lines.push(empty, ""); return }
  lines.push(...rows.slice(0, LIST_LIMIT).map((row) => `- ${row}`))
  if (rows.length > LIST_LIMIT) lines.push(`- … y ${rows.length - LIST_LIMIT} más (${rows.length} en total).`)
  lines.push("")
}

/** Informe en Markdown. Sin correos ni nombres de personas: sólo hojas, filas, IDs del consolidado, códigos y patentes. */
export function formatConsolidatedReport(report: ConsolidatedReport): string {
  const lines: string[] = []
  lines.push(`# Informe de importación del consolidado`, "")
  lines.push(`- Archivo: ${cell(report.fileName)}`)
  lines.push(`- Modo: ${report.applied ? "**aplicado** (los cambios quedaron guardados)" : "**simulación** (no se guardó nada: la transacción se deshizo)"}`)
  lines.push(`- Fecha del informe: ${todayInChile()}`)
  lines.push(`- Filas de prueba: ${report.excludeTestRows ? "se excluyen (parámetro activo)" : "se importan marcadas como prueba"}`, "")

  lines.push("## Conteos por hoja", "")
  lines.push("| Hoja | Filas | Nuevas | Completadas | Sin cambios | Con diferencia | Rechazadas | De prueba | Prueba excluida |")
  lines.push("|---|---:|---:|---:|---:|---:|---:|---:|---:|")
  for (const key of Object.keys(SHEET_LABELS) as Array<keyof typeof SHEET_LABELS>) {
    const c = report.sheets[key]
    lines.push(`| ${SHEET_LABELS[key]} | ${c.total} | ${c.created} | ${c.completed} | ${c.unchanged} | ${c.withDifference} | ${c.rejected} | ${c.test} | ${c.testExcluded} |`)
  }
  lines.push("", "«Completadas» son filas que ya existían y recibieron una columna nueva o un vínculo vacío; «Con diferencia» se informan abajo y no se cambian.", "")

  lines.push("## Equipo y faena", "")
  lines.push("| Hoja | Con equipo vinculado | Sin equipo | Código y patente en conflicto | Sin faena |")
  lines.push("|---|---:|---:|---:|---:|")
  for (const key of ["maintenance", "inspections", "scheduleChecks"] as const) {
    const c = report.sheets[key]
    lines.push(`| ${SHEET_LABELS[key]} | ${c.linked} | ${c.unmatched} | ${c.conflicts} | ${c.withoutWorksite} |`)
  }
  lines.push("")

  lines.push("## Sin faena, por texto de origen", "")
  list(lines, report.withoutWorksite.map((row) => `${row.sheet}: «${cell(row.text)}» (${row.count})`), "Todas las filas resolvieron su faena.")
  lines.push("## Sin equipo, por código o patente", "")
  list(lines, report.unmatchedEquipment.map((row) => `${row.sheet}: ${cell(row.text)} (${row.count})`), "Todas las filas resolvieron su equipo o están en conflicto.")
  lines.push("## Código y patente en conflicto", "")
  list(lines, report.conflicts.map((row) => `${row.sheet}, fila ${row.rowNumber}${row.recordId ? ` (${row.recordId})` : ""}: ${cell(row.detail)}`), "Ninguna fila en conflicto.")

  lines.push(`## Conflictos resueltos por el consolidado (${report.resolvedConflicts.length})`, "")
  list(lines, report.resolvedConflicts.map((row) => `${row.sheet}, fila ${row.rowNumber}${row.recordId ? ` (${row.recordId})` : ""}: ${cell(row.detail)}`), "Ninguna.")

  lines.push("## Equipos del consolidado que no están en la flota", "")
  list(lines, report.fleetMissing.map((row) => `${cell(row.code) || "sin código"} · ${row.plate ? `patente ${cell(row.plate)}` : "sin patente"}${row.type ? ` · ${cell(row.type)}` : ""}`), "Todos los equipos del consolidado están en la flota.")
  lines.push("## Diferencias de patente", "")
  list(lines, report.plateDifferences.map((row) => `${cell(row.code)}: consolidado ${cell(row.filePlate) || "sin patente"}${row.fleetPlate ? `, flota ${cell(row.fleetPlate)}` : ""} (${cell(row.detail)})`), "Ninguna diferencia de patente.")

  const rejected = report.notImported.filter((row) => row.kind === "rejected")
  const tests = report.notImported.filter((row) => row.kind === "test")
  lines.push(`## Filas rechazadas (${rejected.length})`, "")
  list(lines, rejected.map((row) => `${row.sheet}, fila ${row.rowNumber}${row.recordId ? ` (${row.recordId})` : ""}: ${cell(row.reason)}`), "Ninguna fila rechazada.")
  lines.push(`## Filas de prueba que no se importaron (${tests.length})`, "")
  list(lines, tests.map((row) => `${row.sheet}, fila ${row.rowNumber}${row.recordId ? ` (${row.recordId})` : ""}: ${cell(row.reason)}`), "Ninguna.")

  lines.push(`## Filas con diferencias respecto de lo ya cargado (${report.differences.length})`, "")
  list(lines, report.differences.map((row) => `${row.sheet}, fila ${row.rowNumber}${row.recordId ? ` (${row.recordId})` : ""}: ${cell(row.detail)}`), "Ninguna: lo que ya estaba cargado coincide con el archivo.")
  lines.push(`## Avisos de lectura (${report.warnings.length})`, "")
  list(lines, report.warnings.map((row) => `${row.sheet}, fila ${row.rowNumber}${row.recordId ? ` (${row.recordId})` : ""}: ${cell(row.detail)}`), "Sin avisos.")
  if (report.notes.length) { lines.push("## Notas", ""); list(lines, report.notes.map(cell), "") }

  lines.push("## Resumen de CALIDAD_DATOS", "")
  list(lines, report.quality.map((row) => `${cell(row.source)}: ${cell(row.problem)}${row.count !== null ? ` (${row.count})` : ""}`), "El archivo no trae la hoja CALIDAD_DATOS.")
  return lines.join("\n")
}
