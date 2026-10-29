import { desc, eq, isNull, or } from "drizzle-orm"
import { db } from "@/db"
import { mantRecordObservations, mantRecords, mantSchedules, users, worksites } from "@/db/schema"
import type {
  CatalogEquipment, CatalogObservation, CatalogOtherEquipment, CatalogOwnRecord, MantCatalog, MantCatalogOthers,
} from "@/lib/mantencion/contracts"
import type { MantRecordKind, MantReview, MantRecordStatus, MantUnit } from "@/lib/mantencion/types"
import type { MantViewer } from "./access"
import { listMantCatalogs } from "./catalogs"
import { loadFleet, type FleetRow, type MantWorksiteScope } from "./fleet"
import { getCurrentScheduleSnapshots } from "./schedule-versions"
import { findAppUsers } from "./sync-app-users"
import type { SyncContext } from "./sync-auth"
import { catalogVersion } from "./sync-catalog-version"

/**
 * Catálogo que descarga la app del mecánico (`GET …/sync/catalogo`): todo lo que
 * necesita para registrar sin señal. Se arma SIEMPRE con el alcance de quien
 * pide (sus faenas), nunca con lo que el teléfono diga.
 *
 * - `alcance=mias` (por defecto): equipos activos de sus faenas, completos, más
 *   pautas, catálogos, sus últimos registros y sus observaciones.
 * - `alcance=todos`: el resto de los equipos activos, en versión liviana, para
 *   registrar en un equipo de otra faena (queda marcado «fuera de faena»).
 */

const OWN_RECORDS_LIMIT = 20
const OBSERVATIONS_LIMIT = 50

interface ViewerWorksites {
  /** Faenas activas propias; `"all"` = un rol global sin faenas asignadas ve todas. */
  scope: MantWorksiteScope
  all: Array<{ id: string; name: string }>
  mine: Array<{ id: string; name: string }>
}

async function resolveWorksites(viewer: MantViewer): Promise<ViewerWorksites> {
  const all = await db
    .select({ id: worksites.id, name: worksites.name })
    .from(worksites)
    .where(eq(worksites.isActive, true))
    .orderBy(worksites.name)
  const assigned = new Set(viewer.worksiteIds)
  if (assigned.size > 0) {
    const mine = all.filter((row) => assigned.has(row.id))
    return { scope: mine.map((row) => row.id), all, mine }
  }
  // Rol global sin faenas asignadas: todas. Cualquier otro sin faenas: ninguna.
  return viewer.isGlobal ? { scope: "all", all, mine: all } : { scope: [], all, mine: [] }
}

function toCatalogEquipment(row: FleetRow): CatalogEquipment {
  const readings = row.readings.map((reading) => ({ value: reading.value, date: reading.date, source: reading.source }))
  // La lectura inicial va al final: valida (regla 2) igual que una lectura de registro.
  if (row.initialReading) readings.push({ value: row.initialReading.value, date: row.initialReading.date, source: "Lectura inicial" })
  return {
    id: row.vehicleId,
    code: row.code,
    plate: row.plate,
    noPlate: row.noPlate,
    typeName: row.typeName,
    unit: row.unit,
    brandId: row.brandId,
    brandName: row.brandName,
    model: row.model,
    worksiteId: row.worksiteId,
    worksiteName: row.worksiteName,
    scheduleId: row.scheduleId,
    readings,
    initialReading: row.initialReading,
    state: row.status.state,
    nextReading: row.status.nextReading,
    remaining: row.status.remaining,
    nextIntervalValue: row.status.nextIntervalValue,
    lastPreventive: row.status.lastPreventive,
    recentPreventives: row.recentPreventives,
    workshop: row.workshop
      ? {
        recordId: row.workshop.recordId,
        folio: row.workshop.folio,
        entryDate: row.workshop.entryDate,
        lastActivityDate: row.workshop.lastActivityDate,
        stale: row.workshop.stale,
        daysStopped: row.workshop.daysStopped,
      }
      : null,
  }
}

const iso = (value: string) => new Date(value).toISOString()

async function loadOwnRecords(userId: string): Promise<CatalogOwnRecord[]> {
  const rows = await db
    .select({
      id: mantRecords.id,
      folio: mantRecords.folio,
      kind: mantRecords.kind,
      snapshot: mantRecords.equipmentSnapshot,
      workDate: mantRecords.workDate,
      receivedAt: mantRecords.receivedAt,
      status: mantRecords.status,
      review: mantRecords.review,
      intervalValue: mantRecords.intervalValue,
      unit: mantRecords.unit,
    })
    .from(mantRecords)
    .where(or(eq(mantRecords.registeredBy, userId), eq(mantRecords.executorUserId, userId)))
    .orderBy(desc(mantRecords.receivedAt))
    .limit(OWN_RECORDS_LIMIT)
  return rows.map((row) => ({
    id: row.id,
    folio: row.folio,
    kind: row.kind as MantRecordKind,
    equipmentCode: row.snapshot.code,
    equipmentPlate: row.snapshot.plate,
    workDate: row.workDate,
    receivedAt: iso(row.receivedAt),
    status: row.status as MantRecordStatus,
    review: row.review as MantReview,
    intervalValue: row.intervalValue,
    unit: row.unit as MantUnit,
  }))
}

async function loadObservations(userId: string): Promise<CatalogObservation[]> {
  const rows = await db
    .select({
      id: mantRecordObservations.id,
      recordId: mantRecordObservations.recordId,
      folio: mantRecords.folio,
      snapshot: mantRecords.equipmentSnapshot,
      text: mantRecordObservations.text,
      by: users.name,
      createdAt: mantRecordObservations.createdAt,
      response: mantRecordObservations.response,
    })
    .from(mantRecordObservations)
    .innerJoin(mantRecords, eq(mantRecords.id, mantRecordObservations.recordId))
    .innerJoin(users, eq(users.id, mantRecordObservations.userId))
    .where(or(eq(mantRecords.registeredBy, userId), eq(mantRecords.executorUserId, userId)))
    .orderBy(desc(mantRecordObservations.createdAt))
    .limit(OBSERVATIONS_LIMIT)
  return rows.map((row) => ({
    id: row.id,
    recordId: row.recordId,
    folio: row.folio,
    equipmentCode: row.snapshot.code,
    text: row.text,
    by: row.by,
    createdAt: iso(row.createdAt),
    response: row.response,
  }))
}

/** `alcance=mias`. */
export async function buildCatalog(
  context: Pick<SyncContext, "viewer" | "userName">,
  knownVersion?: string,
): Promise<MantCatalog> {
  const { viewer } = context
  const version = knownVersion ?? await catalogVersion(viewer, "mias")
  const places = await resolveWorksites(viewer)
  const [fleet, catalogs, scheduleRows, mechanics, myRecords, observations] = await Promise.all([
    loadFleet({ scope: places.scope, includeRetired: false }),
    listMantCatalogs(),
    db.select({ id: mantSchedules.id }).from(mantSchedules).where(isNull(mantSchedules.deletedAt)),
    findAppUsers(db, places.scope === "all" ? {} : { worksiteIds: places.mine.map((row) => row.id) }),
    loadOwnRecords(viewer.userId),
    loadObservations(viewer.userId),
  ])
  // Todas las pautas vivas, no sólo las asignadas: «Elegir otra pauta» y los equipos de otras faenas las necesitan.
  const schedules = await getCurrentScheduleSnapshots(scheduleRows.map((row) => row.id))
  const brief = (entries: Array<{ id: string; name: string }>) => entries.map((entry) => ({ id: entry.id, name: entry.name }))

  return {
    version,
    generatedAt: new Date().toISOString(),
    user: { id: viewer.userId, name: context.userName, worksiteIds: places.mine.map((row) => row.id) },
    worksites: places.mine,
    equipment: fleet.map(toCatalogEquipment),
    schedules,
    brands: brief(catalogs.brands),
    workshops: brief(catalogs.workshops),
    drivers: brief(catalogs.drivers),
    workTypes: brief(catalogs.workTypes),
    oils: brief(catalogs.oils),
    mechanics: mechanics.filter((mechanic) => mechanic.id !== viewer.userId),
    myRecords,
    observations,
  }
}

/** `alcance=todos`: equipos activos FUERA de las faenas de quien pide, sin historial. */
export async function buildOthersCatalog(viewer: MantViewer, knownVersion?: string): Promise<MantCatalogOthers> {
  const version = knownVersion ?? await catalogVersion(viewer, "todos")
  const places = await resolveWorksites(viewer)
  const mineIds = new Set(places.mine.map((row) => row.id))
  const otherIds = places.all.map((row) => row.id).filter((id) => !mineIds.has(id))
  // Con `[]` `loadFleet` no devuelve filas: un rol global sin faenas ya recibió todo en `mias`.
  const fleet = otherIds.length ? await loadFleet({ scope: otherIds, includeRetired: false }) : []
  const equipment = fleet.map((row): CatalogOtherEquipment => ({
    ...toCatalogEquipment(row),
    recentPreventives: [],
    workshop: null,
  }))
  return { version, equipment }
}
