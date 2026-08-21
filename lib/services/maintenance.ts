import type { Session } from "next-auth"
import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm"
import { db, type DB, type Tx } from "@/db"
import {
  costCenters,
  fuelOperationRecords,
  fuelVehicles,
  maintenanceRecords,
  preventionCapaEvidence,
  preventionCapaTransitions,
  preventionInspectionFindings,
  suppliers,
  worksites,
} from "@/db/schema"
import { canAccessWorksite, visibleWorksiteIds, isGlobalRole, worksiteScopeSql } from "@/lib/auth/scope"
import { assertCostCenterAllowed, costCenterOptionsWhere } from "@/lib/services/cost-centers"
import { recordAudit } from "@/lib/audit"
import { nanoid } from "@/lib/id"
import { addDaysToPlainDate, todayInChile } from "@/lib/utils"
import { can } from "@/lib/auth/can"

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
  costCenterId?: string | null
  maintenanceDate: string
  maintenanceType: string
  status: "scheduled" | "in_progress"
  odometerReading?: number | null
  hourMeterReading?: number | null
  netAmount: number
  taxAmount: number
  totalAmount: number
  documentNumber?: string | null
  documentName?: string | null
  notes?: string | null
}

export type UpdateMaintenanceInput = Omit<CreateMaintenanceInput, "status">
export type MaintenanceTransition = "start" | "complete" | "reopen" | "cancel"

export async function getMaintenancePageData(session: Session, filters: MaintenanceFilters = {}) {
  const canViewCosts = can(session, "mantenciones:view") && can(session, "combustibles:view_costs")
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

  const [recordRows, vehicles, supplierRows, worksiteRows, costCenterRows] = await Promise.all([
    db.query.maintenanceRecords.findMany({
      where,
      columns: {
        id: true,
        vehicleId: true,
        supplierId: true,
        worksiteId: true,
        costCenterId: true,
        maintenanceDate: true,
        maintenanceType: true,
        status: true,
        odometerReading: true,
        hourMeterReading: true,
        netAmount: canViewCosts,
        taxAmount: canViewCosts,
        totalAmount: canViewCosts,
        documentNumber: true,
        documentName: true,
        documentPath: true,
        documentMimeType: true,
        notes: true,
        inspectionFindingId: true,
        createdAt: true,
        updatedAt: true,
      },
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
    // Los centros de costo tienen faena. Ofrecer el catálogo completo dejaba
    // imputar el gasto de una faena al centro de otra, y mostraba la estructura
    // de costos de faenas ajenas a un rol acotado. Los de `worksite_id NULL`
    // son transversales y sí están disponibles para todos.
    db.query.costCenters.findMany({
      where: costCenterOptionsWhere(scopedWorksites),
      orderBy: [costCenters.code],
    }),
  ])
  const redactAmount = (value: unknown) =>
    canViewCosts && typeof value === "number" ? value : null
  const records = recordRows.map((record) => ({
    ...record,
    netAmount: redactAmount((record as { netAmount?: unknown }).netAmount),
    taxAmount: redactAmount((record as { taxAmount?: unknown }).taxAmount),
    totalAmount: redactAmount((record as { totalAmount?: unknown }).totalAmount),
  }))

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
    columns: {
      id: true,
      vehicleId: true,
      worksiteId: true,
      maintenanceDate: true,
      maintenanceType: true,
      status: true,
    },
    with: { vehicle: { columns: { id: true, plate: true } } },
    orderBy: [maintenanceRecords.maintenanceDate],
    limit: 50,
  })

  const overdue = await db.query.maintenanceRecords.findMany({
    where: and(
      worksiteScope,
      eq(maintenanceRecords.status, "scheduled"),
      sql`${maintenanceRecords.maintenanceDate} < ${today}`,
    ),
    columns: {
      id: true,
      vehicleId: true,
      worksiteId: true,
      maintenanceDate: true,
      maintenanceType: true,
      status: true,
    },
    with: { vehicle: { columns: { id: true, plate: true } } },
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
 * Faena efectiva de una mantención: **siempre** la del vehículo.
 *
 * Antes el llamador podía imputar la mantención a cualquier faena, así que el
 * gasto de un equipo de una faena podía quedar contado en otra: /flota agrega
 * por la faena del registro y el listado también, de modo que el mismo servicio
 * aparecía o desaparecía según la superficie. La faena propietaria del activo
 * gobierna el alcance; el destino contable se expresa con el centro de costo.
 */
async function resolveMaintenanceVehicle(client: DB | Tx, vehicleId: string) {
  const [vehicle] = await client
    .select({ id: fuelVehicles.id, worksiteId: fuelVehicles.worksiteId, isActive: fuelVehicles.isActive })
    .from(fuelVehicles)
    .where(eq(fuelVehicles.id, vehicleId))
    .limit(1)
  if (!vehicle) throw new Error("Vehículo no encontrado")
  return vehicle
}

/**
 * Faena con la que se decide el alcance de un registro existente. Mientras
 * queden filas históricas sin faena, se resuelve por el vehículo en vez de
 * dejar pasar la comprobación.
 */
async function effectiveWorksiteId(
  client: DB | Tx,
  record: { vehicleId?: string; worksiteId: string | null },
): Promise<string> {
  if (record.worksiteId) return record.worksiteId
  if (!record.vehicleId) throw new Error("Mantención sin faena ni vehículo resoluble")
  return (await resolveMaintenanceVehicle(client, record.vehicleId)).worksiteId
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
  args: { actorUserId: string; vehicle?: { worksiteId: string } },
) {
  // El llamador que ya resolvió el equipo para validar alcance pasa esa misma
  // lectura: así la faena autorizada y la escrita no pueden diferir.
  const worksiteId = args.vehicle?.worksiteId
    ?? (await resolveMaintenanceVehicle(client, input.vehicleId)).worksiteId
  if (input.costCenterId) await assertCostCenterAllowed(client, input.costCenterId, worksiteId)
  const now = new Date().toISOString()
  const id = nanoid()
  await client.insert(maintenanceRecords).values({
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
    inspectionFindingId: input.inspectionFindingId ?? null,
    createdBy: args.actorUserId,
    updatedAt: now,
  })
  await recordAudit({
    userId: args.actorUserId,
    action: "create",
    entityType: "maintenance_record",
    entityId: id,
    newState: { ...input, worksiteId },
  }, client)
  return id
}

export async function createMaintenanceRecord(session: Session, input: CreateMaintenanceInput) {
  if (!can(session, "mantenciones:create")) throw new Error("Sin permisos para registrar mantenciones")
  const authorizedInput = can(session, "mantenciones:create") && can(session, "combustibles:view_costs")
    ? input
    : { ...input, netAmount: 0, taxAmount: 0, totalAmount: 0 }

  // Alta, validación y auditoría en una transacción: el equipo se lee una vez
  // y la fila no puede quedar escrita sin su traza.
  return db.transaction(async (tx) => {
    const vehicle = await resolveMaintenanceVehicle(tx, input.vehicleId)
    // La faena del vehículo es la del registro, así que basta con validarla una vez.
    if (!canAccessWorksite(session, vehicle.worksiteId)) {
      throw new Error("No puedes registrar mantenciones para este vehículo")
    }
    return createMaintenanceRecordWithClient(tx, authorizedInput, { actorUserId: session.user.id, vehicle })
  })
}

export async function updateMaintenanceRecord(session: Session, id: string, input: UpdateMaintenanceInput) {
  if (!can(session, "mantenciones:edit")) throw new Error("Sin permisos para editar mantenciones")
  const canViewCosts = can(session, "mantenciones:edit") && can(session, "combustibles:view_costs")

  await db.transaction(async (tx) => {
    const vehicle = await resolveMaintenanceVehicle(tx, input.vehicleId)
    // La faena del vehículo destino manda: si no se valida, se puede re-apuntar
    // una mantención propia a un equipo de otra faena.
    if (!canAccessWorksite(session, vehicle.worksiteId)) {
      throw new Error("No puedes asignar mantenciones a este vehículo")
    }
    const worksiteId = vehicle.worksiteId
    const [existing] = await tx.select({
      id: maintenanceRecords.id,
      vehicleId: maintenanceRecords.vehicleId,
      worksiteId: maintenanceRecords.worksiteId,
      costCenterId: maintenanceRecords.costCenterId,
      status: maintenanceRecords.status,
      inspectionFindingId: maintenanceRecords.inspectionFindingId,
      maintenanceType: maintenanceRecords.maintenanceType,
      maintenanceDate: maintenanceRecords.maintenanceDate,
      ...(canViewCosts ? {
        netAmount: maintenanceRecords.netAmount,
        taxAmount: maintenanceRecords.taxAmount,
        totalAmount: maintenanceRecords.totalAmount,
      } : {}),
    }).from(maintenanceRecords).where(eq(maintenanceRecords.id, id)).for("update").limit(1)
    if (!existing) throw new Error("Mantención no encontrada")
    if (!["scheduled", "in_progress"].includes(existing.status)) {
      throw new Error("Reabre la mantención antes de editar sus datos")
    }
    // `canAccessWorksite` y no una comprobación condicional: una mantención
    // histórica sin faena resuelta no puede quedar editable por cualquiera.
    if (!canAccessWorksite(session, await effectiveWorksiteId(tx, existing))) {
      throw new Error("No puedes editar mantenciones de esta faena")
    }
    // Sólo se revalida una imputación NUEVA. Un registro heredado cuyo centro
    // quedó inactivo o pasó a otra faena seguiría siendo editable en todo lo
    // demás; bloquearlo dejaría filas visibles e inmutables sin remedio en la UI.
    if (input.costCenterId && input.costCenterId !== existing.costCenterId) {
      await assertCostCenterAllowed(tx, input.costCenterId, worksiteId)
    }

    const operationalState = {
      vehicleId: input.vehicleId,
      supplierId: input.supplierId || null,
      worksiteId,
      costCenterId: input.costCenterId || null,
      maintenanceDate: input.maintenanceDate,
      maintenanceType: input.maintenanceType,
      odometerReading: input.odometerReading ?? null,
      hourMeterReading: input.hourMeterReading ?? null,
      documentNumber: input.documentNumber || null,
      documentName: input.documentName || null,
      notes: input.notes || null,
      updatedAt: new Date().toISOString(),
    }
    const newState = canViewCosts
      ? { ...operationalState, netAmount: input.netAmount, taxAmount: input.taxAmount, totalAmount: input.totalAmount }
      : operationalState

    await tx.update(maintenanceRecords).set(newState).where(eq(maintenanceRecords.id, id))
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
async function activateMaintenanceCapaEvidence(
  client: Tx,
  args: {
    record: Pick<
      typeof maintenanceRecords.$inferSelect,
      "id" | "inspectionFindingId" | "maintenanceType" | "maintenanceDate"
    >
    actorUserId: string
  },
) {
  if (!args.record.inspectionFindingId) return
  const [finding] = await client.select({ capaActionId: preventionInspectionFindings.capaActionId })
    .from(preventionInspectionFindings)
    .where(eq(preventionInspectionFindings.id, args.record.inspectionFindingId)).limit(1)
  if (!finding?.capaActionId) return
  const now = new Date().toISOString()
  const [evidence] = await client.insert(preventionCapaEvidence).values({
    id: nanoid(),
    actionId: finding.capaActionId,
    kind: "document",
    reference: `mantencion:${args.record.id}`,
    description: `Evidencia automática de la mantención ${args.record.maintenanceType} programada para el ${args.record.maintenanceDate}.`,
    uploadedByUserId: args.actorUserId,
    status: "active",
    createdAt: now,
  }).onConflictDoUpdate({
    target: [preventionCapaEvidence.actionId, preventionCapaEvidence.reference],
    set: {
      kind: "document",
      description: `Evidencia automática de la mantención ${args.record.maintenanceType} programada para el ${args.record.maintenanceDate}.`,
      checksumSha256: null,
      uploadedByUserId: args.actorUserId,
      status: "active",
      supersededAt: null,
      supersededByUserId: null,
      supersessionReason: null,
      createdAt: now,
    },
  }).returning({ id: preventionCapaEvidence.id })
  if (!evidence) throw new Error("No se pudo acreditar la mantención en CAPA")
  await client.insert(preventionCapaTransitions).values({
    id: `capat-${nanoid()}`,
    actionId: finding.capaActionId,
    changeType: "evidence",
    reason: "Evidencia de mantención activada",
    changeSet: { evidenceId: evidence.id, lifecycle: "activated", maintenanceId: args.record.id },
    actorUserId: args.actorUserId,
    createdAt: now,
  })
}

async function supersedeMaintenanceCapaEvidence(
  client: Tx,
  args: {
    record: Pick<typeof maintenanceRecords.$inferSelect, "id" | "inspectionFindingId">
    actorUserId: string
    reason: string
  },
) {
  if (!args.record.inspectionFindingId) return
  const [finding] = await client.select({ capaActionId: preventionInspectionFindings.capaActionId })
    .from(preventionInspectionFindings)
    .where(eq(preventionInspectionFindings.id, args.record.inspectionFindingId)).limit(1)
  if (!finding?.capaActionId) return
  const now = new Date().toISOString()
  const [evidence] = await client.update(preventionCapaEvidence).set({
    status: "superseded",
    supersededAt: now,
    supersededByUserId: args.actorUserId,
    supersessionReason: args.reason,
  }).where(and(
    eq(preventionCapaEvidence.actionId, finding.capaActionId),
    eq(preventionCapaEvidence.reference, `mantencion:${args.record.id}`),
    eq(preventionCapaEvidence.status, "active"),
  )).returning({ id: preventionCapaEvidence.id })
  if (!evidence) return
  await client.insert(preventionCapaTransitions).values({
    id: `capat-${nanoid()}`,
    actionId: finding.capaActionId,
    changeType: "evidence",
    reason: args.reason,
    changeSet: { evidenceId: evidence.id, lifecycle: "superseded", maintenanceId: args.record.id },
    actorUserId: args.actorUserId,
    createdAt: now,
  })
}

const TRANSITION_RULES: Record<MaintenanceTransition, { from: readonly string[]; to: string }> = {
  start: { from: ["scheduled"], to: "in_progress" },
  complete: { from: ["scheduled", "in_progress"], to: "completed" },
  reopen: { from: ["completed"], to: "in_progress" },
  cancel: { from: ["scheduled", "in_progress", "completed"], to: "cancelled" },
}

export async function transitionMaintenanceRecord(
  session: Session,
  input: { id: string; expectedStatus: string; transition: MaintenanceTransition; reason: string },
) {
  if (!can(session, "mantenciones:edit")) throw new Error("Sin permisos para cambiar el estado de mantenciones")
  const rule = TRANSITION_RULES[input.transition]
  if (!rule) throw new Error("Transición de mantención inválida")
  const reason = input.reason.trim()
  if (reason.length < 5) throw new Error("Indica un motivo de al menos 5 caracteres")

  return db.transaction(async (tx) => {
    const [existing] = await tx.select({
      id: maintenanceRecords.id,
      vehicleId: maintenanceRecords.vehicleId,
      worksiteId: maintenanceRecords.worksiteId,
      status: maintenanceRecords.status,
      inspectionFindingId: maintenanceRecords.inspectionFindingId,
      maintenanceType: maintenanceRecords.maintenanceType,
      maintenanceDate: maintenanceRecords.maintenanceDate,
    }).from(maintenanceRecords).where(eq(maintenanceRecords.id, input.id)).for("update").limit(1)
    if (!existing) throw new Error("Mantención no encontrada")
    // Las mantenciones heredadas sin faena quedaban fuera del listado acotado y
    // aun así se podían cancelar por ID: la condición previa se saltaba el
    // control cuando `worksiteId` era NULL. La faena se resuelve por el equipo.
    if (!canAccessWorksite(session, await effectiveWorksiteId(tx, existing))) {
      throw new Error("No puedes cambiar mantenciones de esta faena")
    }
    if (existing.status !== input.expectedStatus) {
      throw new Error("La mantención cambió en otra sesión. Recarga antes de continuar")
    }
    if (!rule.from.includes(existing.status)) {
      throw new Error(`No se puede ${input.transition} una mantención en estado ${existing.status}`)
    }

    const now = new Date().toISOString()
    const newState = { status: rule.to, updatedAt: now }
    await tx.update(maintenanceRecords).set(newState).where(eq(maintenanceRecords.id, existing.id))
    if (input.transition === "complete") {
      await activateMaintenanceCapaEvidence(tx, { record: existing, actorUserId: session.user.id })
    } else if (input.transition === "reopen" || (input.transition === "cancel" && existing.status === "completed")) {
      await supersedeMaintenanceCapaEvidence(tx, { record: existing, actorUserId: session.user.id, reason })
    }
    await recordAudit({
      userId: session.user.id,
      action: input.transition === "cancel" ? "cancel" : "status_change",
      entityType: "maintenance_record",
      entityId: existing.id,
      oldState: existing,
      newState: { ...newState, transition: input.transition, reason },
    }, tx)
    return { status: rule.to }
  })
}

export async function cancelMaintenanceRecord(session: Session, id: string, expectedStatus: string, reason: string) {
  return transitionMaintenanceRecord(session, { id, expectedStatus, reason, transition: "cancel" })
}
