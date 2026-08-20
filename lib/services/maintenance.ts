import type { Session } from "next-auth"
import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm"
import { db, type DB, type Tx } from "@/db"
import {
  costCenters,
  fuelOperationRecords,
  fuelVehicles,
  maintenanceRecords,
  preventionCapaEvidence,
  preventionInspectionFindings,
  suppliers,
  worksites,
} from "@/db/schema"
import { canAccessWorksite, visibleWorksiteIds, isGlobalRole, worksiteScopeSql } from "@/lib/auth/scope"
import { recordAudit } from "@/lib/audit"
import { nanoid } from "@/lib/id"
import { addDaysToPlainDate, todayInChile } from "@/lib/utils"

/** Tope del historial de /mantenciones. Exportado para que la página pueda avisar cuando lo alcanza. */
export const MAINTENANCE_HISTORY_LIMIT = 100

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
      limit: MAINTENANCE_HISTORY_LIMIT,
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

  const today = todayInChile()
  const thirtyDays = addDaysToPlainDate(today, 30)

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
export async function getUsageMaintenanceAlerts(session: Session, worksiteId?: string): Promise<UsageMaintenanceAlert[]> {
  // `worksiteId` es la faena elegida en el tablero: se intersecta con el
  // alcance del rol. Las lecturas y mantenciones se cruzan contra los vehículos
  // ya acotados, así que no necesitan predicado propio.
  const vehicleScope = worksiteScopeSql(session, fuelVehicles.worksiteId, worksiteId)

  const vehicles = await db.query.fuelVehicles.findMany({
    where: and(vehicleScope, eq(fuelVehicles.isActive, true)),
    columns: { id: true, plate: true, code: true },
  })
  if (vehicles.length === 0) return []
  const vehicleIds = vehicles.map((vehicle) => vehicle.id)

  // Antes se traían `fuel_operation_records` y `maintenance_records` ENTEROS a
  // memoria (sin filtro de faena ni límite) sólo para quedarse con una fila por
  // equipo. Ahora la reducción "última fila por vehículo" la resuelve Postgres
  // con DISTINCT ON, y sólo sobre los equipos activos visibles.
  const [readings, completedMaintenances] = await Promise.all([
    db.selectDistinctOn([fuelOperationRecords.vehicleId], {
      vehicleId: fuelOperationRecords.vehicleId,
      fecha: fuelOperationRecords.fecha,
      horometro: fuelOperationRecords.horometro,
      medidoPor: fuelOperationRecords.medidoPor,
    })
      .from(fuelOperationRecords)
      .where(and(
        inArray(fuelOperationRecords.vehicleId, vehicleIds),
        isNotNull(fuelOperationRecords.horometro),
        isNotNull(fuelOperationRecords.medidoPor),
      ))
      .orderBy(fuelOperationRecords.vehicleId, desc(fuelOperationRecords.fecha)),
    db.selectDistinctOn([maintenanceRecords.vehicleId], {
      vehicleId: maintenanceRecords.vehicleId,
      maintenanceDate: maintenanceRecords.maintenanceDate,
      odometerReading: maintenanceRecords.odometerReading,
      hourMeterReading: maintenanceRecords.hourMeterReading,
    })
      .from(maintenanceRecords)
      .where(and(eq(maintenanceRecords.status, "completed"), inArray(maintenanceRecords.vehicleId, vehicleIds)))
      .orderBy(maintenanceRecords.vehicleId, desc(maintenanceRecords.maintenanceDate)),
  ])

  const latestReadingByVehicle = new Map<string, { fecha: string; horometro: number; medidoPor: "km" | "hora" }>()
  for (const r of readings) {
    if (!r.vehicleId || r.horometro == null || !r.medidoPor) continue
    latestReadingByVehicle.set(r.vehicleId, { fecha: r.fecha, horometro: r.horometro, medidoPor: r.medidoPor as "km" | "hora" })
  }

  const lastMaintenanceByVehicle = new Map(completedMaintenances.map((m) => [m.vehicleId, m]))

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

/**
 * Escribe la mantención dentro de una transacción existente, **sin** validar
 * alcance: eso lo hace cada puerta antes de llamar.
 *
 * Extraída para que derivar un hallazgo de inspección a mantención ocurra en la
 * misma transacción que crea la CAPA — si el `INSERT` de la mantención falla,
 * no puede quedar una CAPA enlazada a una orden que no existe. Mismo patrón que
 * `createCapaActionWithClient`.
 */
export async function createMaintenanceRecordWithClient(
  client: DB | Tx,
  input: CreateMaintenanceInput & { inspectionFindingId?: string | null },
  args: { worksiteId: string; actorUserId: string },
) {
  const now = new Date().toISOString()
  const id = nanoid()
  await client.insert(maintenanceRecords).values({
    id,
    vehicleId: input.vehicleId,
    supplierId: input.supplierId || null,
    worksiteId: args.worksiteId,
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
    inspectionFindingId: input.inspectionFindingId ?? null,
    createdBy: args.actorUserId,
    updatedAt: now,
  })
  await recordAudit({
    userId: args.actorUserId,
    action: "create",
    entityType: "maintenance_record",
    entityId: id,
    newState: { ...input, worksiteId: args.worksiteId },
  }, client)
  return id
}

export async function createMaintenanceRecord(session: Session, input: CreateMaintenanceInput) {
  const vehicle = await db.query.fuelVehicles.findFirst({ where: eq(fuelVehicles.id, input.vehicleId) })
  if (!vehicle) throw new Error("Vehículo no encontrado")

  const worksiteId = input.worksiteId || vehicle.worksiteId
  if (!isGlobalRole(session) && worksiteId && !visibleWorksiteIds(session).includes(worksiteId)) {
    throw new Error("No puedes registrar mantenciones para esta faena")
  }
  // …y la faena del vehículo: imputar a una faena propia no habilita escribir
  // sobre un equipo de otra.
  if (!canAccessWorksite(session, vehicle.worksiteId)) {
    throw new Error("No puedes registrar mantenciones para este vehículo")
  }

  return createMaintenanceRecordWithClient(db, input, { worksiteId, actorUserId: session.user.id })
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
  // …y la faena del vehículo destino: si no, se puede re-apuntar una mantención
  // propia a un equipo de otra faena.
  if (!canAccessWorksite(session, vehicle.worksiteId)) {
    throw new Error("No puedes asignar mantenciones a este vehículo")
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

  await db.transaction(async (tx) => {
    await tx.update(maintenanceRecords).set(newState).where(eq(maintenanceRecords.id, id))
    if (existing.status !== "completed" && newState.status === "completed") {
      await recordMaintenanceAsCapaEvidence(tx, { record: existing, actorUserId: session.user.id })
    }
    await recordAudit({
      userId: session.user.id,
      action: "update",
      entityType: "maintenance_record",
      entityId: id,
      oldState: existing,
      newState,
    }, tx)
  })
}

/**
 * Cerrar la mantención acredita la acción correctiva que la originó.
 *
 * Sin esto el mecánico repara, cierra la orden en el taller, y su CAPA queda
 * trabada pidiendo evidencia que ya existe en otro módulo: la transición
 * `in_progress → pending_verification` la exige cuando `evidenceRequired`
 * (default `true`) y el conteo **descarta** las de tipo `note`.
 *
 * Se escribe la fila directamente y no vía `addCapaEvidenceWithClient`: ese
 * servicio exige `prevention:capa:complete` al actor, y quien cierra la
 * mantención puede ser un jefe de mantención que no lo tiene. Es evidencia
 * generada por el sistema, no declarada por una persona; acoplarla a un permiso
 * de Prevención rompería el flujo por el lado equivocado.
 */
async function recordMaintenanceAsCapaEvidence(
  client: DB | Tx,
  args: { record: typeof maintenanceRecords.$inferSelect; actorUserId: string },
) {
  if (!args.record.inspectionFindingId) return
  const [finding] = await client.select({ capaActionId: preventionInspectionFindings.capaActionId })
    .from(preventionInspectionFindings)
    .where(eq(preventionInspectionFindings.id, args.record.inspectionFindingId)).limit(1)
  if (!finding?.capaActionId) return
  await client.insert(preventionCapaEvidence).values({
    id: nanoid(),
    actionId: finding.capaActionId,
    kind: "document",
    reference: `mantencion:${args.record.id}`,
    description: `Mantención ${args.record.maintenanceType} completada el ${args.record.maintenanceDate}.`,
    uploadedByUserId: args.actorUserId,
    createdAt: new Date().toISOString(),
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
