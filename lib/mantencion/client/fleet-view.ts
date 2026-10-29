import type { CatalogEquipment, MantCatalog } from "../contracts"
import { nameKey } from "../normalize"
import { currentReading, daysBetween } from "../readings"
import { equipmentStatus, WORKSHOP_UPDATE_DAYS, type PreventiveRef } from "../status"
import type { MantEquipmentStatus, MantReading, MantScheduleSnapshot } from "../types"
import { todayInChile } from "@/lib/utils"
import type { QueueItem, QueueRecordItem, StoredCatalog } from "./types"

/**
 * Lo que el teléfono sabe de la flota, sin servidor: el catálogo bajado más lo
 * que el propio teléfono registró y todavía no envió. Sin esa capa, una segunda
 * preventiva hecha sin señal se validaría contra una lectura vieja y «Le toca
 * mantención» seguiría mostrando un equipo que ya se mantuvo.
 */

export interface FleetRow {
  eq: CatalogEquipment
  schedule: MantScheduleSnapshot | null
  status: MantEquipmentStatus
  readings: MantReading[]
  initial: MantReading | null
  recentPreventives: PreventiveRef[]
  /** Su faena es una de las del usuario. */
  mine: boolean
}

export interface WorkshopEntry {
  vehicleId: string
  recordId: string
  worksiteId: string
  equipmentCode: string
  equipmentPlate: string
  folio: string | null
  entryDate: string | null
  lastActivityDate: string
  stale: boolean
  daysStopped: number | null
}

/** Registros del propio teléfono que cuentan como vigentes: todo menos lo rechazado. */
export function localRecords(queue: readonly QueueItem[]): QueueRecordItem[] {
  return queue.filter((item): item is QueueRecordItem => item.type === "record" && item.status !== "rejected")
}

export function allEquipment(stored: StoredCatalog | null): CatalogEquipment[] {
  if (!stored) return []
  const mine = stored.catalog.equipment
  const seen = new Set(mine.map((eq) => eq.id))
  return [...mine, ...(stored.others?.equipment ?? []).filter((eq) => !seen.has(eq.id))]
}

export function schedulesById(catalog: MantCatalog | null | undefined): Map<string, MantScheduleSnapshot> {
  return new Map((catalog?.schedules ?? []).map((schedule) => [schedule.id, schedule]))
}

function newerPreventive<T extends { date: string; reading: number }>(a: T | null, b: T): T {
  if (!a) return b
  return b.date > a.date || (b.date === a.date && b.reading > a.reading) ? b : a
}

export function buildRow(eq: CatalogEquipment, schedule: MantScheduleSnapshot | null, queue: readonly QueueRecordItem[], worksiteIds: ReadonlySet<string>): FleetRow {
  const mine = queue.filter((item) => item.summary.vehicleId === eq.id)
  const initial: MantReading | null = eq.initialReading ? { value: eq.initialReading.value, date: eq.initialReading.date, source: "Lectura inicial" } : null
  const readings: MantReading[] = eq.readings.map((reading) => ({ value: reading.value, date: reading.date, source: reading.source }))
  const recentPreventives: PreventiveRef[] = [...eq.recentPreventives]
  let lastPreventive = eq.lastPreventive
  for (const item of mine) {
    readings.push({ value: item.summary.reading, date: item.summary.workDate, source: item.folio ?? "registro pendiente de envío" })
    if (item.summary.kind === "P" && item.summary.intervalValue != null) {
      const ref = { reading: item.summary.reading, date: item.summary.workDate, intervalValue: item.summary.intervalValue }
      recentPreventives.push({ id: item.id, folio: item.folio, ...ref })
      lastPreventive = newerPreventive(lastPreventive, ref)
    }
  }

  const status: MantEquipmentStatus = mine.length > 0 && schedule
    ? equipmentStatus({ retired: false, intervals: schedule.intervals, readings, initial, lastPreventive })
    : {
        state: eq.state,
        currentReading: currentReading(readings, initial),
        nextReading: eq.nextReading,
        remaining: eq.remaining,
        nextIntervalValue: eq.nextIntervalValue,
        lastPreventive,
      }
  return { eq, schedule, status, readings, initial, recentPreventives, mine: worksiteIds.has(eq.worksiteId) }
}

export function buildRows(stored: StoredCatalog | null, queue: readonly QueueItem[]): FleetRow[] {
  if (!stored) return []
  const schedules = schedulesById(stored.catalog)
  const worksiteIds = new Set(stored.catalog.user.worksiteIds)
  const local = localRecords(queue)
  return allEquipment(stored).map((eq) => buildRow(eq, eq.scheduleId ? schedules.get(eq.scheduleId) ?? null : null, local, worksiteIds))
}

/** «KA-140 · SGCP-84», o sólo el código cuando el equipo no tiene patente propia. */
export function equipmentLabel(eq: Pick<CatalogEquipment, "code" | "plate">): string {
  return eq.code === eq.plate ? eq.code : `${eq.code} · ${eq.plate}`
}

/** Clave de búsqueda: sin tildes, mayúsculas ni separadores («ka140» encuentra «KA-140»). */
export function searchKey(value: string): string {
  return nameKey(value).replace(/[\s\-·._]/g, "")
}

const DUE_RANK: Partial<Record<MantEquipmentStatus["state"], number>> = { vencida: 0, proxima: 1 }

function urgency(row: FleetRow): number {
  const base = row.schedule ? Math.min(...row.schedule.intervals) : 1
  return (row.status.remaining ?? 0) / base
}

/** Vencidos y próximos primero (los más atrasados antes), después el resto por código. */
export function sortForPicking(rows: FleetRow[]): FleetRow[] {
  return [...rows].sort((a, b) => {
    const ra = DUE_RANK[a.status.state] ?? 9
    const rb = DUE_RANK[b.status.state] ?? 9
    if (ra !== rb) return ra - rb
    if (ra < 9) return urgency(a) - urgency(b)
    return a.eq.code.localeCompare(b.eq.code, "es")
  })
}

export function filterForPicking(rows: FleetRow[], options: { scope: "mine" | "all"; query: string }): FleetRow[] {
  const query = searchKey(options.query)
  const visible = rows.filter((row) => {
    if (options.scope === "mine" && !row.mine) return false
    if (!query) return true
    return searchKey(`${row.eq.code}${row.eq.plate}${row.eq.brandName}${row.eq.model ?? ""}${row.eq.typeName}`).includes(query)
  })
  return sortForPicking(visible)
}

/** «Le toca mantención»: vencidos y próximos de las faenas del usuario. */
export function dueRows(rows: FleetRow[], limit = 5): FleetRow[] {
  return sortForPicking(rows.filter((row) => row.mine && (row.status.state === "vencida" || row.status.state === "proxima"))).slice(0, limit)
}

/**
 * Equipos en taller de las faenas del usuario, con lo que el propio teléfono ya
 * hizo encima: una actualización «salió» lo saca de la lista, una «sigue» le
 * quita el aviso de «Toca actualizar», y una correctiva recién firmada con el
 * equipo en taller aparece aunque todavía no llegue al servidor.
 */
export function workshopEntries(rows: FleetRow[], queue: readonly QueueItem[], today: string = todayInChile()): WorkshopEntry[] {
  const entries = new Map<string, WorkshopEntry>()
  for (const row of rows) {
    const w = row.eq.workshop
    if (!w || !row.mine) continue
    entries.set(w.recordId, {
      vehicleId: row.eq.id, recordId: w.recordId, worksiteId: row.eq.worksiteId,
      equipmentCode: row.eq.code, equipmentPlate: row.eq.plate, folio: w.folio, entryDate: w.entryDate,
      lastActivityDate: w.lastActivityDate, stale: w.stale,
      daysStopped: w.entryDate ? Math.max(0, daysBetween(w.entryDate, today)) : w.daysStopped,
    })
  }
  const rowByVehicle = new Map(rows.map((row) => [row.eq.id, row]))
  for (const item of localRecords(queue)) {
    const { summary } = item
    if (!summary.inWorkshop || entries.has(item.id)) continue
    const row = rowByVehicle.get(summary.vehicleId)
    if (!row?.mine) continue
    entries.set(item.id, {
      vehicleId: summary.vehicleId, recordId: item.id, worksiteId: row.eq.worksiteId,
      equipmentCode: summary.equipmentCode, equipmentPlate: summary.equipmentPlate, folio: item.folio,
      entryDate: summary.workshopEntryDate, lastActivityDate: summary.workDate, stale: false,
      daysStopped: summary.workshopEntryDate ? Math.max(0, daysBetween(summary.workshopEntryDate, today)) : null,
    })
  }
  const updates = queue.filter((item) => item.type === "workshop" && item.status !== "rejected").sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  for (const item of updates) {
    if (item.type !== "workshop") continue
    const entry = entries.get(item.payload.recordId)
    if (!entry) continue
    if (item.payload.kind === "salio") { entries.delete(item.payload.recordId); continue }
    const activity = todayInChile(new Date(item.payload.createdAt))
    entry.lastActivityDate = activity > entry.lastActivityDate ? activity : entry.lastActivityDate
    entry.stale = daysBetween(entry.lastActivityDate, today) > WORKSHOP_UPDATE_DAYS
  }
  return [...entries.values()].sort((a, b) => a.equipmentCode.localeCompare(b.equipmentCode, "es"))
}
