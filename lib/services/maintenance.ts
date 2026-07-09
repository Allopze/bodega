import type { Session } from "next-auth"
import { and, desc, eq, inArray, sql } from "drizzle-orm"
import { db } from "@/db"
import {
  costCenters,
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
