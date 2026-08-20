import type { Session } from "next-auth"
import { promises as fs } from "node:fs"
import { and, desc, eq, isNotNull, isNull, sql } from "drizzle-orm"
import { db, type DB, type Tx } from "@/db"
import {
  fleetVehicleDocuments,
  fuelLoads,
  fuelOperationRecords,
  fuelVehicleOperationalIntervals,
  fuelVehicles,
  maintenanceRecords,
} from "@/db/schema"
import { nanoid } from "@/lib/id"
import { recordAudit } from "@/lib/audit"
import { isGlobalRole, visibleWorksiteIds, worksiteScopeSql } from "@/lib/auth/scope"
import { resolveFleetDocumentFile } from "@/lib/storage/config"

/**
 * Equipos de una faena, para poblar selectores.
 *
 * Recibe una faena **ya autorizada**: el alcance de rol lo resuelve el
 * llamador, porque los dos consumidores hablan monedas distintas —las
 * pantallas de flota traen `Session` y `worksiteScopeSql`, el motor de
 * inspecciones trae `InspectionAccess` y ya llamó a `requireAccess` con esta
 * misma faena antes de llegar aquí. Bridgear ambas cuesta más código que la
 * consulta misma.
 *
 * Existía inlineada en ~8 sitios (`lib/services/maintenance.ts`,
 * `app/(app)/combustibles/…`, la ejecución de PDTP); acá queda extraída para
 * los nuevos. Migrar los demás se hace cuando se toquen, no ahora.
 */
export async function listWorksiteVehicles(args: { worksiteId: string; activeOnly?: boolean }) {
  const conditions = [eq(fuelVehicles.worksiteId, args.worksiteId)]
  if (args.activeOnly !== false) conditions.push(eq(fuelVehicles.isActive, true))
  return db.select({
    id: fuelVehicles.id,
    plate: fuelVehicles.plate,
    code: fuelVehicles.code,
    type: fuelVehicles.type,
    meterType: fuelVehicles.meterType,
    operationalStatus: fuelVehicles.operationalStatus,
  })
    .from(fuelVehicles)
    .where(and(...conditions))
    .orderBy(fuelVehicles.plate)
}

/**
 * Cambia el estado operacional de un equipo manteniendo coherente su historial
 * de intervalos: cierra el abierto y abre el nuevo.
 *
 * Extraída porque estaba inlineada tres veces en
 * `app/(app)/combustibles/actions-module/vehicles.ts` (alta, edición y baja), y
 * el índice único parcial `fuel_vehicle_operational_intervals` garantiza **un
 * solo intervalo abierto por vehículo**: olvidar el cierre en una cuarta copia
 * revienta con violación de unicidad, no con un dato raro.
 *
 * No valida permisos: la puerta la pone cada llamador.
 */
export async function setVehicleOperationalStatus(
  client: DB | Tx,
  args: { vehicleId: string; status: string; reason: string; actorUserId: string },
) {
  const changedAt = new Date().toISOString()
  await client.update(fuelVehicles)
    .set({ operationalStatus: args.status, updatedAt: changedAt })
    .where(eq(fuelVehicles.id, args.vehicleId))
  await client.update(fuelVehicleOperationalIntervals)
    .set({ endedAt: changedAt })
    .where(and(
      eq(fuelVehicleOperationalIntervals.vehicleId, args.vehicleId),
      isNull(fuelVehicleOperationalIntervals.endedAt),
    ))
  await client.insert(fuelVehicleOperationalIntervals).values({
    id: nanoid(),
    vehicleId: args.vehicleId,
    status: args.status,
    startedAt: changedAt,
    reason: args.reason,
    changedBy: args.actorUserId,
  })
}

/** Etiqueta estable de un equipo para congelar como evidencia: "KA-122 · ABCD-12". */
export function vehicleLabel(vehicle: { plate: string; code: string | null }) {
  return vehicle.code ? `${vehicle.code} · ${vehicle.plate}` : vehicle.plate
}

// `worksiteId` es la faena elegida en el tablero: se intersecta con el alcance
// del rol (nunca lo reemplaza). Los llamadores sin selector de faena (/flota)
// lo omiten y conservan el alcance del rol tal cual.
export async function getFleetOverview(session: Session, worksiteId?: string) {
  const vehicleScope = worksiteScopeSql(session, fuelVehicles.worksiteId, worksiteId)

  const sinceDate = new Date()
  sinceDate.setFullYear(sinceDate.getFullYear() - 1)
  const since = sinceDate.toISOString()

  const [vehicles, fuelRows, maintenanceRows, documentExpiryRows] = await Promise.all([
    db.query.fuelVehicles.findMany({
      where: vehicleScope,
      with: { worksite: true, responsibleUser: true, equipmentType: true, usualFuelSupplier: true },
      orderBy: [fuelVehicles.plate],
    }),
    db
      .select({
        vehicleId: fuelLoads.vehicleId,
        totalFuelAmount: sql<number>`COALESCE(SUM(${fuelLoads.totalAmount}), 0)`,
        totalLiters: sql<number>`COALESCE(SUM(${fuelLoads.liters}), 0)`,
        loadCount: sql<number>`COUNT(*)`,
        lastOdometerReading: sql<number>`MAX(${fuelLoads.odometerReading}) FILTER (WHERE ${fuelLoads.odometerReading} IS NOT NULL)`,
        firstOdometerReading: sql<number>`MIN(${fuelLoads.odometerReading}) FILTER (WHERE ${fuelLoads.odometerReading} IS NOT NULL)`,
        lastHourMeterReading: sql<number>`MAX(${fuelLoads.hourMeterReading}) FILTER (WHERE ${fuelLoads.hourMeterReading} IS NOT NULL)`,
        firstHourMeterReading: sql<number>`MIN(${fuelLoads.hourMeterReading}) FILTER (WHERE ${fuelLoads.hourMeterReading} IS NOT NULL)`,
      })
      .from(fuelLoads)
      .where(and(
        sql`${fuelLoads.loadDate} >= ${since.slice(0, 10)}`,
        worksiteScopeSql(session, fuelLoads.worksiteId, worksiteId),
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
        worksiteScopeSql(session, maintenanceRecords.worksiteId, worksiteId),
      ))
      .groupBy(maintenanceRecords.vehicleId),
    // El detalle del vehículo incluye los documentos subidos en su "próximo
    // vencimiento" (ver `getFleetVehicleDetail`); el listado los ignoraba, así
    // que un seguro cargado como documento no aparecía ni en la columna ni en
    // el banner de vencidos de /flota.
    db
      .select({
        vehicleId: fleetVehicleDocuments.vehicleId,
        nextExpiry: sql<string | null>`MIN(${fleetVehicleDocuments.expiresAt})`,
      })
      .from(fleetVehicleDocuments)
      .where(isNotNull(fleetVehicleDocuments.expiresAt))
      .groupBy(fleetVehicleDocuments.vehicleId),
  ])

  const fuelByVehicle = new Map(fuelRows.map((row) => [row.vehicleId, row]))
  const maintenanceByVehicle = new Map(maintenanceRows.map((row) => [row.vehicleId, row]))
  const documentExpiryByVehicle = new Map(documentExpiryRows.map((row) => [row.vehicleId, row.nextExpiry]))

  return vehicles.map((vehicle) => {
    const fuel = fuelByVehicle.get(vehicle.id)
    const maintenance = maintenanceByVehicle.get(vehicle.id)
    const totalFuelAmount = Number(fuel?.totalFuelAmount ?? 0)
    const totalMaintenanceAmount = Number(maintenance?.totalMaintenanceAmount ?? 0)
    const totalOperationalCost = totalFuelAmount + totalMaintenanceAmount
    const firstOdometer = fuel?.firstOdometerReading == null ? null : Number(fuel.firstOdometerReading)
    const lastOdometer = fuel?.lastOdometerReading == null ? null : Number(fuel.lastOdometerReading)
    const firstHourMeter = fuel?.firstHourMeterReading == null ? null : Number(fuel.firstHourMeterReading)
    const lastHourMeter = fuel?.lastHourMeterReading == null ? null : Number(fuel.lastHourMeterReading)
    // Costo operacional (combustible + mantención) por unidad de uso, sólo con la unidad
    // canónica del equipo (sección 2) y al menos dos lecturas distintas en el período —
    // con una sola carga no hay recorrido/uso que dividir.
    const kmDriven = vehicle.performanceUnit === "km_per_liter" && firstOdometer != null && lastOdometer != null && lastOdometer > firstOdometer
      ? lastOdometer - firstOdometer : null
    const hoursRun = vehicle.performanceUnit === "liters_per_hour" && firstHourMeter != null && lastHourMeter != null && lastHourMeter > firstHourMeter
      ? lastHourMeter - firstHourMeter : null
    return {
      id: vehicle.id,
      plate: vehicle.plate,
      type: vehicle.equipmentType?.name ?? vehicle.type,
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
        documentExpiryByVehicle.get(vehicle.id) ?? null,
      ]),
      totalFuelAmount,
      totalMaintenanceAmount,
      totalOperationalCost,
      totalLiters: Number(fuel?.totalLiters ?? 0),
      loadCount: Number(fuel?.loadCount ?? 0),
      maintenanceCount: Number(maintenance?.maintenanceCount ?? 0),
      lastMaintenanceDate: maintenance?.lastMaintenanceDate ?? null,
      lastOdometerReading: lastOdometer,
      lastHourMeterReading: lastHourMeter,
      kmDriven,
      hoursRun,
      costPerKm: kmDriven ? totalOperationalCost / kmDriven : null,
      costPerHour: hoursRun ? totalOperationalCost / hoursRun : null,
    }
  })
}

export async function getFleetVehicleDetail(session: Session, id: string) {
  const scopedWorksites = isGlobalRole(session) ? null : visibleWorksiteIds(session)
  const vehicle = await db.query.fuelVehicles.findFirst({
    where: eq(fuelVehicles.id, id),
    with: { worksite: true, responsibleUser: true, equipmentType: true, usualFuelSupplier: true },
  })
  if (!vehicle) return null
  if (scopedWorksites !== null && !scopedWorksites.includes(vehicle.worksiteId)) {
    return null
  }

  const [documents, recentMaintenance, recentOperations, operatorCounts, operationalIntervals] = await Promise.all([
    db.query.fleetVehicleDocuments.findMany({
      where: eq(fleetVehicleDocuments.vehicleId, id),
      orderBy: [fleetVehicleDocuments.expiresAt],
    }),
    // De la más reciente a la más antigua: con `limit: 10` el orden ascendente
    // devolvía el tramo más viejo del historial y la última mantención del
    // vehículo quedaba fuera de la tarjeta. `maintenance_date` es sólo fecha,
    // así que se desempata por `createdAt` igual que el listado de mantenciones.
    db.query.maintenanceRecords.findMany({
      where: eq(maintenanceRecords.vehicleId, id),
      orderBy: [desc(maintenanceRecords.maintenanceDate), desc(maintenanceRecords.createdAt)],
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
    db.query.fuelVehicleOperationalIntervals.findMany({
      where: eq(fuelVehicleOperationalIntervals.vehicleId, id),
      with: { changedByUser: { columns: { name: true, email: true } } },
      orderBy: [desc(fuelVehicleOperationalIntervals.startedAt)],
      limit: 25,
    }),
  ])

  // Comparar rendimiento 30 días antes/después de cada mantención (sección 13).
  // Consulta aparte por registro (a lo más 10, límite de `recentMaintenance`
  // arriba) en vez de derivarlo de `recentOperations`: ese array ya viene
  // acotado a las 20 lecturas más recientes del vehículo, así que para
  // mantenciones antiguas no cubriría la ventana de comparación completa.
  const maintenanceConsumptionImpact = await Promise.all(
    recentMaintenance.filter((m) => m.status !== "cancelled").map(async (m) => {
      const [row] = await db.select({
        avgBefore: sql<number | null>`avg(${fuelOperationRecords.rendimiento}) filter (where ${fuelOperationRecords.fecha} >= (${m.maintenanceDate}::date - interval '30 days')::text and ${fuelOperationRecords.fecha} < ${m.maintenanceDate})`,
        avgAfter: sql<number | null>`avg(${fuelOperationRecords.rendimiento}) filter (where ${fuelOperationRecords.fecha} > ${m.maintenanceDate} and ${fuelOperationRecords.fecha} <= (${m.maintenanceDate}::date + interval '30 days')::text)`,
      }).from(fuelOperationRecords).where(and(eq(fuelOperationRecords.vehicleId, id), isNotNull(fuelOperationRecords.rendimiento)))
      return {
        maintenanceId: m.id, maintenanceDate: m.maintenanceDate, maintenanceType: m.maintenanceType,
        avgBefore: row?.avgBefore != null ? Number(row.avgBefore) : null,
        avgAfter: row?.avgAfter != null ? Number(row.avgAfter) : null,
      }
    }),
  )

  return {
    vehicle,
    documents,
    recentMaintenance,
    maintenanceConsumptionImpact,
    // Última lectura de horómetro/odómetro con fecha real, y los operadores
    // más frecuentes — derivados del log operacional de combustible.
    currentReading: recentOperations[0] ?? null,
    recentOperations,
    topOperators: operatorCounts.map((o) => ({ operador: o.operador!, count: Number(o.count) })),
    operationalIntervals,
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

  // El archivo quedaba en disco para siempre: sólo se borraba la fila. Se
  // elimina después del DELETE y sin propagar el error — la fila ya no existe,
  // un archivo huérfano no debe hacer fallar la acción.
  const absolutePath = resolveFleetDocumentFile(document.filePath)
  if (absolutePath) await fs.unlink(absolutePath).catch(() => undefined)

  await recordAudit({
    userId: session.user.id,
    userEmail: session.user.email ?? undefined,
    action: "delete",
    entityType: "fleet_document",
    entityId: documentId,
    oldState: { vehicleId: document.vehicleId, documentType: document.documentType, fileName: document.fileName },
  })
}
