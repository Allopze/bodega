import { and, asc, eq, inArray } from "drizzle-orm"
import { db } from "@/db"
import {
  fuelEquipmentTypes, fuelVehicles, mantEquipmentProfiles, mantHistoricalScheduleChecks, mantHistoricalScheduleItems,
  mantRecordItems, mantRecordPhotos, mantRecords, worksites,
} from "@/db/schema"
import { driveLink } from "@/lib/mantencion/drive-link"
import { equipmentScope, hasMantPermission, isWorksiteInScope, type MantViewer } from "../access"
import { getCurrentScheduleSnapshots } from "../schedule-versions"
import {
  pendingItems, systemResolver, type CheckDetail, type CheckPhoto, type DetailItem, type EquipmentCheckDetail, type ItemState,
  type PeriodCheck,
} from "./equipment-check-summary"
import { HISTORICAL_OBSERVATIONS, loadVehicleChecks } from "./preventive-checks"
import type { ComplianceCheck } from "./types"

/**
 * Ficha de un equipo en Preventivo: sus pautas del período, lo que no se hizo y el detalle de una pauta.
 *
 * Alcance: las pautas salen de `loadVehicleChecks`, la MISMA consulta (alcance por faena, visibilidad de registros,
 * corte histórico/nativo y regla de unidad) que alimenta las tablas, así que la ficha no muestra ni una pauta que la
 * tabla no muestre. Se vuelve a exigir el permiso de lectura aquí: el ocultar la pestaña no es autorización.
 *
 * Devuelve `null` cuando el equipo no existe o no se puede ver: no está en una faena del alcance de quien mira y
 * ninguna de sus pautas del período es visible para él (un id ajeno no confirma que exista).
 *
 * `checkId` que no es una pauta de ESTE equipo en el período (ajena, vieja, de otra faena) se ignora y se muestra la
 * más reciente: un enlace compartido que quedó viejo abre la ficha, no un error. Nunca se muestra la pauta de otro equipo.
 *
 * El histórico no trae sistema ni motivo por ítem. El sistema sólo se completa si el nombre coincide EXACTO con un
 * único ítem de la pauta vigente del equipo; el motivo no se inventa nunca (`reason: null`).
 */

const PHOTO_KINDS = ["filtros", "sticker"] as const

function linkPhoto(raw: string | null | undefined): CheckPhoto {
  const text = raw?.trim()
  if (!text) return { status: "missing" }
  const url = driveLink(text)
  return url ? { status: "link", url } : { status: "invalid_link" }
}

function stateOf(value: string): ItemState {
  return value === "R" || value === "realizado" ? "realizado" : value === "NR" || value === "no_realizado" ? "no_realizado" : "no_aplica"
}

function groupBy<T>(rows: readonly T[], key: (row: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>()
  for (const row of rows) map.set(key(row), [...(map.get(key(row)) ?? []), row])
  return map
}

function toPeriodCheck(check: ComplianceCheck, folios: ReadonlyMap<string, string | null>): PeriodCheck {
  const recordId = check.source === "registro" ? check.id.slice(2) : null
  return {
    id: check.id,
    source: check.source,
    date: check.date,
    level: check.level,
    mechanic: check.mechanic,
    done: check.done,
    notDone: check.notDone,
    notApplicable: check.notApplicable,
    percent: check.percent,
    folio: recordId ? folios.get(recordId) ?? null : null,
    recordId,
  }
}

export async function loadEquipmentCheckDetail(
  viewer: MantViewer,
  vehicleId: string,
  period: { from: string; to: string },
  checkId?: string | null,
): Promise<EquipmentCheckDetail | null> {
  if (!hasMantPermission(viewer, "mant:records:view_all") && !hasMantPermission(viewer, "mant:records:view_worksite")) return null

  const [vehicle] = await db.select({
    id: fuelVehicles.id,
    code: fuelVehicles.code,
    plate: fuelVehicles.plate,
    worksiteId: fuelVehicles.worksiteId,
    worksiteName: worksites.name,
    typeName: fuelEquipmentTypes.name,
    scheduleId: mantEquipmentProfiles.scheduleId,
  })
    .from(fuelVehicles)
    .leftJoin(fuelEquipmentTypes, eq(fuelEquipmentTypes.id, fuelVehicles.equipmentTypeId))
    .leftJoin(mantEquipmentProfiles, eq(mantEquipmentProfiles.vehicleId, fuelVehicles.id))
    .leftJoin(worksites, eq(worksites.id, fuelVehicles.worksiteId))
    .where(eq(fuelVehicles.id, vehicleId))
    .limit(1)
  if (!vehicle) return null

  const checks = await loadVehicleChecks(viewer, vehicleId, period.from, period.to)
  if (checks.length === 0 && !isWorksiteInScope(equipmentScope(viewer), vehicle.worksiteId)) return null

  const header: EquipmentCheckDetail["vehicle"] = {
    id: vehicle.id, code: vehicle.code ?? "", plate: vehicle.plate ?? "", typeName: vehicle.typeName ?? null, worksiteName: vehicle.worksiteName ?? null,
  }
  if (checks.length === 0) return { vehicle: header, period, checks: [], pending: [], selected: null }

  const historical = checks.filter((check) => check.source === "historial")
  const native = checks.filter((check) => check.source === "registro")
  const historicalKeys = historical.map((check) => check.id.slice(2))
  const nativeIds = native.map((check) => check.id.slice(2))

  const [historicalItems, historicalMeta, nativeItems, nativeMeta, snapshots] = await Promise.all([
    historicalKeys.length
      ? db.select({
        checkSourceKey: mantHistoricalScheduleItems.checkSourceKey, itemName: mantHistoricalScheduleItems.itemName,
        result: mantHistoricalScheduleItems.result, sortOrder: mantHistoricalScheduleItems.sortOrder,
      }).from(mantHistoricalScheduleItems)
        .where(inArray(mantHistoricalScheduleItems.checkSourceKey, historicalKeys))
        .orderBy(asc(mantHistoricalScheduleItems.sortOrder))
      : Promise.resolve([]),
    historicalKeys.length
      ? db.select({
        sourceKey: mantHistoricalScheduleChecks.sourceKey,
        reading: mantHistoricalScheduleChecks.reading,
        observations: HISTORICAL_OBSERVATIONS,
        itemsNotDone: mantHistoricalScheduleChecks.itemsNotDone,
        filtersPhotoUrl: mantHistoricalScheduleChecks.filtersPhotoUrl,
        stickerPhotoUrl: mantHistoricalScheduleChecks.stickerPhotoUrl,
      }).from(mantHistoricalScheduleChecks).where(inArray(mantHistoricalScheduleChecks.sourceKey, historicalKeys))
      : Promise.resolve([]),
    nativeIds.length
      ? db.select({
        recordId: mantRecordItems.recordId, itemName: mantRecordItems.itemName, groupName: mantRecordItems.groupName,
        value: mantRecordItems.value, reason: mantRecordItems.reason, sortOrder: mantRecordItems.sortOrder,
      }).from(mantRecordItems).where(inArray(mantRecordItems.recordId, nativeIds)).orderBy(asc(mantRecordItems.sortOrder))
      : Promise.resolve([]),
    nativeIds.length
      ? db.select({ id: mantRecords.id, folio: mantRecords.folio, reading: mantRecords.reading, notes: mantRecords.notes })
        .from(mantRecords).where(inArray(mantRecords.id, nativeIds))
      : Promise.resolve([]),
    historicalKeys.length && vehicle.scheduleId ? getCurrentScheduleSnapshots([vehicle.scheduleId]) : Promise.resolve([]),
  ])

  const resolveSystem = systemResolver(snapshots.flatMap((snapshot) => snapshot.groups))
  const historicalItemsByCheck = groupBy(historicalItems, (row) => row.checkSourceKey)
  const historicalMetaByKey = new Map(historicalMeta.map((row) => [row.sourceKey, row]))
  const nativeItemsByRecord = groupBy(nativeItems, (row) => row.recordId)
  const nativeMetaById = new Map(nativeMeta.map((row) => [row.id, row]))

  /** Ítems de una pauta y cuánto detalle trae. */
  function itemsOf(check: ComplianceCheck): { items: DetailItem[]; itemDetail: CheckDetail["itemDetail"] } {
    const key = check.id.slice(2)
    if (check.source === "registro") {
      const rows = nativeItemsByRecord.get(key) ?? []
      return {
        items: rows.map((row) => ({ name: row.itemName, system: row.groupName, state: stateOf(row.value), reason: row.reason?.trim() || null })),
        itemDetail: rows.length > 0 ? "full" : "none",
      }
    }
    const rows = historicalItemsByCheck.get(key) ?? []
    if (rows.length > 0) {
      return {
        items: rows.map((row) => ({ name: row.itemName, system: resolveSystem(row.itemName), state: stateOf(row.result), reason: null })),
        itemDetail: "full",
      }
    }
    // Sin el bloque «Detalle por ítem»: lo único que trae el formulario son los nombres de lo no realizado.
    const named = [...new Set((historicalMetaByKey.get(key)?.itemsNotDone ?? []).map((name) => name.trim()).filter(Boolean))]
    return {
      items: named.map((name) => ({ name, system: resolveSystem(name), state: "no_realizado" as const, reason: null })),
      itemDetail: named.length > 0 ? "not_done_only" : "none",
    }
  }

  const itemsByCheck = new Map(checks.map((check) => [check.id, itemsOf(check)]))
  const folios = new Map(nativeMeta.map((row) => [row.id, row.folio]))
  const periodChecks = checks.map((check) => toPeriodCheck(check, folios))
  const pending = pendingItems(checks.map((check) => ({ date: check.date, items: itemsByCheck.get(check.id)!.items })))

  // La pauta pedida si es de este equipo en el período; si no, la más reciente.
  const chosen = checks.find((check) => check.id === checkId) ?? checks[0]!
  const chosenPeriod = periodChecks.find((check) => check.id === chosen.id)!
  const chosenItems = itemsByCheck.get(chosen.id)!
  const key = chosen.id.slice(2)

  let detail: CheckDetail
  if (chosen.source === "historial") {
    const meta = historicalMetaByKey.get(key)
    detail = {
      ...chosenPeriod, ...chosenItems,
      reading: meta?.reading ?? null,
      observations: meta?.observations?.trim() || null,
      filtersPhoto: linkPhoto(meta?.filtersPhotoUrl),
      stickerPhoto: linkPhoto(meta?.stickerPhotoUrl),
    }
  } else {
    const photos = await db.select({
      id: mantRecordPhotos.id, kind: mantRecordPhotos.kind, stampedAt: mantRecordPhotos.stampedAt, receivedAt: mantRecordPhotos.receivedAt,
    }).from(mantRecordPhotos)
      .where(and(eq(mantRecordPhotos.recordId, key), inArray(mantRecordPhotos.kind, [...PHOTO_KINDS])))
      .orderBy(asc(mantRecordPhotos.sortOrder))
    const photoOf = (kind: (typeof PHOTO_KINDS)[number]): CheckPhoto => {
      const found = photos.find((photo) => photo.kind === kind)
      return found ? { status: "native", id: found.id, stampedAt: found.stampedAt, receivedAt: found.receivedAt } : { status: "missing" }
    }
    const meta = nativeMetaById.get(key)
    detail = {
      ...chosenPeriod, ...chosenItems,
      reading: meta?.reading ?? null,
      observations: meta?.notes?.trim() || null,
      filtersPhoto: photoOf("filtros"),
      stickerPhoto: photoOf("sticker"),
    }
  }

  return { vehicle: header, period, checks: periodChecks, pending, selected: detail }
}
