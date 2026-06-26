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

export async function createMaintenanceRecord(session: Session, input: CreateMaintenanceInput) {
  const vehicle = await db.query.fuelVehicles.findFirst({ where: eq(fuelVehicles.id, input.vehicleId) })
  if (!vehicle) throw new Error("Vehículo no encontrado")

  const worksiteId = input.worksiteId || vehicle.worksiteId || null
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
  return id
}
