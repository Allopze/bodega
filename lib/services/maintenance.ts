import type { Session } from "next-auth"
import { and, count, desc, eq, inArray, isNotNull, sql } from "drizzle-orm"
import { db, type DB, type Tx } from "@/db"
import {
  costCenters,
  fuelAnomalyCases,
  fuelOperationRecords,
  fuelEquipmentTypes,
  fuelVehicleOperationalIntervals,
  fuelVehicles,
  maintenanceRecords,
  maintenanceDocuments,
  maintenanceDocumentPolicies,
  maintenanceLabor,
  maintenanceParts,
  maintenancePlans,
  maintenanceTasks,
  preventionCapaEvidence,
  preventionCapaTransitions,
  preventionInspectionFindings,
  roles,
  suppliers,
  userRoles,
  users,
  worksiteUsers,
  worksites,
} from "@/db/schema"
import { canAccessWorksite, visibleWorksiteIds, isGlobalRole, worksiteScopeSql } from "@/lib/auth/scope"
import { fuelOperationOccurredAtSql } from "@/lib/combustibles/fuel-log"
import { assertCostCenterAllowed, costCenterOptionsWhere } from "@/lib/services/cost-centers"
import { recordAudit } from "@/lib/audit"
import { nanoid } from "@/lib/id"
import { addDaysToPlainDate, codeYear, todayInChile } from "@/lib/utils"
import { can } from "@/lib/auth/can"
import type { MaintenanceLaborInput, MaintenancePartInput, MaintenancePlanInput, MaintenanceTaskInput } from "@/lib/validation/maintenance"
import { setVehicleOperationalStatus } from "@/lib/services/fleet-operational-status"
import { nextCodeTx } from "@/lib/code-sequences"
import { getUserIdsWithPermission, getUserIdsWithPermissionForWorksite } from "@/lib/services/notification-targeting"

export const MAINTENANCE_PAGE_SIZE = 50
export const MAINTENANCE_EXPORT_LIMIT = 10_000

export interface MaintenanceFilters {
  vehicleId?: string
  worksiteId?: string
  status?: string
  q?: string
  limit?: number
  offset?: number
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
  planId?: string | null
  priority?: "low" | "normal" | "high" | "critical"
  assignedToUserId?: string | null
  slaDueAt?: string | null
  rootCause?: string | null
  underWarranty?: boolean
  operationalImpact?: "none" | "maintenance" | "out_of_service"
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
    filters.q?.trim() ? sql`(
      ${maintenanceRecords.maintenanceType} ILIKE ${`%${filters.q.trim()}%`}
      OR COALESCE(${maintenanceRecords.documentNumber}, '') ILIKE ${`%${filters.q.trim()}%`}
      OR COALESCE(${maintenanceRecords.documentName}, '') ILIKE ${`%${filters.q.trim()}%`}
      OR COALESCE(${maintenanceRecords.notes}, '') ILIKE ${`%${filters.q.trim()}%`}
      OR EXISTS (
        SELECT 1 FROM fuel_vehicles mv
        WHERE mv.id = ${maintenanceRecords.vehicleId}
          AND (mv.plate ILIKE ${`%${filters.q.trim()}%`} OR COALESCE(mv.code, '') ILIKE ${`%${filters.q.trim()}%`})
      )
    )` : undefined,
  )

  const limit = Math.min(Math.max(filters.limit ?? MAINTENANCE_PAGE_SIZE, 1), MAINTENANCE_EXPORT_LIMIT)
  const offset = Math.max(filters.offset ?? 0, 0)

  const [recordRows, totalRows, vehicles, supplierRows, worksiteRows, costCenterRows] = await Promise.all([
    db.query.maintenanceRecords.findMany({
      where,
      columns: {
        id: true,
        code: true,
        planId: true,
        vehicleId: true,
        supplierId: true,
        worksiteId: true,
        costCenterId: true,
        maintenanceDate: true,
        maintenanceType: true,
        status: true,
        priority: true,
        assignedToUserId: true,
        slaDueAt: true,
        rootCause: true,
        underWarranty: true,
        operationalImpact: true,
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
      with: { vehicle: true, supplier: true, worksite: true, costCenter: true, assignee: { columns: { id: true, name: true } } },
      orderBy: [desc(maintenanceRecords.maintenanceDate), desc(maintenanceRecords.createdAt)],
      limit,
      offset,
    }),
    db.select({ total: count() }).from(maintenanceRecords).where(where),
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
    total: totalRows[0]?.total ?? 0,
    limit,
    offset,
    vehicles,
    suppliers: supplierRows,
    worksites: scopedWorksites === null
      ? worksiteRows
      : worksiteRows.filter((worksite) => scopedWorksites.includes(worksite.id)),
    costCenters: costCenterRows,
  }
}

/** Todas las filas visibles para Excel, con el mismo scope y filtros que la UI. */
export async function getMaintenanceExportData(
  session: Session,
  filters: Omit<MaintenanceFilters, "limit" | "offset"> = {},
) {
  return getMaintenancePageData(session, {
    ...filters,
    limit: MAINTENANCE_EXPORT_LIMIT,
    offset: 0,
  })
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

  const [upcoming, overdue] = await Promise.all([db.query.maintenanceRecords.findMany({
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
  }), db.query.maintenanceRecords.findMany({
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
  })])

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
  // Lectura menor a la de la última mantención: no alcanza el umbral, alcanzó
  // el umbral en negativo (medidor reemplazado/reseteado) — hay que avisar en
  // vez de descartar la fila en silencio (CO-023).
  possibleMeterReset: boolean
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
  const [readings, completedMaintenances, acceptedResetCutoffs] = await Promise.all([
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
      // Desempate por instante real: `fecha` sola no distingue dos cargas del
      // mismo día (CO-023, mismo helper que fleet.ts).
      .orderBy(fuelOperationRecords.vehicleId, desc(fuelOperationOccurredAtSql()), desc(fuelOperationRecords.createdAt)),
    db.selectDistinctOn([maintenanceRecords.vehicleId], {
      vehicleId: maintenanceRecords.vehicleId,
      maintenanceDate: maintenanceRecords.maintenanceDate,
      odometerReading: maintenanceRecords.odometerReading,
      hourMeterReading: maintenanceRecords.hourMeterReading,
    })
      .from(maintenanceRecords)
      .where(and(eq(maintenanceRecords.status, "completed"), inArray(maintenanceRecords.vehicleId, vehicleIds)))
      // Desempate por createdAt: `maintenance_date` es sólo fecha (mismo
      // criterio que el resto de esta remediación).
      .orderBy(maintenanceRecords.vehicleId, desc(maintenanceRecords.maintenanceDate), desc(maintenanceRecords.createdAt)),
    // Reset de medidor ya ACEPTADO (caso regresivo cerrado explícitamente como
    // `reset_medidor`) sobre una fila del log operacional: la fecha de esa
    // fila es el punto donde la serie "reinicia" — comparar contra una mantención
    // anterior a ese punto ya no es válido y no debe seguir avisando (CO-023, ítem 7).
    db.select({
      vehicleId: fuelOperationRecords.vehicleId,
      ruleCode: fuelAnomalyCases.ruleCode,
      cutoffFecha: sql<string>`MAX(${fuelOperationRecords.fecha})`,
    })
      .from(fuelAnomalyCases)
      .innerJoin(fuelOperationRecords, eq(fuelAnomalyCases.referenceEntityId, fuelOperationRecords.id))
      .where(and(
        eq(fuelAnomalyCases.referenceEntityType, "fuel_operation_record"),
        inArray(fuelAnomalyCases.ruleCode, ["kilometraje_regresivo", "horometro_regresivo"]),
        inArray(fuelAnomalyCases.status, ["resolved", "dismissed"]),
        // Sólo el reset FÍSICO corta la serie. Un caso cerrado como
        // "lectura corregida" es un error de tipeo ya arreglado: la mantención
        // anterior sigue siendo comparable y el aviso debe seguir saliendo.
        eq(fuelAnomalyCases.resolutionKind, "reset_medidor"),
        inArray(fuelOperationRecords.vehicleId, vehicleIds),
      ))
      .groupBy(fuelOperationRecords.vehicleId, fuelAnomalyCases.ruleCode),
  ])

  const latestReadingByVehicle = new Map<string, { fecha: string; horometro: number; medidoPor: "km" | "hora" }>()
  for (const r of readings) {
    if (!r.vehicleId || r.horometro == null || !r.medidoPor) continue
    latestReadingByVehicle.set(r.vehicleId, { fecha: r.fecha, horometro: r.horometro, medidoPor: r.medidoPor as "km" | "hora" })
  }

  const lastMaintenanceByVehicle = new Map(completedMaintenances.map((m) => [m.vehicleId, m]))
  const resetCutoffByVehicleAndRule = new Map(acceptedResetCutoffs.map((r) => [`${r.vehicleId}::${r.ruleCode}`, r.cutoffFecha]))

  const alerts: UsageMaintenanceAlert[] = []
  for (const vehicle of vehicles) {
    const reading = latestReadingByVehicle.get(vehicle.id)
    if (!reading) continue
    const lastMaintenance = lastMaintenanceByVehicle.get(vehicle.id)
    if (!lastMaintenance) continue
    const lastReading = reading.medidoPor === "km" ? lastMaintenance.odometerReading : lastMaintenance.hourMeterReading
    if (lastReading == null) continue

    const usage = reading.horometro - lastReading
    // Negativo: la lectura actual es MENOR que la de la última mantención —
    // medidor reemplazado o reseteado, no "uso bajo". Antes desaparecía del
    // todo junto con las filas bajo el umbral; ahora se avisa (CO-023).
    const possibleMeterReset = usage < 0
    if (possibleMeterReset) {
      const ruleCode = reading.medidoPor === "hora" ? "horometro_regresivo" : "kilometraje_regresivo"
      const resetCutoff = resetCutoffByVehicleAndRule.get(`${vehicle.id}::${ruleCode}`)
      // El reset ya fue aceptado y ocurrió DESPUÉS de la última mantención: no
      // hay una lectura comparable del mismo medidor para calcular uso — se
      // omite en vez de seguir pidiendo verificación de algo ya verificado.
      if (resetCutoff && lastMaintenance.maintenanceDate < resetCutoff) continue
    } else if (usage < USAGE_ALERT_THRESHOLDS[reading.medidoPor]) continue

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
      possibleMeterReset,
    })
  }

  // Posibles resets primero: necesitan verificación humana, no compiten por
  // "mayor uso" con el resto.
  return alerts.sort((a, b) => Number(b.possibleMeterReset) - Number(a.possibleMeterReset) || b.usageSinceLastMaintenance - a.usageSinceLastMaintenance)
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
    .select({ id: fuelVehicles.id, worksiteId: fuelVehicles.worksiteId, isActive: fuelVehicles.isActive, meterType: fuelVehicles.meterType })
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

async function assertMaintenanceAssigneeAllowed(assignedToUserId: string | null | undefined, worksiteId: string) {
  if (!assignedToUserId) return
  const eligible = await getUserIdsWithPermissionForWorksite("mantenciones:edit", worksiteId)
  if (!eligible.includes(assignedToUserId)) {
    throw new Error("El responsable no está activo o no puede gestionar mantenciones en esta faena")
  }
}

export type MaintenanceAssigneeOption = {
  id: string
  name: string
  worksiteIds: string[] | null
}

/** Responsables activos con permiso de edición y el alcance que pueden recibir. */
export async function listMaintenanceAssignees(session: Session): Promise<MaintenanceAssigneeOption[]> {
  if (!can(session, "mantenciones:view")) throw new Error("Sin permisos para ver responsables de mantención")
  const candidateIds = await getUserIdsWithPermission("mantenciones:edit")
  if (candidateIds.length === 0) return []
  const rows = await db.select({
    id: users.id,
    name: users.name,
    worksiteId: worksiteUsers.worksiteId,
    roleIsGlobal: roles.isGlobal,
  }).from(users)
    .leftJoin(worksiteUsers, eq(worksiteUsers.userId, users.id))
    .leftJoin(userRoles, eq(userRoles.userId, users.id))
    .leftJoin(roles, eq(roles.id, userRoles.roleId))
    .where(and(inArray(users.id, candidateIds), eq(users.isActive, true)))

  const options = new Map<string, MaintenanceAssigneeOption>()
  for (const row of rows) {
    const current = options.get(row.id) ?? { id: row.id, name: row.name, worksiteIds: [] }
    if (row.roleIsGlobal) current.worksiteIds = null
    else if (current.worksiteIds && row.worksiteId && !current.worksiteIds.includes(row.worksiteId)) current.worksiteIds.push(row.worksiteId)
    options.set(row.id, current)
  }
  const visible = isGlobalRole(session) ? null : new Set(visibleWorksiteIds(session))
  return [...options.values()]
    .filter((option) => option.worksiteIds === null || option.worksiteIds.some((id) => visible === null || visible.has(id)))
    .sort((a, b) => a.name.localeCompare(b.name, "es-CL"))
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
  const code = await nextCodeTx(client as Tx, "OT", codeYear(now))
  const managesOperationalStatus = input.status === "in_progress" && input.operationalImpact !== "none"
  await client.insert(maintenanceRecords).values({
    id,
    code,
    planId: input.planId || null,
    vehicleId: input.vehicleId,
    supplierId: input.supplierId || null,
    worksiteId,
    costCenterId: input.costCenterId || null,
    maintenanceDate: input.maintenanceDate,
    maintenanceType: input.maintenanceType,
    status: input.status,
    priority: input.priority ?? "normal",
    assignedToUserId: input.assignedToUserId || null,
    slaDueAt: input.slaDueAt || null,
    startedAt: input.status === "in_progress" ? now : null,
    downtimeStartedAt: managesOperationalStatus ? now : null,
    rootCause: input.rootCause || null,
    underWarranty: input.underWarranty ?? false,
    operationalImpact: input.operationalImpact ?? "maintenance",
    managesOperationalStatus,
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
  if (managesOperationalStatus) {
    await setVehicleOperationalStatus(client, {
      vehicleId: input.vehicleId,
      status: input.operationalImpact === "out_of_service" ? "fuera_servicio" : "mantencion",
      reason: `${code}: mantención iniciada`,
      actorUserId: args.actorUserId,
    })
  }
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
    await assertMaintenanceAssigneeAllowed(authorizedInput.assignedToUserId, vehicle.worksiteId)
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
      operationalImpact: maintenanceRecords.operationalImpact,
      managesOperationalStatus: maintenanceRecords.managesOperationalStatus,
      costApprovalStatus: maintenanceRecords.costApprovalStatus,
      version: maintenanceRecords.version,
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
    await assertMaintenanceAssigneeAllowed(input.assignedToUserId, worksiteId)
    if (existing.status === "in_progress" && (
      input.vehicleId !== existing.vehicleId
      || (input.operationalImpact ?? "maintenance") !== (existing.operationalImpact ?? "maintenance")
    )) {
      throw new Error("Detén o completa la OT antes de cambiar el vehículo o su impacto operacional")
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
      planId: input.planId || null,
      priority: input.priority ?? "normal",
      assignedToUserId: input.assignedToUserId || null,
      slaDueAt: input.slaDueAt || null,
      rootCause: input.rootCause || null,
      underWarranty: input.underWarranty ?? false,
      operationalImpact: input.operationalImpact ?? "maintenance",
      odometerReading: input.odometerReading ?? null,
      hourMeterReading: input.hourMeterReading ?? null,
      documentNumber: input.documentNumber || null,
      documentName: input.documentName || null,
      notes: input.notes || null,
      updatedAt: new Date().toISOString(),
      version: sql`${maintenanceRecords.version} + 1`,
    }
    const costsChanged = canViewCosts && (
      existing.netAmount !== input.netAmount
      || existing.taxAmount !== input.taxAmount
      || existing.totalAmount !== input.totalAmount
    )
    const newState = canViewCosts
      ? {
          ...operationalState,
          netAmount: input.netAmount,
          taxAmount: input.taxAmount,
          totalAmount: input.totalAmount,
          ...(costsChanged ? {
            costApprovalStatus: "not_required" as const,
            costApprovedByUserId: null,
            costApprovedAt: null,
          } : {}),
        }
      : operationalState

    await tx.update(maintenanceRecords).set(newState).where(eq(maintenanceRecords.id, id))
    await recordAudit({
      userId: session.user.id,
      action: "update",
      entityType: "maintenance_record",
      entityId: id,
      oldState: existing,
      // `newState.version` es una expresión SQL de Drizzle con referencias
      // circulares a la tabla. La auditoría persiste el valor efectivo, no el
      // objeto compilador que PostgreSQL usa para incrementarlo.
      newState: { ...newState, version: existing.version + 1 },
    }, tx)
  })
}

async function requireMaintenanceAccess(client: DB | Tx, session: Session, id: string) {
  const [record] = await client.select({
    id: maintenanceRecords.id,
    code: maintenanceRecords.code,
    vehicleId: maintenanceRecords.vehicleId,
    worksiteId: maintenanceRecords.worksiteId,
    status: maintenanceRecords.status,
    version: maintenanceRecords.version,
  }).from(maintenanceRecords).where(eq(maintenanceRecords.id, id)).limit(1)
  if (!record) throw new Error("Orden de trabajo no encontrada")
  if (!canAccessWorksite(session, await effectiveWorksiteId(client, record))) {
    throw new Error("No puedes acceder a órdenes de esta faena")
  }
  return record
}

/** Detalle agregado de una OT; una consulta relacional evita el N+1 del detalle. */
export async function getMaintenanceRecordDetail(session: Session, id: string) {
  if (!can(session, "mantenciones:view")) throw new Error("Sin permisos para ver mantenciones")
  await requireMaintenanceAccess(db, session, id)
  const record = await db.query.maintenanceRecords.findFirst({
    where: eq(maintenanceRecords.id, id),
    with: {
      vehicle: true,
      supplier: true,
      worksite: true,
      costCenter: true,
      assignee: { columns: { id: true, name: true, email: true } },
      plan: true,
      tasks: { orderBy: [maintenanceTasks.sortOrder, maintenanceTasks.createdAt] },
      parts: { orderBy: [maintenanceParts.createdAt] },
      labor: { orderBy: [maintenanceLabor.createdAt] },
      documents: { orderBy: [desc(maintenanceDocuments.createdAt)] },
    },
  })
  if (!record) throw new Error("Orden de trabajo no encontrada")
  const canViewCosts = can(session, "combustibles:view_costs")
  return {
    ...record,
    netAmount: canViewCosts ? record.netAmount : null,
    taxAmount: canViewCosts ? record.taxAmount : null,
    totalAmount: canViewCosts ? record.totalAmount : null,
    parts: record.parts.map((part) => ({ ...part, unitCost: canViewCosts ? part.unitCost : null })),
    labor: record.labor.map((entry) => ({ ...entry, hourlyRate: canViewCosts ? entry.hourlyRate : null })),
  }
}

export async function listMaintenancePlans(session: Session) {
  if (!can(session, "mantenciones:view")) throw new Error("Sin permisos para ver planes preventivos")
  const scopedWorksites = isGlobalRole(session) ? null : visibleWorksiteIds(session)
  return db.query.maintenancePlans.findMany({
    where: scopedWorksites === null
      ? undefined
      : scopedWorksites.length > 0
        ? inArray(maintenancePlans.worksiteId, scopedWorksites)
        : sql`false`,
    with: {
      vehicle: { columns: { id: true, plate: true, code: true, meterType: true } },
      worksite: { columns: { id: true, name: true } },
    },
    orderBy: [maintenancePlans.isActive, maintenancePlans.nextDueDate, maintenancePlans.name],
  })
}

export async function saveMaintenancePlan(session: Session, input: MaintenancePlanInput, expectedVersion?: number) {
  if (!can(session, "mantenciones:edit")) throw new Error("Sin permisos para gestionar planes preventivos")
  return db.transaction(async (tx) => {
    const vehicle = await resolveMaintenanceVehicle(tx, input.vehicleId)
    if (!canAccessWorksite(session, vehicle.worksiteId)) throw new Error("No puedes gestionar planes de este equipo")
    if (input.strategy === "odometer" && vehicle.meterType !== "odometer") throw new Error("El activo no usa odómetro")
    if (input.strategy === "hour_meter" && vehicle.meterType !== "hour_meter") throw new Error("El activo no usa horómetro")
    if (input.strategy === "combined" && vehicle.meterType === "none") throw new Error("El activo no tiene medidor para una estrategia combinada")
    await assertMaintenanceAssigneeAllowed(input.assignedToUserId, vehicle.worksiteId)
    if (input.costCenterId) await assertCostCenterAllowed(tx, input.costCenterId, vehicle.worksiteId)
    const now = new Date().toISOString()
    const values = {
      vehicleId: input.vehicleId,
      worksiteId: vehicle.worksiteId,
      name: input.name,
      maintenanceType: input.maintenanceType,
      strategy: input.strategy,
      intervalDays: input.intervalDays ?? null,
      intervalUnits: input.intervalUnits ?? null,
      advanceDays: input.advanceDays,
      advanceUnits: input.advanceUnits,
      nextDueDate: input.nextDueDate ?? null,
      nextDueReading: input.nextDueReading ?? null,
      assignedToUserId: input.assignedToUserId || null,
      supplierId: input.supplierId || null,
      costCenterId: input.costCenterId || null,
      instructions: input.instructions || null,
      updatedAt: now,
    }
    if (!input.id) {
      const id = nanoid()
      await tx.insert(maintenancePlans).values({ ...values, id, createdBy: session.user.id })
      await recordAudit({ userId: session.user.id, action: "create", entityType: "maintenance_plan", entityId: id, newState: values }, tx)
      return id
    }
    const [existing] = await tx.select().from(maintenancePlans).where(eq(maintenancePlans.id, input.id)).for("update").limit(1)
    if (!existing) throw new Error("Plan preventivo no encontrado")
    if (!canAccessWorksite(session, existing.worksiteId)) throw new Error("No puedes editar este plan")
    if (expectedVersion !== undefined && existing.version !== expectedVersion) {
      throw new Error("El plan cambió en otra sesión. Recarga antes de guardar")
    }
    const [updated] = await tx.update(maintenancePlans).set({
      ...values,
      version: sql`${maintenancePlans.version} + 1`,
    }).where(and(eq(maintenancePlans.id, input.id), eq(maintenancePlans.version, existing.version))).returning({ id: maintenancePlans.id })
    if (!updated) throw new Error("El plan cambió en otra sesión. Recarga antes de guardar")
    await recordAudit({ userId: session.user.id, action: "update", entityType: "maintenance_plan", entityId: input.id, oldState: existing, newState: values }, tx)
    return input.id
  })
}

export async function setMaintenancePlanActive(session: Session, id: string, active: boolean, expectedVersion: number) {
  if (!can(session, "mantenciones:edit")) throw new Error("Sin permisos para gestionar planes preventivos")
  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(maintenancePlans).where(eq(maintenancePlans.id, id)).for("update").limit(1)
    if (!existing) throw new Error("Plan preventivo no encontrado")
    if (!canAccessWorksite(session, existing.worksiteId)) throw new Error("No puedes editar este plan")
    if (existing.version !== expectedVersion) throw new Error("El plan cambió en otra sesión. Recarga antes de continuar")
    await tx.update(maintenancePlans).set({ isActive: active, version: sql`${maintenancePlans.version} + 1`, updatedAt: new Date().toISOString() })
      .where(and(eq(maintenancePlans.id, id), eq(maintenancePlans.version, expectedVersion)))
    await recordAudit({ userId: session.user.id, action: "status_change", entityType: "maintenance_plan", entityId: id, oldState: { isActive: existing.isActive }, newState: { isActive: active } }, tx)
  })
}

/** Materializa las obligaciones vencidas/por vencer sin duplicar una OT. */
export async function materializeDueMaintenancePlans(session: Session) {
  if (!can(session, "mantenciones:create")) throw new Error("Sin permisos para programar mantenciones")
  const plans = await listMaintenancePlans(session)
  const today = todayInChile()
  let created = 0
  for (const plan of plans) {
    if (!plan.isActive) continue
    const calendarDue = plan.nextDueDate && plan.nextDueDate <= addDaysToPlainDate(today, plan.advanceDays)
    let usageDue = false
    if (plan.nextDueReading != null) {
      const readingUnit = plan.strategy === "hour_meter"
        || (plan.strategy === "combined" && plan.vehicle.meterType === "hour_meter")
        ? "hora"
        : "km"
      const [reading] = await db.select({ value: fuelOperationRecords.horometro })
        .from(fuelOperationRecords)
        .where(and(
          eq(fuelOperationRecords.vehicleId, plan.vehicleId),
          eq(fuelOperationRecords.medidoPor, readingUnit),
          isNotNull(fuelOperationRecords.horometro),
        ))
        .orderBy(desc(fuelOperationOccurredAtSql()), desc(fuelOperationRecords.createdAt)).limit(1)
      usageDue = reading?.value != null && reading.value >= plan.nextDueReading - plan.advanceUnits
    }
    if (!calendarDue && !usageDue) continue
    const maintenanceDate = plan.nextDueDate ?? today
    const existing = await db.select({ id: maintenanceRecords.id }).from(maintenanceRecords).where(and(
      eq(maintenanceRecords.planId, plan.id),
      eq(maintenanceRecords.maintenanceDate, maintenanceDate),
      sql`${maintenanceRecords.status} <> 'cancelled'`,
    )).limit(1)
    if (existing[0]) continue
    await createMaintenanceRecord(session, {
      vehicleId: plan.vehicleId,
      planId: plan.id,
      supplierId: plan.supplierId,
      costCenterId: plan.costCenterId,
      maintenanceDate,
      maintenanceType: plan.maintenanceType,
      status: "scheduled",
      priority: "normal",
      assignedToUserId: plan.assignedToUserId,
      operationalImpact: "maintenance",
      netAmount: 0,
      taxAmount: 0,
      totalAmount: 0,
      notes: plan.instructions,
    })
    created += 1
  }
  return { created }
}

export async function addMaintenanceTask(session: Session, input: MaintenanceTaskInput) {
  if (!can(session, "mantenciones:edit")) throw new Error("Sin permisos para editar la orden")
  return db.transaction(async (tx) => {
    const record = await requireMaintenanceAccess(tx, session, input.maintenanceId)
    if (!["scheduled", "in_progress"].includes(record.status)) throw new Error("La orden cerrada no admite nuevas tareas")
    const [orderRow] = await tx.select({ nextOrder: sql<number>`COALESCE(MAX(${maintenanceTasks.sortOrder}), -1) + 1` })
      .from(maintenanceTasks).where(eq(maintenanceTasks.maintenanceId, input.maintenanceId))
    const id = nanoid()
    await tx.insert(maintenanceTasks).values({ id, maintenanceId: input.maintenanceId, description: input.description, sortOrder: Number(orderRow?.nextOrder ?? 0) })
    await recordAudit({ userId: session.user.id, action: "create", entityType: "maintenance_task", entityId: id, newState: input }, tx)
    return id
  })
}

export async function setMaintenanceTaskStatus(session: Session, taskId: string, completed: boolean) {
  if (!can(session, "mantenciones:edit")) throw new Error("Sin permisos para editar la orden")
  return db.transaction(async (tx) => {
    const [task] = await tx.select().from(maintenanceTasks).where(eq(maintenanceTasks.id, taskId)).for("update").limit(1)
    if (!task) throw new Error("Tarea no encontrada")
    const record = await requireMaintenanceAccess(tx, session, task.maintenanceId)
    if (!["scheduled", "in_progress"].includes(record.status)) {
      throw new Error("La orden cerrada no admite cambios en sus tareas")
    }
    const now = new Date().toISOString()
    await tx.update(maintenanceTasks).set({ status: completed ? "completed" : "pending", completedBy: completed ? session.user.id : null, completedAt: completed ? now : null }).where(eq(maintenanceTasks.id, taskId))
    await recordAudit({ userId: session.user.id, action: "status_change", entityType: "maintenance_task", entityId: taskId, oldState: task, newState: { status: completed ? "completed" : "pending" } }, tx)
  })
}

export async function addMaintenancePart(session: Session, input: MaintenancePartInput) {
  if (!can(session, "mantenciones:edit")) throw new Error("Sin permisos para editar la orden")
  return db.transaction(async (tx) => {
    const record = await requireMaintenanceAccess(tx, session, input.maintenanceId)
    if (!["scheduled", "in_progress"].includes(record.status)) throw new Error("La orden cerrada no admite repuestos")
    const id = nanoid()
    await tx.insert(maintenanceParts).values({
      id,
      maintenanceId: input.maintenanceId,
      description: input.description,
      partNumber: input.partNumber || null,
      quantity: input.quantity,
      unit: input.unit,
      unitCost: can(session, "combustibles:view_costs") ? input.unitCost : 0,
    })
    if (can(session, "combustibles:view_costs") && input.unitCost > 0) {
      await invalidateMaintenanceCostApproval(tx, input.maintenanceId)
    }
    await recordAudit({ userId: session.user.id, action: "create", entityType: "maintenance_part", entityId: id, newState: { ...input, unitCost: can(session, "combustibles:view_costs") ? input.unitCost : 0 } }, tx)
    return id
  })
}

export async function uploadMaintenanceDocument(session: Session, input: {
  maintenanceId: string
  documentType: string
  fileName: string
  filePath: string
  fileSize: number
  mimeType: string
}) {
  if (!can(session, "mantenciones:edit")) throw new Error("Sin permisos para adjuntar documentos")
  return db.transaction(async (tx) => {
    const record = await requireMaintenanceAccess(tx, session, input.maintenanceId)
    const now = new Date().toISOString()
    const id = nanoid()
    const [superseded] = await tx.update(maintenanceDocuments).set({ status: "replaced", supersededAt: now })
      .where(and(eq(maintenanceDocuments.maintenanceId, input.maintenanceId), eq(maintenanceDocuments.documentType, input.documentType), eq(maintenanceDocuments.status, "current")))
      .returning({ id: maintenanceDocuments.id })
    await tx.insert(maintenanceDocuments).values({
      id,
      maintenanceId: input.maintenanceId,
      documentType: input.documentType,
      fileName: input.fileName,
      filePath: input.filePath,
      fileSize: input.fileSize,
      mimeType: input.mimeType,
      uploadedBy: session.user.id,
    })
    if (superseded) await tx.update(maintenanceDocuments).set({ supersededBy: id }).where(eq(maintenanceDocuments.id, superseded.id))
    await recordAudit({ userId: session.user.id, action: "create", entityType: "maintenance_document", entityId: id, entityCode: record.code ?? undefined, newState: { maintenanceId: input.maintenanceId, documentType: input.documentType, fileName: input.fileName, supersedes: superseded?.id ?? null } }, tx)
    return id
  })
}

export async function listMaintenanceDocumentPolicies(session: Session) {
  if (!can(session, "mantenciones:view")) throw new Error("Sin permisos para ver políticas documentales")
  const [policies, equipmentTypes] = await Promise.all([
    db.query.maintenanceDocumentPolicies.findMany({ with: { equipmentType: true }, orderBy: [maintenanceDocumentPolicies.equipmentTypeId, maintenanceDocumentPolicies.requiredAt, maintenanceDocumentPolicies.documentType] }),
    db.query.fuelEquipmentTypes.findMany({ where: eq(fuelEquipmentTypes.isActive, true), orderBy: (table, { asc }) => [asc(table.name)] }),
  ])
  return { policies, equipmentTypes }
}

export async function saveMaintenanceDocumentPolicy(session: Session, input: { equipmentTypeId: string; documentType: string; requiredAt: "before_start" | "before_complete" }) {
  if (!can(session, "mantenciones:edit")) throw new Error("Sin permisos para gestionar políticas documentales")
  if (!isGlobalRole(session)) throw new Error("Sólo un rol global puede gestionar políticas documentales")
  return db.transaction(async (tx) => {
    const id = nanoid()
    const now = new Date().toISOString()
    const [row] = await tx.insert(maintenanceDocumentPolicies).values({ id, ...input, createdBy: session.user.id, updatedAt: now }).onConflictDoUpdate({
      target: [maintenanceDocumentPolicies.equipmentTypeId, maintenanceDocumentPolicies.documentType, maintenanceDocumentPolicies.requiredAt],
      set: { isActive: true, updatedAt: now },
    }).returning({ id: maintenanceDocumentPolicies.id })
    await recordAudit({ userId: session.user.id, action: "create", entityType: "maintenance_document_policy", entityId: row?.id ?? id, newState: input }, tx)
    return row?.id ?? id
  })
}

export async function setMaintenanceDocumentPolicyActive(session: Session, id: string, active: boolean) {
  if (!can(session, "mantenciones:edit")) throw new Error("Sin permisos para gestionar políticas documentales")
  if (!isGlobalRole(session)) throw new Error("Sólo un rol global puede gestionar políticas documentales")
  await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(maintenanceDocumentPolicies).where(eq(maintenanceDocumentPolicies.id, id)).for("update").limit(1)
    if (!existing) throw new Error("Política documental no encontrada")
    await tx.update(maintenanceDocumentPolicies).set({ isActive: active, updatedAt: new Date().toISOString() }).where(eq(maintenanceDocumentPolicies.id, id))
    await recordAudit({ userId: session.user.id, action: "status_change", entityType: "maintenance_document_policy", entityId: id, oldState: { isActive: existing.isActive }, newState: { isActive: active } }, tx)
  })
}

export async function addMaintenanceLabor(session: Session, input: MaintenanceLaborInput) {
  if (!can(session, "mantenciones:edit")) throw new Error("Sin permisos para editar la orden")
  return db.transaction(async (tx) => {
    const record = await requireMaintenanceAccess(tx, session, input.maintenanceId)
    if (!["scheduled", "in_progress"].includes(record.status)) throw new Error("La orden cerrada no admite mano de obra")
    const id = nanoid()
    const hourlyRate = can(session, "combustibles:view_costs") ? input.hourlyRate : 0
    await tx.insert(maintenanceLabor).values({ id, maintenanceId: input.maintenanceId, description: input.description, hours: input.hours, hourlyRate })
    if (hourlyRate > 0) await invalidateMaintenanceCostApproval(tx, input.maintenanceId)
    await recordAudit({ userId: session.user.id, action: "create", entityType: "maintenance_labor", entityId: id, entityCode: record.code ?? undefined, newState: { ...input, hourlyRate } }, tx)
    return id
  })
}

export async function decideMaintenanceCostApproval(session: Session, input: { maintenanceId: string; decision: "request" | "approve" | "reject" }) {
  if (input.decision === "request") {
    if (!can(session, "mantenciones:edit")) throw new Error("Sin permisos para solicitar aprobación")
  } else if (!can(session, "mantenciones:approve_costs")) throw new Error("Sin permisos para aprobar costos")
  return db.transaction(async (tx) => {
    const record = await requireMaintenanceAccess(tx, session, input.maintenanceId)
    const [existing] = await tx.select({ createdBy: maintenanceRecords.createdBy, approval: maintenanceRecords.costApprovalStatus, total: maintenanceRecords.totalAmount })
      .from(maintenanceRecords).where(eq(maintenanceRecords.id, input.maintenanceId)).for("update").limit(1)
    if (!existing) throw new Error("Orden de trabajo no encontrada")
    if (input.decision === "request" && !["not_required", "rejected"].includes(existing.approval)) {
      throw new Error(existing.approval === "pending" ? "Los costos ya están pendientes de aprobación" : "Los costos ya están aprobados")
    }
    if (input.decision !== "request" && existing.approval !== "pending") {
      throw new Error("Los costos no están pendientes de aprobación")
    }
    if (input.decision !== "request" && existing.createdBy === session.user.id) throw new Error("Quien creó la OT no puede aprobar sus propios costos")
    if (input.decision === "request") {
      const [[parts], [labor]] = await Promise.all([
        tx.select({ total: sql<number>`COALESCE(SUM(${maintenanceParts.quantity} * ${maintenanceParts.unitCost}), 0)` })
          .from(maintenanceParts).where(eq(maintenanceParts.maintenanceId, input.maintenanceId)),
        tx.select({ total: sql<number>`COALESCE(SUM(${maintenanceLabor.hours} * ${maintenanceLabor.hourlyRate}), 0)` })
          .from(maintenanceLabor).where(eq(maintenanceLabor.maintenanceId, input.maintenanceId)),
      ])
      const total = Number(existing.total) + Number(parts?.total ?? 0) + Number(labor?.total ?? 0)
      if (total <= 0) throw new Error("La orden no tiene costos que aprobar")
    }
    const status = input.decision === "request" ? "pending" : input.decision === "approve" ? "approved" : "rejected"
    const now = new Date().toISOString()
    await tx.update(maintenanceRecords).set({ costApprovalStatus: status, costApprovedByUserId: input.decision === "request" ? null : session.user.id, costApprovedAt: input.decision === "request" ? null : now, version: sql`${maintenanceRecords.version} + 1`, updatedAt: now }).where(eq(maintenanceRecords.id, input.maintenanceId))
    await recordAudit({ userId: session.user.id, action: "status_change", entityType: "maintenance_cost_approval", entityId: input.maintenanceId, entityCode: record.code ?? undefined, oldState: { status: existing.approval }, newState: { status } }, tx)
    return { status }
  })
}

async function invalidateMaintenanceCostApproval(client: Tx, maintenanceId: string) {
  await client.update(maintenanceRecords).set({
    costApprovalStatus: "not_required",
    costApprovedByUserId: null,
    costApprovedAt: null,
    version: sql`${maintenanceRecords.version} + 1`,
    updatedAt: new Date().toISOString(),
  }).where(eq(maintenanceRecords.id, maintenanceId))
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

async function assertMaintenanceDocumentsForTransition(client: Tx, args: { maintenanceId: string; vehicleId: string; requiredAt: "before_start" | "before_complete" }) {
  const [vehicle] = await client.select({ equipmentTypeId: fuelVehicles.equipmentTypeId }).from(fuelVehicles).where(eq(fuelVehicles.id, args.vehicleId)).limit(1)
  if (!vehicle) throw new Error("Vehículo no encontrado")
  const requirements = await client.select({ documentType: maintenanceDocumentPolicies.documentType }).from(maintenanceDocumentPolicies).where(and(eq(maintenanceDocumentPolicies.equipmentTypeId, vehicle.equipmentTypeId), eq(maintenanceDocumentPolicies.requiredAt, args.requiredAt), eq(maintenanceDocumentPolicies.isActive, true)))
  if (requirements.length === 0) return
  const current = await client.select({ documentType: maintenanceDocuments.documentType }).from(maintenanceDocuments).where(and(eq(maintenanceDocuments.maintenanceId, args.maintenanceId), eq(maintenanceDocuments.status, "current")))
  const present = new Set(current.map((row) => row.documentType))
  const missing = requirements.flatMap((row) => present.has(row.documentType) ? [] : [row.documentType])
  if (missing.length > 0) throw new Error(`Faltan documentos obligatorios para esta transición: ${missing.join(", ")}`)
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
      code: maintenanceRecords.code,
      planId: maintenanceRecords.planId,
      operationalImpact: maintenanceRecords.operationalImpact,
      managesOperationalStatus: maintenanceRecords.managesOperationalStatus,
      odometerReading: maintenanceRecords.odometerReading,
      hourMeterReading: maintenanceRecords.hourMeterReading,
      version: maintenanceRecords.version,
      costApprovalStatus: maintenanceRecords.costApprovalStatus,
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
    if (input.transition === "start" || input.transition === "reopen") await assertMaintenanceDocumentsForTransition(tx, { maintenanceId: existing.id, vehicleId: existing.vehicleId, requiredAt: "before_start" })
    if (input.transition === "complete") {
      await assertMaintenanceDocumentsForTransition(tx, { maintenanceId: existing.id, vehicleId: existing.vehicleId, requiredAt: "before_complete" })
      const [pendingTask] = await tx.select({ id: maintenanceTasks.id }).from(maintenanceTasks).where(and(eq(maintenanceTasks.maintenanceId, existing.id), eq(maintenanceTasks.status, "pending"))).limit(1)
      if (pendingTask) throw new Error("Completa o cancela todas las tareas antes de cerrar la OT")
      if (["pending", "rejected"].includes(existing.costApprovalStatus)) throw new Error("Los costos deben quedar aprobados antes de cerrar la OT")
    }

    const now = new Date().toISOString()
    const startsWork = ["start", "reopen"].includes(input.transition)
    const startsDowntime = startsWork && existing.operationalImpact !== "none"
    const endsDowntime = ["complete", "cancel"].includes(input.transition)
    const managesOperationalStatus = startsDowntime || (existing.managesOperationalStatus && !endsDowntime)
    const newState = {
      status: rule.to,
      startedAt: startsWork ? now : undefined,
      completedAt: input.transition === "complete" ? now : input.transition === "reopen" ? null : undefined,
      cancelledAt: input.transition === "cancel" ? now : input.transition === "reopen" ? null : undefined,
      cancellationReason: input.transition === "cancel" ? reason : input.transition === "reopen" ? null : undefined,
      downtimeStartedAt: startsDowntime ? now : undefined,
      downtimeEndedAt: startsDowntime ? null : endsDowntime && existing.managesOperationalStatus ? now : undefined,
      managesOperationalStatus,
      updatedAt: now,
      version: sql`${maintenanceRecords.version} + 1`,
    }
    await tx.update(maintenanceRecords).set(newState).where(eq(maintenanceRecords.id, existing.id))
    if (startsDowntime) {
      await setVehicleOperationalStatus(tx, {
        vehicleId: existing.vehicleId,
        status: existing.operationalImpact === "out_of_service" ? "fuera_servicio" : "mantencion",
        reason: `${existing.code ?? existing.id}: ${reason}`,
        actorUserId: session.user.id,
      })
    } else if (endsDowntime && existing.managesOperationalStatus) {
      const [otherActive] = await tx.select({ id: maintenanceRecords.id })
        .from(maintenanceRecords)
        .where(and(
          eq(maintenanceRecords.vehicleId, existing.vehicleId),
          eq(maintenanceRecords.status, "in_progress"),
          sql`${maintenanceRecords.id} <> ${existing.id}`,
          eq(maintenanceRecords.managesOperationalStatus, true),
        ))
        .limit(1)
      if (!otherActive) {
        const [currentInterval] = await tx.select({ status: fuelVehicleOperationalIntervals.status, reason: fuelVehicleOperationalIntervals.reason })
          .from(fuelVehicleOperationalIntervals)
          .where(and(eq(fuelVehicleOperationalIntervals.vehicleId, existing.vehicleId), sql`${fuelVehicleOperationalIntervals.endedAt} IS NULL`))
          .limit(1)
        if (currentInterval?.reason?.startsWith(`${existing.code ?? existing.id}:`)) {
          await setVehicleOperationalStatus(tx, {
            vehicleId: existing.vehicleId,
            status: "operativo",
            reason: `${existing.code ?? existing.id}: ${reason}`,
            actorUserId: session.user.id,
          })
        }
      }
    }
    if (input.transition === "complete") {
      await activateMaintenanceCapaEvidence(tx, { record: existing, actorUserId: session.user.id })
      if (existing.planId) {
        const [plan] = await tx.select().from(maintenancePlans).where(eq(maintenancePlans.id, existing.planId)).for("update").limit(1)
        if (plan?.isActive) {
          const reading = plan.strategy === "hour_meter"
            ? existing.hourMeterReading
            : plan.strategy === "odometer"
              ? existing.odometerReading
              : existing.hourMeterReading ?? existing.odometerReading
          await tx.update(maintenancePlans).set({
            nextDueDate: plan.intervalDays ? addDaysToPlainDate(existing.maintenanceDate, plan.intervalDays) : plan.nextDueDate,
            nextDueReading: plan.intervalUnits && reading != null ? Number(reading) + Number(plan.intervalUnits) : plan.nextDueReading,
            version: sql`${maintenancePlans.version} + 1`,
            updatedAt: now,
          }).where(eq(maintenancePlans.id, plan.id))
        }
      }
    } else if (input.transition === "reopen" || (input.transition === "cancel" && existing.status === "completed")) {
      await supersedeMaintenanceCapaEvidence(tx, { record: existing, actorUserId: session.user.id, reason })
    }
    await recordAudit({
      userId: session.user.id,
      action: input.transition === "cancel" ? "cancel" : "status_change",
      entityType: "maintenance_record",
      entityId: existing.id,
      oldState: existing,
      newState: { ...newState, version: existing.version + 1, transition: input.transition, reason },
    }, tx)
    return { status: rule.to }
  })
}

export async function cancelMaintenanceRecord(session: Session, id: string, expectedStatus: string, reason: string) {
  return transitionMaintenanceRecord(session, { id, expectedStatus, reason, transition: "cancel" })
}
