import type { Session } from "next-auth"
import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm"
import { db } from "@/db"
import {
  costCenters,
  fuelOperationRecords,
  fuelVehicles,
  maintenanceRecords,
  suppliers,
  worksites,
} from "@/db/schema"
import { visibleWorksiteIds, isGlobalRole } from "@/lib/auth/scope"
import { recordAudit } from "@/lib/audit"
import { nanoid } from "@/lib/id"

export interface MaintenanceFilters {
  vehicleId?: string
  worksiteId?: string
  status?: string
}

export interface CreateMaintenanceInput {
  vehicleId: string
  supplierId?: string | null
  worksiteId?: string | null
  costCenterId?: string | null
  maintenanceDate: string
  maintenanceType: string
  status: "scheduled" | "in_progress" | "completed" | "cancelled"
  odometerReading?: number | null
  hourMeterReading?: number | null
  netAmount: number
  taxAmount: number
  totalAmount: number
  documentNumber?: string | null
  documentName?: string | null
  notes?: string | null
}

export async function getMaintenancePageData(session: Session, filters: MaintenanceFilters = {}) {
  const scopedWorksites = isGlobalRole(session) ? null : visibleWorksiteIds(session)
  const worksiteScope = scopedWorksites === null
    ? undefined
    : scopedWorksites.length > 0
      ? inArray(maintenanceRecords.worksiteId, scopedWorksites)
      : sql`false`
  const vehicleScope = scopedWorksites === null
    ? undefined
    : scopedWorksites.length > 0
      ? inArray(fuelVehicles.worksiteId, scopedWorksites)
      : sql`false`

  const where = and(
    worksiteScope,
    filters.vehicleId ? eq(maintenanceRecords.vehicleId, filters.vehicleId) : undefined,
    filters.worksiteId ? eq(maintenanceRecords.worksiteId, filters.worksiteId) : undefined,
    filters.status ? eq(maintenanceRecords.status, filters.status) : undefined,
  )

  const [records, vehicles, supplierRows, worksiteRows, costCenterRows] = await Promise.all([
    db.query.maintenanceRecords.findMany({
      where,
      with: { vehicle: true, supplier: true, worksite: true, costCenter: true },
      orderBy: [desc(maintenanceRecords.maintenanceDate), desc(maintenanceRecords.createdAt)],
      limit: 100,
    }),
    db.query.fuelVehicles.findMany({
      where: vehicleScope,
      with: { worksite: true },
      orderBy: [fuelVehicles.plate],
    }),
    db.query.suppliers.findMany({ orderBy: [suppliers.name] }),
    db.query.worksites.findMany({ orderBy: [worksites.name] }),
    db.query.costCenters.findMany({ orderBy: [costCenters.code] }),
  ])

  return {
    records,
    vehicles,
    suppliers: supplierRows,
    worksites: scopedWorksites === null
      ? worksiteRows
      : worksiteRows.filter((worksite) => scopedWorksites.includes(worksite.id)),
    costCenters: costCenterRows,
  }
}

export async function getUpcomingMaintenance(session: Session) {
  const scopedWorksites = isGlobalRole(session) ? null : visibleWorksiteIds(session)
  const worksiteScope = scopedWorksites === null
    ? undefined
    : scopedWorksites.length > 0
      ? inArray(maintenanceRecords.worksiteId, scopedWorksites)
      : sql`false`

  const today = new Date().toISOString().slice(0, 10)
  const thirtyDays = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

  const upcoming = await db.query.maintenanceRecords.findMany({
    where: and(
      worksiteScope,
      eq(maintenanceRecords.status, "scheduled"),
      sql`${maintenanceRecords.maintenanceDate} >= ${today}`,
      sql`${maintenanceRecords.maintenanceDate} <= ${thirtyDays}`,
    ),
    with: { vehicle: true },
    orderBy: [maintenanceRecords.maintenanceDate],
    limit: 50,
  })

  const overdue = await db.query.maintenanceRecords.findMany({
    where: and(
      worksiteScope,
      eq(maintenanceRecords.status, "scheduled"),
      sql`${maintenanceRecords.maintenanceDate} < ${today}`,
    ),
    with: { vehicle: true },
    orderBy: [maintenanceRecords.maintenanceDate],
    limit: 50,
  })

  return { upcoming, overdue }
}

export interface UsageMaintenanceAlert {
  vehicleId: string
  plate: string
  code: string | null
  medidoPor: "km" | "hora"
  currentReading: number
  currentReadingDate: string
  lastMaintenanceReading: number
  lastMaintenanceDate: string
  usageSinceLastMaintenance: number
}

// ponytail: umbral fijo por tipo de medición (no varía por tipo de equipo);
// mover a configuración por tipo si se necesita ajustar (ej. excavadora vs camioneta).
const USAGE_ALERT_THRESHOLDS: Record<"km" | "hora", number> = { km: 10_000, hora: 250 }

/**
 * Alerta de mantención por uso: compara la última lectura de horómetro/odómetro
 * (del log operacional de combustible, `fuel_operation_records`) contra la
 * lectura registrada en la última mantención completada del vehículo. Distinto
 * de `getUpcomingMaintenance`, que solo mira mantenciones ya programadas por
 * fecha — esto detecta uso acumulado sin mantención programada.
 */
export async function getUsageMaintenanceAlerts(session: Session): Promise<UsageMaintenanceAlert[]> {
  const scopedWorksites = isGlobalRole(session) ? null : visibleWorksiteIds(session)
  const vehicleScope = scopedWorksites === null
    ? undefined
    : scopedWorksites.length > 0
      ? inArray(fuelVehicles.worksiteId, scopedWorksites)
      : sql`false`

  const [vehicles, readings, completedMaintenances] = await Promise.all([
    db.query.fuelVehicles.findMany({
      where: and(vehicleScope, eq(fuelVehicles.isActive, true)),
      columns: { id: true, plate: true, code: true },
    }),
    db.select({
      vehicleId: fuelOperationRecords.vehicleId,
      fecha: fuelOperationRecords.fecha,
      horometro: fuelOperationRecords.horometro,
      medidoPor: fuelOperationRecords.medidoPor,
    })
      .from(fuelOperationRecords)
      .where(and(isNotNull(fuelOperationRecords.vehicleId), isNotNull(fuelOperationRecords.horometro), isNotNull(fuelOperationRecords.medidoPor))),
    db.select({
      vehicleId: maintenanceRecords.vehicleId,
      maintenanceDate: maintenanceRecords.maintenanceDate,
      odometerReading: maintenanceRecords.odometerReading,
      hourMeterReading: maintenanceRecords.hourMeterReading,
    })
      .from(maintenanceRecords)
      .where(eq(maintenanceRecords.status, "completed")),
  ])

  const latestReadingByVehicle = new Map<string, { fecha: string; horometro: number; medidoPor: "km" | "hora" }>()
  for (const r of readings) {
    if (!r.vehicleId || r.horometro == null || !r.medidoPor) continue
    const existing = latestReadingByVehicle.get(r.vehicleId)
    if (!existing || r.fecha > existing.fecha) {
      latestReadingByVehicle.set(r.vehicleId, { fecha: r.fecha, horometro: r.horometro, medidoPor: r.medidoPor as "km" | "hora" })
    }
  }

  const lastMaintenanceByVehicle = new Map<string, { maintenanceDate: string; odometerReading: number | null; hourMeterReading: number | null }>()
  for (const m of completedMaintenances) {
    const existing = lastMaintenanceByVehicle.get(m.vehicleId)
    if (!existing || m.maintenanceDate > existing.maintenanceDate) lastMaintenanceByVehicle.set(m.vehicleId, m)
  }

  const alerts: UsageMaintenanceAlert[] = []
  for (const vehicle of vehicles) {
    const reading = latestReadingByVehicle.get(vehicle.id)
    if (!reading) continue
    const lastMaintenance = lastMaintenanceByVehicle.get(vehicle.id)
    if (!lastMaintenance) continue
    const lastReading = reading.medidoPor === "km" ? lastMaintenance.odometerReading : lastMaintenance.hourMeterReading
    if (lastReading == null) continue

    const usage = reading.horometro - lastReading
    if (usage < USAGE_ALERT_THRESHOLDS[reading.medidoPor]) continue

    alerts.push({
      vehicleId: vehicle.id,
      plate: vehicle.plate,
      code: vehicle.code,
      medidoPor: reading.medidoPor,
      currentReading: reading.horometro,
      currentReadingDate: reading.fecha,
      lastMaintenanceReading: lastReading,
      lastMaintenanceDate: lastMaintenance.maintenanceDate,
      usageSinceLastMaintenance: usage,
    })
  }

  return alerts.sort((a, b) => b.usageSinceLastMaintenance - a.usageSinceLastMaintenance)
}

export async function createMaintenanceRecord(session: Session, input: CreateMaintenanceInput) {
  const vehicle = await db.query.fuelVehicles.findFirst({ where: eq(fuelVehicles.id, input.vehicleId) })
  if (!vehicle) throw new Error("Vehículo no encontrado")

  const worksiteId = input.worksiteId || vehicle.worksiteId
  if (!isGlobalRole(session) && worksiteId && !visibleWorksiteIds(session).includes(worksiteId)) {
    throw new Error("No puedes registrar mantenciones para esta faena")
  }

  const now = new Date().toISOString()
  const id = nanoid()
  await db.insert(maintenanceRecords).values({
    id,
    vehicleId: input.vehicleId,
    supplierId: input.supplierId || null,
    worksiteId,
    costCenterId: input.costCenterId || null,
    maintenanceDate: input.maintenanceDate,
    maintenanceType: input.maintenanceType,
    status: input.status,
    odometerReading: input.odometerReading ?? null,
    hourMeterReading: input.hourMeterReading ?? null,
    netAmount: input.netAmount,
    taxAmount: input.taxAmount,
    totalAmount: input.totalAmount,
    documentNumber: input.documentNumber || null,
    documentName: input.documentName || null,
    notes: input.notes || null,
    createdBy: session.user.id,
    updatedAt: now,
  })
  await recordAudit({
    userId: session.user.id,
    action: "create",
    entityType: "maintenance_record",
    entityId: id,
    newState: { ...input, worksiteId },
  })
  return id
}

export async function updateMaintenanceRecord(session: Session, id: string, input: CreateMaintenanceInput) {
  const existing = await db.query.maintenanceRecords.findFirst({ where: eq(maintenanceRecords.id, id) })
  if (!existing) throw new Error("Mantención no encontrada")

  // Debe poder ver la faena actual del registro…
  if (!isGlobalRole(session) && existing.worksiteId && !visibleWorksiteIds(session).includes(existing.worksiteId)) {
    throw new Error("No puedes editar mantenciones de esta faena")
  }

  const vehicle = await db.query.fuelVehicles.findFirst({ where: eq(fuelVehicles.id, input.vehicleId) })
  if (!vehicle) throw new Error("Vehículo no encontrado")

  // …y la faena destino tras la edición.
  const worksiteId = input.worksiteId || vehicle.worksiteId
  if (!isGlobalRole(session) && worksiteId && !visibleWorksiteIds(session).includes(worksiteId)) {
    throw new Error("No puedes asignar mantenciones a esta faena")
  }

  const newState = {
    vehicleId: input.vehicleId,
    supplierId: input.supplierId || null,
    worksiteId,
    costCenterId: input.costCenterId || null,
    maintenanceDate: input.maintenanceDate,
    maintenanceType: input.maintenanceType,
    status: input.status,
    odometerReading: input.odometerReading ?? null,
    hourMeterReading: input.hourMeterReading ?? null,
    netAmount: input.netAmount,
    taxAmount: input.taxAmount,
    totalAmount: input.totalAmount,
    documentNumber: input.documentNumber || null,
    documentName: input.documentName || null,
    notes: input.notes || null,
    updatedAt: new Date().toISOString(),
  }

  await db.update(maintenanceRecords).set(newState).where(eq(maintenanceRecords.id, id))
  await recordAudit({
    userId: session.user.id,
    action: "update",
    entityType: "maintenance_record",
    entityId: id,
    oldState: existing,
    newState,
  })
}

export async function cancelMaintenanceRecord(session: Session, id: string) {
  const existing = await db.query.maintenanceRecords.findFirst({ where: eq(maintenanceRecords.id, id) })
  if (!existing) throw new Error("Mantención no encontrada")
  if (!isGlobalRole(session) && existing.worksiteId && !visibleWorksiteIds(session).includes(existing.worksiteId)) {
    throw new Error("No puedes cancelar mantenciones de esta faena")
  }
  if (existing.status === "cancelled") throw new Error("La mantención ya está cancelada")

  const newState = { status: "cancelled", updatedAt: new Date().toISOString() }
  await db.update(maintenanceRecords)
    .set(newState)
    .where(eq(maintenanceRecords.id, id))
  await recordAudit({
    userId: session.user.id,
    action: "cancel",
    entityType: "maintenance_record",
    entityId: id,
    oldState: existing,
    newState,
  })
}
