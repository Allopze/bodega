import { and, eq, inArray } from "drizzle-orm"
import type { Tx } from "@/db"
import {
  fuelEquipmentTypes, fuelVehicles, mantBrands, mantDrivers, mantEquipmentProfiles, mantOils, mantRecordPhotos,
  mantRecords, mantSchedules, mantWorkshops, mantWorkTypes, worksites,
} from "@/db/schema"
import type { PreventiveRef } from "@/lib/mantencion/status"
import type { MantReading, MantUnit } from "@/lib/mantencion/types"
import { unitFromMeter } from "./fleet"

/**
 * Lecturas de contexto que la validación de un registro necesita. TODAS van por
 * la transacción recibida: con un solo cliente (PGlite) una consulta por el
 * `db` global quedaría esperando a la transacción abierta, y con Postgres real
 * leería otro estado que el que se está escribiendo.
 */

export interface VehicleContext {
  vehicleId: string
  code: string
  plate: string
  noPlate: boolean
  typeName: string
  unit: MantUnit
  brandId: string
  brandName: string
  model: string | null
  year: number | null
  worksiteId: string
  worksiteName: string
  isActive: boolean
  scheduleId: string | null
  /** Versión VIGENTE de la pauta asignada hoy (para la advertencia `schedule_outdated`). */
  scheduleVersion: number | null
  initial: MantReading | null
}

/**
 * Bloquea la fila del perfil del equipo y lo lee. El bloqueo serializa los
 * registros simultáneos sobre el mismo equipo: sin él, dos envíos podrían pasar
 * la validación de lectura contra el mismo estado y quedar ambos.
 */
export async function lockAndLoadVehicle(tx: Tx, vehicleId: string): Promise<VehicleContext | null> {
  const locked = await tx
    .select({ id: mantEquipmentProfiles.vehicleId })
    .from(mantEquipmentProfiles)
    .where(eq(mantEquipmentProfiles.vehicleId, vehicleId))
    .for("update")
  if (locked.length === 0) return null

  const [row] = await tx
    .select({
      vehicleId: fuelVehicles.id,
      code: fuelVehicles.code,
      plate: fuelVehicles.plate,
      model: fuelVehicles.model,
      year: fuelVehicles.year,
      isActive: fuelVehicles.isActive,
      worksiteId: fuelVehicles.worksiteId,
      worksiteName: worksites.name,
      typeName: fuelEquipmentTypes.name,
      meterType: fuelEquipmentTypes.defaultMeterType,
      brandId: mantBrands.id,
      brandName: mantBrands.name,
      scheduleId: mantEquipmentProfiles.scheduleId,
      scheduleVersion: mantSchedules.version,
      scheduleDeletedAt: mantSchedules.deletedAt,
      noPlate: mantEquipmentProfiles.noPlate,
      initialReading: mantEquipmentProfiles.initialReading,
      initialReadingDate: mantEquipmentProfiles.initialReadingDate,
    })
    .from(mantEquipmentProfiles)
    .innerJoin(fuelVehicles, eq(fuelVehicles.id, mantEquipmentProfiles.vehicleId))
    .innerJoin(fuelEquipmentTypes, eq(fuelEquipmentTypes.id, fuelVehicles.equipmentTypeId))
    .innerJoin(worksites, eq(worksites.id, fuelVehicles.worksiteId))
    .innerJoin(mantBrands, eq(mantBrands.id, mantEquipmentProfiles.brandId))
    .leftJoin(mantSchedules, eq(mantSchedules.id, mantEquipmentProfiles.scheduleId))
    .where(eq(mantEquipmentProfiles.vehicleId, vehicleId))
    .limit(1)
  if (!row) return null
  const unit = unitFromMeter(row.meterType)
  if (!unit) return null

  const liveSchedule = row.scheduleId && !row.scheduleDeletedAt
  return {
    vehicleId: row.vehicleId,
    code: row.code ?? row.plate,
    plate: row.plate,
    noPlate: row.noPlate,
    typeName: row.typeName,
    unit,
    brandId: row.brandId,
    brandName: row.brandName,
    model: row.model,
    year: row.year,
    worksiteId: row.worksiteId,
    worksiteName: row.worksiteName,
    isActive: row.isActive,
    scheduleId: liveSchedule ? row.scheduleId : null,
    scheduleVersion: liveSchedule ? row.scheduleVersion : null,
    initial: row.initialReading != null && row.initialReadingDate
      ? { value: row.initialReading, date: row.initialReadingDate, source: "Lectura inicial" }
      : null,
  }
}

export interface VehicleHistory {
  /** TODAS las lecturas vigentes del equipo (regla 2 valida contra la historia completa, no contra las 12 del catálogo). */
  readings: MantReading[]
  preventives: PreventiveRef[]
}

export async function loadVehicleHistory(tx: Tx, vehicleId: string): Promise<VehicleHistory> {
  const rows = await tx
    .select({
      id: mantRecords.id,
      kind: mantRecords.kind,
      folio: mantRecords.folio,
      reading: mantRecords.reading,
      workDate: mantRecords.workDate,
      intervalValue: mantRecords.intervalValue,
    })
    .from(mantRecords)
    .where(and(eq(mantRecords.vehicleId, vehicleId), eq(mantRecords.status, "vigente")))
  return {
    readings: rows.map((row) => ({ value: row.reading, date: row.workDate, source: row.folio ?? "Registro sin folio" })),
    preventives: rows
      .filter((row) => row.kind === "P" && row.intervalValue != null)
      .map((row) => ({ id: row.id, folio: row.folio, reading: row.reading, date: row.workDate, intervalValue: row.intervalValue ?? 0 })),
  }
}

export interface CatalogNames {
  workTypes: Map<string, string>
  oils: Map<string, string>
  workshops: Map<string, string>
  drivers: Map<string, string>
}

/** Nombres de los catálogos citados, sólo de filas ACTIVAS: un id inactivo o inexistente simplemente no aparece. */
export async function loadCatalogNames(
  tx: Tx,
  ids: { workTypes: string[]; oils: string[]; workshops: string[]; drivers: string[] },
): Promise<CatalogNames> {
  const none = Promise.resolve([] as Array<{ id: string; name: string }>)
  const [workTypes, oils, workshops, drivers] = await Promise.all([
    ids.workTypes.length
      ? tx.select({ id: mantWorkTypes.id, name: mantWorkTypes.name }).from(mantWorkTypes)
        .where(and(inArray(mantWorkTypes.id, ids.workTypes), eq(mantWorkTypes.isActive, true)))
      : none,
    ids.oils.length
      ? tx.select({ id: mantOils.id, name: mantOils.name }).from(mantOils)
        .where(and(inArray(mantOils.id, ids.oils), eq(mantOils.isActive, true)))
      : none,
    ids.workshops.length
      ? tx.select({ id: mantWorkshops.id, name: mantWorkshops.name }).from(mantWorkshops)
        .where(and(inArray(mantWorkshops.id, ids.workshops), eq(mantWorkshops.isActive, true)))
      : none,
    ids.drivers.length
      ? tx.select({ id: mantDrivers.id, name: mantDrivers.name }).from(mantDrivers)
        .where(and(inArray(mantDrivers.id, ids.drivers), eq(mantDrivers.isActive, true)))
      : none,
  ])
  const toMap = (rows: Array<{ id: string; name: string }>) => new Map(rows.map((row) => [row.id, row.name]))
  return { workTypes: toMap(workTypes), oils: toMap(oils), workshops: toMap(workshops), drivers: toMap(drivers) }
}

export interface PhotoRow {
  id: string
  kind: string
  uploadedBy: string
  recordId: string | null
}

export async function loadPhotos(tx: Tx, ids: string[]): Promise<PhotoRow[]> {
  if (ids.length === 0) return []
  return tx
    .select({ id: mantRecordPhotos.id, kind: mantRecordPhotos.kind, uploadedBy: mantRecordPhotos.uploadedBy, recordId: mantRecordPhotos.recordId })
    .from(mantRecordPhotos)
    .where(inArray(mantRecordPhotos.id, ids))
}
