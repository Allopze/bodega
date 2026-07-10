import type { Session } from "next-auth"
import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm"
import { db } from "@/db"
import {
  fleetVehicleDocuments,
  fuelLoads,
  fuelOperationRecords,
  fuelVehicles,
  maintenanceRecords,
} from "@/db/schema"
import { nanoid } from "@/lib/id"
import { recordAudit } from "@/lib/audit"
import { isGlobalRole, visibleWorksiteIds } from "@/lib/auth/scope"

export async function getFleetOverview(session: Session) {
  const scopedWorksites = isGlobalRole(session) ? null : visibleWorksiteIds(session)
  const vehicleScope = scopedWorksites === null
    ? undefined
    : scopedWorksites.length > 0
      ? inArray(fuelVehicles.worksiteId, scopedWorksites)
      : sql`false`

  const sinceDate = new Date()
  sinceDate.setFullYear(sinceDate.getFullYear() - 1)
  const since = sinceDate.toISOString()

  const [vehicles, fuelRows, maintenanceRows] = await Promise.all([
    db.query.fuelVehicles.findMany({
      where: vehicleScope,
      with: { worksite: true, responsibleUser: true },
      orderBy: [fuelVehicles.plate],
    }),
    db
      .select({
        vehicleId: fuelLoads.vehicleId,
        totalFuelAmount: sql<number>`COALESCE(SUM(${fuelLoads.totalAmount}), 0)`,
        totalLiters: sql<number>`COALESCE(SUM(${fuelLoads.liters}), 0)`,
        loadCount: sql<number>`COUNT(*)`,
        lastOdometerReading: sql<number>`MAX(${fuelLoads.odometerReading}) FILTER (WHERE ${fuelLoads.odometerReading} IS NOT NULL)`,
        lastHourMeterReading: sql<number>`MAX(${fuelLoads.hourMeterReading}) FILTER (WHERE ${fuelLoads.hourMeterReading} IS NOT NULL)`,
      })
      .from(fuelLoads)
      .where(and(
        sql`${fuelLoads.loadDate} >= ${since.slice(0, 10)}`,
        scopedWorksites === null ? undefined : scopedWorksites.length > 0 ? inArray(fuelLoads.worksiteId, scopedWorksites) : sql`false`,
      ))
      .groupBy(fuelLoads.vehicleId),
    db
      .select({
        vehicleId: maintenanceRecords.vehicleId,
        totalMaintenanceAmount: sql<number>`COALESCE(SUM(${maintenanceRecords.totalAmount}), 0)`,
        maintenanceCount: sql<number>`COUNT(*)`,
        lastMaintenanceDate: sql<string>`MAX(${maintenanceRecords.maintenanceDate})`,
      })
      .from(maintenanceRecords)
      .where(and(
        sql`${maintenanceRecords.maintenanceDate} >= ${since.slice(0, 10)}`,
        sql`${maintenanceRecords.status} <> 'cancelled'`,
        scopedWorksites === null ? undefined : scopedWorksites.length > 0 ? inArray(maintenanceRecords.worksiteId, scopedWorksites) : sql`false`,
      ))
      .groupBy(maintenanceRecords.vehicleId),
  ])

  const fuelByVehicle = new Map(fuelRows.map((row) => [row.vehicleId, row]))
  const maintenanceByVehicle = new Map(maintenanceRows.map((row) => [row.vehicleId, row]))

  return vehicles.map((vehicle) => {
    const fuel = fuelByVehicle.get(vehicle.id)
    const maintenance = maintenanceByVehicle.get(vehicle.id)
    const totalFuelAmount = Number(fuel?.totalFuelAmount ?? 0)
    const totalMaintenanceAmount = Number(maintenance?.totalMaintenanceAmount ?? 0)
    return {
      id: vehicle.id,
      plate: vehicle.plate,
      type: vehicle.type,
      brand: vehicle.brand,
      model: vehicle.model,
      year: vehicle.year,
      isActive: vehicle.isActive,
      operationalStatus: vehicle.operationalStatus,
      worksiteName: vehicle.worksite?.name ?? "Sin faena",
      responsibleName: vehicle.responsibleUser?.name ?? vehicle.responsibleUser?.email ?? null,
      soapExpiresAt: vehicle.soapExpiresAt,
      technicalReviewExpiresAt: vehicle.technicalReviewExpiresAt,
      circulationPermitExpiresAt: vehicle.circulationPermitExpiresAt,
      insurancePolicyNumber: vehicle.insurancePolicyNumber,
      insuranceExpiresAt: vehicle.insuranceExpiresAt,
      nextExpiryDate: getNextExpiryDate([
        vehicle.soapExpiresAt,
        vehicle.technicalReviewExpiresAt,
        vehicle.circulationPermitExpiresAt,
        vehicle.insuranceExpiresAt,
      ]),
      totalFuelAmount,
      totalMaintenanceAmount,
      totalOperationalCost: totalFuelAmount + totalMaintenanceAmount,
      totalLiters: Number(fuel?.totalLiters ?? 0),
      loadCount: Number(fuel?.loadCount ?? 0),
      maintenanceCount: Number(maintenance?.maintenanceCount ?? 0),
      lastMaintenanceDate: maintenance?.lastMaintenanceDate ?? null,
      lastOdometerReading: fuel?.lastOdometerReading == null ? null : Number(fuel.lastOdometerReading),
      lastHourMeterReading: fuel?.lastHourMeterReading == null ? null : Number(fuel.lastHourMeterReading),
    }
  })
}

export async function getFleetVehicleDetail(session: Session, id: string) {
  const scopedWorksites = isGlobalRole(session) ? null : visibleWorksiteIds(session)
  const vehicle = await db.query.fuelVehicles.findFirst({
    where: eq(fuelVehicles.id, id),
    with: { worksite: true, responsibleUser: true },
  })
  if (!vehicle) return null
  if (scopedWorksites !== null && !scopedWorksites.includes(vehicle.worksiteId)) {
    return null
  }

  const [documents, recentLoads, recentMaintenance, recentOperations, operatorCounts] = await Promise.all([
    db.query.fleetVehicleDocuments.findMany({
      where: eq(fleetVehicleDocuments.vehicleId, id),
      orderBy: [fleetVehicleDocuments.expiresAt],
    }),
    db.query.fuelLoads.findMany({
      where: eq(fuelLoads.vehicleId, id),
      orderBy: [fuelLoads.loadDate],
      limit: 10,
    }),
    db.query.maintenanceRecords.findMany({
      where: eq(maintenanceRecords.vehicleId, id),
      orderBy: [maintenanceRecords.maintenanceDate],
      limit: 10,
    }),
    // Log operacional de combustible: fecha real por carga (a diferencia de
    // fuelLoads, que solo trae odómetro/horómetro cuando se digitó a mano).
    db.query.fuelOperationRecords.findMany({
      where: eq(fuelOperationRecords.vehicleId, id),
      orderBy: [desc(fuelOperationRecords.fecha)],
      limit: 20,
    }),
    db
      .select({ operador: fuelOperationRecords.operador, count: sql<number>`COUNT(*)` })
      .from(fuelOperationRecords)
      .where(and(eq(fuelOperationRecords.vehicleId, id), isNotNull(fuelOperationRecords.operador)))
      .groupBy(fuelOperationRecords.operador)
      .orderBy(desc(sql`COUNT(*)`))
      .limit(5),
  ])

  return {
    vehicle,
    documents,
    recentLoads,
    recentMaintenance,
    // Última lectura de horómetro/odómetro con fecha real, y los operadores
    // más frecuentes — derivados del log operacional de combustible.
    currentReading: recentOperations[0] ?? null,
    recentOperations,
    topOperators: operatorCounts.map((o) => ({ operador: o.operador!, count: Number(o.count) })),
    nextExpiryDate: getNextExpiryDate([
      vehicle.soapExpiresAt,
      vehicle.technicalReviewExpiresAt,
      vehicle.circulationPermitExpiresAt,
      vehicle.insuranceExpiresAt,
      ...documents.map((document) => document.expiresAt),
    ]),
  }
}

function getNextExpiryDate(values: Array<string | null | undefined>) {
  return values
    .filter((value): value is string => Boolean(value))
    .sort((a, b) => a.localeCompare(b))[0] ?? null
}

/* ── Document management ────────────────────────────────────────────────────── */

export interface UploadFleetDocumentInput {
  vehicleId: string
  documentType: string
  fileName: string
  filePath: string
  fileSize: number
  mimeType: string
  expiresAt?: string | null
}

export async function uploadFleetDocument(
  input: UploadFleetDocumentInput,
  session: Session,
  worksiteIds: string[] | "all",
): Promise<string> {
  if (!input.vehicleId) throw new Error("Vehículo requerido")
  if (!input.documentType) throw new Error("Tipo de documento requerido")
  if (!input.fileName || !input.filePath) throw new Error("Archivo requerido")

  const vehicle = await db.query.fuelVehicles.findFirst({
    where: eq(fuelVehicles.id, input.vehicleId),
    columns: { id: true, worksiteId: true },
  })
  if (!vehicle) throw new Error("Vehículo no encontrado")
  if (worksiteIds !== "all" && !worksiteIds.includes(vehicle.worksiteId)) {
    throw new Error("Sin acceso a la faena de este vehículo")
  }

  const docId = nanoid()
  await db.insert(fleetVehicleDocuments).values({
    id: docId,
    vehicleId: input.vehicleId,
    documentType: input.documentType,
    fileName: input.fileName,
    filePath: input.filePath,
    fileSize: input.fileSize,
    mimeType: input.mimeType,
    expiresAt: input.expiresAt ?? null,
    uploadedBy: session.user.id,
  })

  await recordAudit({
    userId: session.user.id,
    userEmail: session.user.email ?? undefined,
    action: "create",
    entityType: "fleet_document",
    entityId: docId,
    newState: { vehicleId: input.vehicleId, documentType: input.documentType, fileName: input.fileName },
  })

  return docId
}

export async function deleteFleetDocument(
  documentId: string,
  session: Session,
  worksiteIds: string[] | "all",
): Promise<void> {
  const document = await db.query.fleetVehicleDocuments.findFirst({
    where: eq(fleetVehicleDocuments.id, documentId),
  })
  if (!document) throw new Error("Documento no encontrado")

  const vehicle = await db.query.fuelVehicles.findFirst({
    where: eq(fuelVehicles.id, document.vehicleId),
    columns: { id: true, worksiteId: true },
  })
  if (!vehicle) throw new Error("Vehículo no encontrado")
  if (worksiteIds !== "all" && !worksiteIds.includes(vehicle.worksiteId)) {
    throw new Error("Sin acceso a la faena de este vehículo")
  }

  await db.delete(fleetVehicleDocuments).where(eq(fleetVehicleDocuments.id, documentId))

  await recordAudit({
    userId: session.user.id,
    userEmail: session.user.email ?? undefined,
    action: "delete",
    entityType: "fleet_document",
    entityId: documentId,
    oldState: { vehicleId: document.vehicleId, documentType: document.documentType, fileName: document.fileName },
  })
}
