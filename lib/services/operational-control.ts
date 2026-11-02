import type { Session } from "next-auth"
import { and, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm"
import { db } from "@/db"
import {
  fleetGpsLatestPositions,
  fleetVehicleDocuments,
  fuelEquipmentTypes,
  fuelVehicleOperationalIntervals,
  fuelVehicles,
  maintenancePlans,
  maintenanceRecords,
  preventionCapaActions,
  preventionInspectionFindings,
  preventionInspectionRuns,
  serviceEquipment,
  worksites,
} from "@/db/schema"
import { can } from "@/lib/auth/can"
import { worksiteScopeSql } from "@/lib/auth/scope"
import { expiredDocumentTypes, resolveNextExpiryDate } from "@/lib/validation/fleet-documents"
import { getAssetFuelSummary, type AssetFuelSummary } from "@/lib/combustibles/control/queries/asset-fuel-summary"
import { logger } from "@/lib/logger"
import { getFleetAdminSettings } from "@/lib/services/system-settings"
import { addDaysToPlainDate, todayInChile } from "@/lib/utils"
import { civilDate } from "@/lib/validation/dates"
import { MAINTENANCE_OPEN_STATUSES } from "@/lib/validation/maintenance"
import {
  countFleetDocumentExpiry,
  countStoppedVehicles,
  type FleetDocumentExpiry,
  type StoppedVehicles,
} from "@/lib/operational-control/attention"
import { formatFuelVehicleStatus } from "@/lib/combustibles/validation"

export type OperationalAsset = {
  key: `vehicle:${string}` | `service_equipment:${string}`
  kind: "vehicle" | "service_equipment"
  id: string
  code: string
  name: string
  worksiteId: string
  worksiteName: string
  /** Valor crudo de la columna `operational_status` (`operativo`, `mantencion`,
   *  `fuera_servicio`); sólo se usa para filtros server-side y búsqueda
   *  cliente. La UI debe pintar `operationalStatusLabel`. */
  operationalStatus: string
  /** Etiqueta humana derivada vía `formatFuelVehicleStatus`. Es lo que muestra
   *  la UI (regla A6: nunca exponer el enum crudo). */
  operationalStatusLabel: string
  /** El estado de la ficha no coincide con el intervalo operacional abierto. */
  stateMismatch: boolean
  capabilities: readonly ("fuel" | "inspections" | "maintenance" | "service_requests")[]
  maintenanceCount: number
  openMaintenanceCount: number
  inspectionCount: number
  /** Promedio de cumplimiento de las inspecciones del período; `null` sin dato. */
  inspectionCompliancePercent: number | null
  /** Suma de no conformes y parciales de las inspecciones del período. */
  inspectionNonConforming: number | null
  inspectionPartial: number | null
  /** Hallazgos abiertos (`open` o `capa_linked`) del activo; no dependen del período. */
  openFindings: number | null
  criticalOpenFindings: number | null
  /** CAPA vencidas vinculadas a hallazgos de inspección; sólo con `prevention:capa:view`. */
  overdueCapa: number | null
  /** Costo de OT completadas y aprobadas (o que no requieren aprobación). */
  maintenanceCostApproved: number | null
  /** OT abiertas con SLA vencido. */
  openSlaOverdue: number | null
  /** OT abiertas sin responsable asignado. */
  unassignedOpen: number | null
  /** Próximo vencimiento de un plan preventivo activo. */
  nextPlanDue: string | null
  /** Próximo vencimiento documental del activo, con el criterio de Flota. */
  nextExpiryDate: string | null
  /** Tipos documentales vencidos; vacío si no hay ninguno. */
  expiredDocumentTypes: string[]
  gpsOdometer: number | null
  gpsHourMeter: number | null
  gpsObservedAt: string | null
  gpsFuelLevel: number | null
  downtimeHours: number
  maintenanceCost: number | null
  /** Litros de la serie operacional (`fuel_equipment_loads`) que cuentan en el período. */
  fuelLiters: number | null
  fuelLoadCount: number | null
  lastFuelLoadAt: string | null
  /** Promedio de las cargas válidas; mismo criterio que la ficha del equipo. */
  fuelPerformanceValue: number | null
  fuelPerformanceUnit: "km_per_liter" | "liters_per_hour" | null
  /** Cargas marcadas y sin anular del período. */
  flaggedLoads: number | null
  /** Casos de anomalía vigentes del activo (no dependen del período). */
  openAnomalyCases: number | null
  criticalOpenAnomalyCases: number | null
  /** Costo facturado del período (`fuel_loads`); sólo con `combustibles:view_costs`. */
  fuelBilledAmount: number | null
  /** Horas de motor en vacío del período; `null` sin `combustibles:view`. */
  idleHours: number | null
  /** Σ vacío ÷ Σ funcionamiento del período. */
  idlePct: number | null
  /** Litros consumidos en vacío; `null` si la telemetría no trae el dato. */
  litersIdle: number | null
  /** La lectura de la carga y la telemetría discrepan para el mismo medidor. */
  meterMismatch: boolean
}

export interface OperationalControlPeriod {
  from: string
  to: string
}

/**
 * Lo que «Requiere atención» del Panel operacional cuenta **hoy**, sin período.
 *
 * Cada campo es `null` cuando la sesión no tiene la capacidad de su dominio
 * (la página no pinta el tile) o cuando su consulta falló (la página dice «No se
 * pudo calcular» en vez de pintar 0): un fallo no tumba el resto del panel. La
 * página distingue ambos casos con `permissions`.
 *
 * Cada cifra se mide con el criterio de la lista a la que enlaza su tile:
 * detenidos y documentos con `filterFleetOverviewRows` sobre todos los
 * vehículos del alcance (activos e inactivos, como `/flota`), y OT abiertas
 * sobre todas las OT del alcance de la propia OT, sin fecha (como `/mantenciones`).
 */
export interface OperationalAttention {
  stoppedVehicles: StoppedVehicles | null
  fleetDocuments: (FleetDocumentExpiry & { warningDays: number }) | null
  openWorkOrders: number | null
}

/** Una consulta de atención que falla se registra y se vuelve `null`; no rechaza el panel entero. */
async function settleAttention<T>(label: string, run: () => PromiseLike<T>, degraded?: string[]): Promise<T | null> {
  try {
    return await run()
  } catch (error) {
    logger.error(`[control-operacional] la sección «${label}» falló`, error)
    degraded?.push(label)
    return null
  }
}

export interface OperationalControlMetricInputs {
  totalIntervalHours: number
  /** Horas calendario de los equipos activos en el período. */
  calendarHours: number
  operativeHours: number
  downtimeHours: number
  correctiveDowntimeHours: number
  completedCorrective: number
  preventiveCompleted: number
  preventiveDue: number
  backlog: number
  maintenanceCost: number
  maintenanceCostApproved: number
  plansDue: number
  plansWithRecord: number
  overdueSla: number
  unassignedOpen: number
  canViewCosts: boolean
}

export function calculateOperationalControlMetrics(input: OperationalControlMetricInputs) {
  return {
    // Ambos porcentajes se acotan a 100: intervalos históricos solapados no
    // pueden producir una disponibilidad o cobertura mayor al 100 %.
    availabilityPercent: input.totalIntervalHours > 0
      ? Math.min(100, (input.operativeHours / input.totalIntervalHours) * 100)
      : null,
    // La cobertura dice qué parte del calendario de los equipos activos está
    // cubierta por el historial de estado.
    stateCoveragePercent: input.totalIntervalHours > 0 && input.calendarHours > 0
      ? Math.min(100, (input.totalIntervalHours / input.calendarHours) * 100)
      : null,
    mttrHours: input.completedCorrective > 0 ? input.correctiveDowntimeHours / input.completedCorrective : null,
    mtbfHours: input.completedCorrective > 0 ? input.operativeHours / input.completedCorrective : null,
    preventiveCompliancePercent: input.preventiveDue > 0 ? (input.preventiveCompleted / input.preventiveDue) * 100 : null,
    downtimeHours: input.downtimeHours,
    backlog: input.backlog,
    maintenanceCost: input.canViewCosts ? input.maintenanceCost : null,
    maintenanceCostApproved: input.canViewCosts ? input.maintenanceCostApproved : null,
    planAdherencePercent: input.plansDue > 0 ? (input.plansWithRecord / input.plansDue) * 100 : null,
    overdueSla: input.overdueSla,
    unassignedOpen: input.unassignedOpen,
  }
}

export function resolveOperationalControlPeriod(input: Partial<OperationalControlPeriod> = {}): OperationalControlPeriod {
  const to = civilDate().safeParse(input.to).success ? input.to! : todayInChile()
  const from = civilDate().safeParse(input.from).success ? input.from! : addDaysToPlainDate(to, -89)
  if (from > to) throw new Error("El inicio del período no puede ser posterior al término")
  return { from, to }
}

export interface OperationalControlHubOptions {
  /**
   * Calcula los conteos de «Requiere atención» (por defecto `true`, que es lo que
   * pinta la página). La exportación a Excel no los usa: con `false` no se
   * emiten sus consultas (documentos de flota, ajustes de aviso, OT abiertas) ni
   * se cuentan los detenidos, y `attention` queda con todos sus campos en `null`.
   */
  includeAttention?: boolean
}

/** Read model común: unifica navegación y métricas sin borrar las diferencias de dominio. */
export async function getOperationalControlHub(
  session: Session,
  input: Partial<OperationalControlPeriod> = {},
  options: OperationalControlHubOptions = {},
) {
  const includeAttention = options.includeAttention !== false
  const period = resolveOperationalControlPeriod(input)
  const canViewFleet = can(session, "flota:view")
  const canViewMaintenance = can(session, "mantenciones:view")
  const canViewInspections = can(session, "prevention:inspections:view")
  const canViewCapa = can(session, "prevention:capa:view")
  const canViewCosts = can(session, "combustibles:view_costs")
  const canViewFuel = can(session, "combustibles:view")
  const canViewServiceEquipment = can(session, "admin:service_equipment")
  if (!canViewFleet && !canViewMaintenance && !canViewInspections && !canViewFuel) throw new Error("Sin permisos para Control operacional")
  const vehicleScope = worksiteScopeSql(session, fuelVehicles.worksiteId)
  const serviceScope = worksiteScopeSql(session, serviceEquipment.worksiteId)
  const today = todayInChile()
  // Secciones que no se pudieron cargar; la página las anuncia en vez de
  // mostrar un vacío indistinguible de «no hay datos».
  const degradedSources: string[] = []

  const [vehicles, instruments, maintenanceAgg, planAgg, inspectionAgg, findingsAgg, capaAgg, availabilityRows, documents, fleetSettings, gpsRows, openWorkOrders] = await Promise.all([
    canViewFleet || canViewMaintenance || canViewInspections || canViewFuel
      ? db.select({ id: fuelVehicles.id, code: fuelVehicles.code, plate: fuelVehicles.plate, type: fuelVehicles.type, typeName: fuelEquipmentTypes.name, performanceUnit: fuelVehicles.performanceUnit, meterType: fuelVehicles.meterType, worksiteId: fuelVehicles.worksiteId, worksiteName: worksites.name, operationalStatus: fuelVehicles.operationalStatus, intervalStatus: fuelVehicleOperationalIntervals.status, isActive: fuelVehicles.isActive, soapExpiresAt: fuelVehicles.soapExpiresAt, technicalReviewExpiresAt: fuelVehicles.technicalReviewExpiresAt, circulationPermitExpiresAt: fuelVehicles.circulationPermitExpiresAt, insuranceExpiresAt: fuelVehicles.insuranceExpiresAt })
          .from(fuelVehicles)
          .innerJoin(worksites, eq(worksites.id, fuelVehicles.worksiteId))
          .innerJoin(fuelEquipmentTypes, eq(fuelEquipmentTypes.id, fuelVehicles.equipmentTypeId))
          .leftJoin(fuelVehicleOperationalIntervals, and(
            eq(fuelVehicleOperationalIntervals.vehicleId, fuelVehicles.id),
            isNull(fuelVehicleOperationalIntervals.endedAt),
          ))
          .where(vehicleScope)
          .orderBy(fuelVehicles.plate)
      : [],
    canViewServiceEquipment
      ? db.select({ id: serviceEquipment.id, code: serviceEquipment.code, name: serviceEquipment.name, kind: serviceEquipment.kind, worksiteId: serviceEquipment.worksiteId, worksiteName: worksites.name, isActive: serviceEquipment.isActive })
          .from(serviceEquipment).innerJoin(worksites, eq(worksites.id, serviceEquipment.worksiteId)).where(serviceScope).orderBy(serviceEquipment.code)
      : [],
    canViewMaintenance ? db.select({
      vehicleId: maintenanceRecords.vehicleId,
      count: sql<number>`COUNT(*)`,
      openCount: sql<number>`COUNT(*) FILTER (WHERE ${maintenanceRecords.status} IN ('scheduled', 'in_progress'))`,
      completedCorrective: sql<number>`COUNT(*) FILTER (WHERE ${maintenanceRecords.status} = 'completed' AND ${maintenanceRecords.maintenanceType} = 'correctiva')`,
      // Detención recortada al período: una OT que empieza en febrero o termina
      // en abril no puede sumar horas de febrero/abril al período que se mira.
      downtimeHours: sql<number>`COALESCE(SUM(EXTRACT(EPOCH FROM (LEAST(COALESCE(${maintenanceRecords.downtimeEndedAt}, (${period.to}::date + INTERVAL '1 day')), (${period.to}::date + INTERVAL '1 day')) - GREATEST(${maintenanceRecords.downtimeStartedAt}, ${period.from}::date))) / 3600) FILTER (WHERE ${maintenanceRecords.status} <> 'cancelled' AND ${maintenanceRecords.downtimeStartedAt} IS NOT NULL AND ${maintenanceRecords.downtimeStartedAt} < (${period.to}::date + INTERVAL '1 day') AND COALESCE(${maintenanceRecords.downtimeEndedAt}, (${period.to}::date + INTERVAL '1 day')) > ${period.from}::date), 0)`,
      correctiveDowntimeHours: sql<number>`COALESCE(SUM(EXTRACT(EPOCH FROM (LEAST(COALESCE(${maintenanceRecords.downtimeEndedAt}, (${period.to}::date + INTERVAL '1 day')), (${period.to}::date + INTERVAL '1 day')) - GREATEST(${maintenanceRecords.downtimeStartedAt}, ${period.from}::date))) / 3600) FILTER (WHERE ${maintenanceRecords.status} = 'completed' AND ${maintenanceRecords.maintenanceType} = 'correctiva' AND ${maintenanceRecords.downtimeStartedAt} IS NOT NULL AND ${maintenanceRecords.downtimeStartedAt} < (${period.to}::date + INTERVAL '1 day') AND COALESCE(${maintenanceRecords.downtimeEndedAt}, (${period.to}::date + INTERVAL '1 day')) > ${period.from}::date), 0)`,
      // Sin permiso de costos el monto no se recupera en absoluto: proyectar
      // `null` evita traer el dato del driver para descartarlo después.
      cost: canViewCosts
        ? sql<number>`COALESCE(SUM(${maintenanceRecords.totalAmount}) FILTER (WHERE ${maintenanceRecords.status} <> 'cancelled'), 0)`
        : sql<null>`null`,
      approvedCost: canViewCosts
        ? sql<number>`COALESCE(SUM(${maintenanceRecords.totalAmount}) FILTER (WHERE ${maintenanceRecords.status} = 'completed' AND ${maintenanceRecords.costApprovalStatus} IN ('approved', 'not_required')), 0)`
        : sql<null>`null`,
      overdueSla: sql<number>`(COUNT(*) FILTER (WHERE ${maintenanceRecords.status} IN ('scheduled', 'in_progress') AND ${maintenanceRecords.slaDueAt} < now()))::int`,
      unassignedOpen: sql<number>`(COUNT(*) FILTER (WHERE ${maintenanceRecords.status} IN ('scheduled', 'in_progress') AND ${maintenanceRecords.assignedToUserId} IS NULL))::int`,
      preventiveCompleted: sql<number>`COUNT(*) FILTER (WHERE ${maintenanceRecords.status} = 'completed' AND ${maintenanceRecords.maintenanceType} = 'preventiva')`,
      preventiveDue: sql<number>`COUNT(*) FILTER (WHERE ${maintenanceRecords.maintenanceType} = 'preventiva' AND ${maintenanceRecords.status} <> 'cancelled')`,
    }).from(maintenanceRecords).innerJoin(fuelVehicles, eq(fuelVehicles.id, maintenanceRecords.vehicleId)).where(and(
      vehicleScope,
      sql`${maintenanceRecords.maintenanceDate} BETWEEN ${period.from} AND ${period.to}`,
    )).groupBy(maintenanceRecords.vehicleId) : [],
    // Adherencia al plan: planes activos que vencen en el período y cuántos de
    // ellos tienen al menos una OT no cancelada. `nextPlanDue` no se recorta al
    // período: sirve para ver el próximo vencimiento del activo.
    canViewMaintenance ? db.select({
      vehicleId: maintenancePlans.vehicleId,
      plansDue: sql<number>`(COUNT(DISTINCT ${maintenancePlans.id}) FILTER (WHERE ${maintenancePlans.nextDueDate} BETWEEN ${period.from} AND ${period.to}))::int`,
      plansWithRecord: sql<number>`(COUNT(DISTINCT ${maintenancePlans.id}) FILTER (WHERE ${maintenancePlans.nextDueDate} BETWEEN ${period.from} AND ${period.to} AND ${maintenanceRecords.id} IS NOT NULL))::int`,
      nextPlanDue: sql<string | null>`MIN(${maintenancePlans.nextDueDate})`,
    })
      .from(maintenancePlans)
      .leftJoin(maintenanceRecords, and(
        eq(maintenanceRecords.planId, maintenancePlans.id),
        sql`${maintenanceRecords.maintenanceDate} BETWEEN ${period.from} AND ${period.to}`,
        sql`${maintenanceRecords.status} <> 'cancelled'`,
      ))
      .innerJoin(fuelVehicles, eq(fuelVehicles.id, maintenancePlans.vehicleId))
      .where(and(vehicleScope, eq(maintenancePlans.isActive, true)))
      .groupBy(maintenancePlans.vehicleId) : [],
    canViewInspections ? db.select({
      vehicleId: preventionInspectionRuns.subjectVehicleId,
      count: sql<number>`COUNT(*) FILTER (WHERE ${preventionInspectionRuns.status} <> 'cancelled')`,
      nonConforming: sql<number>`COALESCE(SUM(${preventionInspectionRuns.nonConformingCount}) FILTER (WHERE ${preventionInspectionRuns.status} <> 'cancelled'), 0)::int`,
      partial: sql<number>`COALESCE(SUM(${preventionInspectionRuns.partialCount}) FILTER (WHERE ${preventionInspectionRuns.status} <> 'cancelled'), 0)::int`,
      compliance: sql<number | null>`(AVG(${preventionInspectionRuns.compliancePercent}) FILTER (WHERE ${preventionInspectionRuns.status} <> 'cancelled' AND ${preventionInspectionRuns.compliancePercent} IS NOT NULL))::float8`,
    })
      .from(preventionInspectionRuns)
      .innerJoin(fuelVehicles, eq(fuelVehicles.id, preventionInspectionRuns.subjectVehicleId))
      .where(and(vehicleScope, sql`${preventionInspectionRuns.scheduledFor} BETWEEN ${period.from} AND ${period.to}`))
      .groupBy(preventionInspectionRuns.subjectVehicleId) : [],
    // Los hallazgos abiertos son trabajo vigente, no del período: un hallazgo
    // crítico de una inspección anterior sigue importando hoy.
    canViewInspections ? db.select({
      vehicleId: preventionInspectionRuns.subjectVehicleId,
      openFindings: sql<number>`COUNT(*)::int`,
      criticalOpenFindings: sql<number>`(COUNT(*) FILTER (WHERE ${preventionInspectionFindings.criticality} = 'critical'))::int`,
    })
      .from(preventionInspectionFindings)
      .innerJoin(preventionInspectionRuns, eq(preventionInspectionRuns.id, preventionInspectionFindings.runId))
      .innerJoin(fuelVehicles, eq(fuelVehicles.id, preventionInspectionRuns.subjectVehicleId))
      .where(and(
        vehicleScope,
        isNotNull(preventionInspectionRuns.subjectVehicleId),
        sql`${preventionInspectionRuns.status} <> 'cancelled'`,
        inArray(preventionInspectionFindings.status, ["open", "capa_linked"]),
      ))
      .groupBy(preventionInspectionRuns.subjectVehicleId) : [],
    // CAPA vencidas: sólo las vinculadas a hallazgos de inspección y sólo con
    // la capacidad de CAPA. Una CAPA cerrada o cancelada no está vencida.
    canViewInspections && canViewCapa ? db.select({
      vehicleId: preventionInspectionRuns.subjectVehicleId,
      // DISTINCT: una misma CAPA puede estar referenciada por más de un hallazgo.
      overdueCapa: sql<number>`COUNT(DISTINCT ${preventionCapaActions.id})::int`,
    })
      .from(preventionCapaActions)
      .innerJoin(preventionInspectionFindings, eq(preventionInspectionFindings.capaActionId, preventionCapaActions.id))
      .innerJoin(preventionInspectionRuns, eq(preventionInspectionRuns.id, preventionInspectionFindings.runId))
      .innerJoin(fuelVehicles, eq(fuelVehicles.id, preventionInspectionRuns.subjectVehicleId))
      .where(and(
        vehicleScope,
        isNotNull(preventionInspectionRuns.subjectVehicleId),
        sql`${preventionInspectionRuns.status} <> 'cancelled'`,
        sql`${preventionCapaActions.status} NOT IN ('closed', 'cancelled')`,
        sql`${preventionCapaActions.targetDate} < ${today}`,
      ))
      .groupBy(preventionInspectionRuns.subjectVehicleId) : [],
    // La disponibilidad es un indicador de Flota: se consulta sólo con
    // `flota:view`. Entrar al hub por mantención o inspección no habilita este
    // subdominio.
    canViewFleet ? db.select({
      vehicleId: fuelVehicleOperationalIntervals.vehicleId,
      totalHours: sql<number>`COALESCE(SUM(EXTRACT(EPOCH FROM (LEAST(COALESCE(${fuelVehicleOperationalIntervals.endedAt}, (${period.to}::date + INTERVAL '1 day')), (${period.to}::date + INTERVAL '1 day')) - GREATEST(${fuelVehicleOperationalIntervals.startedAt}, ${period.from}::date))) / 3600) FILTER (WHERE ${fuelVehicleOperationalIntervals.startedAt} < (${period.to}::date + INTERVAL '1 day') AND COALESCE(${fuelVehicleOperationalIntervals.endedAt}, (${period.to}::date + INTERVAL '1 day')) > ${period.from}::date), 0)`,
      operativeHours: sql<number>`COALESCE(SUM(EXTRACT(EPOCH FROM (LEAST(COALESCE(${fuelVehicleOperationalIntervals.endedAt}, (${period.to}::date + INTERVAL '1 day')), (${period.to}::date + INTERVAL '1 day')) - GREATEST(${fuelVehicleOperationalIntervals.startedAt}, ${period.from}::date))) / 3600) FILTER (WHERE ${fuelVehicleOperationalIntervals.status} = 'operativo' AND ${fuelVehicleOperationalIntervals.startedAt} < (${period.to}::date + INTERVAL '1 day') AND COALESCE(${fuelVehicleOperationalIntervals.endedAt}, (${period.to}::date + INTERVAL '1 day')) > ${period.from}::date), 0)`,
    }).from(fuelVehicleOperationalIntervals).innerJoin(fuelVehicles, eq(fuelVehicles.id, fuelVehicleOperationalIntervals.vehicleId)).where(and(vehicleScope, eq(fuelVehicles.isActive, true))).groupBy(fuelVehicleOperationalIntervals.vehicleId) : [],
    // Los documentos se consultan siempre que la sesión vea flota: la fila del
    // activo necesita su próximo vencimiento también en la exportación, no sólo
    // el tile de atención. Los ajustes sí son exclusivos del tile.
    canViewFleet ? settleAttention("documentos de flota", () => db.select({
      vehicleId: fleetVehicleDocuments.vehicleId,
      documentType: fleetVehicleDocuments.documentType,
      expiresAt: fleetVehicleDocuments.expiresAt,
    }).from(fleetVehicleDocuments)
      .innerJoin(fuelVehicles, eq(fuelVehicles.id, fleetVehicleDocuments.vehicleId))
      .where(and(
        isNotNull(fleetVehicleDocuments.expiresAt),
        eq(fleetVehicleDocuments.status, "current"),
        vehicleScope,
      )), degradedSources) : [],
    includeAttention && canViewFleet ? settleAttention("ajustes de flota", () => getFleetAdminSettings(), degradedSources) : null,
    // Última telemetría por vehículo; puede haber más de un dispositivo por
    // equipo, así que se toma la lectura observada más reciente.
    canViewFleet ? settleAttention("telemetría GPS", () => db.selectDistinctOn([fleetGpsLatestPositions.vehicleId], {
      vehicleId: fleetGpsLatestPositions.vehicleId,
      odometer: fleetGpsLatestPositions.odometer,
      hourMeter: fleetGpsLatestPositions.hourMeter,
      observedAt: fleetGpsLatestPositions.observedAt,
      fuelLevel: fleetGpsLatestPositions.fuelLevel,
    }).from(fleetGpsLatestPositions)
      .innerJoin(fuelVehicles, eq(fuelVehicles.id, fleetGpsLatestPositions.vehicleId))
      .where(vehicleScope)
      .orderBy(fleetGpsLatestPositions.vehicleId, desc(fleetGpsLatestPositions.observedAt)), degradedSources) : [],
    // Las OT abiertas que cuenta `/mantenciones?status=abiertas`: todas las del
    // alcance de la OT (no del vehículo), sin ventana de fechas. No es el
    // `backlog` de las métricas, que sólo ve las OT fechadas dentro del período.
    includeAttention && canViewMaintenance ? settleAttention("OT abiertas", async () => {
      const [row] = await db.select({ count: sql<number>`COUNT(*)::int` }).from(maintenanceRecords).where(and(
        worksiteScopeSql(session, maintenanceRecords.worksiteId),
        inArray(maintenanceRecords.status, [...MAINTENANCE_OPEN_STATUSES]),
      ))
      return Number(row?.count ?? 0)
    }, degradedSources) : null,
  ])

  // El agregado de combustible se pide después de conocer los vehículos del
  // alcance: una consulta agrupada por vehículo, no una por fila. Sin
  // `combustibles:view` no se ejecuta y los campos quedan en null.
  const fuelSummary = canViewFuel && vehicles.length > 0
    ? await getAssetFuelSummary(session, period, vehicles.map((vehicle) => vehicle.id))
    : new Map<string, AssetFuelSummary>()

  const maintenanceByVehicle = new Map(maintenanceAgg.map((row) => [row.vehicleId, row]))
  const planByVehicle = new Map(planAgg.map((row) => [row.vehicleId, row]))
  const inspectionsByVehicle = new Map(inspectionAgg.filter((row) => row.vehicleId).map((row) => [row.vehicleId!, row]))
  const findingsByVehicle = new Map(findingsAgg.filter((row) => row.vehicleId).map((row) => [row.vehicleId!, row]))
  const capaByVehicle = new Map(capaAgg.filter((row) => row.vehicleId).map((row) => [row.vehicleId!, row]))
  const documentsByVehicle = new Map<string, Array<{ documentType: string; expiresAt: string | null }>>()
  for (const document of documents ?? []) {
    const list = documentsByVehicle.get(document.vehicleId)
    if (list) list.push({ documentType: document.documentType, expiresAt: document.expiresAt })
    else documentsByVehicle.set(document.vehicleId, [{ documentType: document.documentType, expiresAt: document.expiresAt }])
  }
  const gpsByVehicle = new Map((gpsRows ?? []).filter((row) => row.vehicleId).map((row) => [row.vehicleId!, row]))
  const vehicleAssets: OperationalAsset[] = vehicles.map((vehicle) => {
    const maintenance = maintenanceByVehicle.get(vehicle.id)
    const plan = planByVehicle.get(vehicle.id)
    const inspections = inspectionsByVehicle.get(vehicle.id)
    const findings = findingsByVehicle.get(vehicle.id)
    const capa = capaByVehicle.get(vehicle.id)
    const fuel = fuelSummary.get(vehicle.id)
    const vehicleDocuments = documentsByVehicle.get(vehicle.id) ?? []
    const gps = gpsByVehicle.get(vehicle.id)
    const declaredExpiry = {
      soapExpiresAt: vehicle.soapExpiresAt,
      technicalReviewExpiresAt: vehicle.technicalReviewExpiresAt,
      circulationPermitExpiresAt: vehicle.circulationPermitExpiresAt,
      insuranceExpiresAt: vehicle.insuranceExpiresAt,
    }
    const rawStatus = vehicle.isActive ? vehicle.operationalStatus : "inactivo"
    const fuelPerformanceUnit = canViewFuel && (vehicle.performanceUnit === "km_per_liter" || vehicle.performanceUnit === "liters_per_hour")
      ? vehicle.performanceUnit
      : null
    // La lectura de la carga y la telemetría sólo son comparables si hablan
    // del mismo medidor, son recientes entre sí y la diferencia supera el
    // ruido normal de dos fuentes distintas (2 h / 5 km).
    const gpsMeter = vehicle.meterType === "hour_meter" ? gps?.hourMeter : vehicle.meterType === "odometer" ? gps?.odometer : null
    const meterMismatch = canViewFleet && canViewFuel
      && vehicle.meterType !== "none"
      && fuel?.lastMeterReading != null
      && fuel.lastMeterType === vehicle.meterType
      && fuel.lastMeterAt != null
      && gps?.observedAt != null
      && gpsMeter != null
      && Math.abs(Date.parse(gps.observedAt) - Date.parse(fuel.lastMeterAt)) <= 7 * 86_400_000
      && Math.abs(Number(gpsMeter) - fuel.lastMeterReading) > (vehicle.meterType === "hour_meter" ? 2 : 5)
    return {
      key: `vehicle:${vehicle.id}`,
      kind: "vehicle",
      id: vehicle.id,
      code: vehicle.code ?? vehicle.plate,
      name: `${vehicle.typeName ?? vehicle.type} · ${vehicle.plate}`,
      worksiteId: vehicle.worksiteId,
      worksiteName: vehicle.worksiteName,
      operationalStatus: rawStatus,
      operationalStatusLabel: vehicle.isActive
        ? formatFuelVehicleStatus(vehicle.operationalStatus)
        : "Inactivo",
      stateMismatch: vehicle.isActive
        && vehicle.intervalStatus != null
        && vehicle.intervalStatus !== vehicle.operationalStatus,
      capabilities: ["fuel", "inspections", "maintenance"] as const,
      maintenanceCount: Number(maintenance?.count ?? 0),
      openMaintenanceCount: Number(maintenance?.openCount ?? 0),
      inspectionCount: Number(inspections?.count ?? 0),
      inspectionCompliancePercent: canViewInspections
        ? (inspections?.compliance == null ? null : Number(inspections.compliance))
        : null,
      inspectionNonConforming: canViewInspections ? Number(inspections?.nonConforming ?? 0) : null,
      inspectionPartial: canViewInspections ? Number(inspections?.partial ?? 0) : null,
      openFindings: canViewInspections ? Number(findings?.openFindings ?? 0) : null,
      criticalOpenFindings: canViewInspections ? Number(findings?.criticalOpenFindings ?? 0) : null,
      overdueCapa: canViewInspections && canViewCapa ? Number(capa?.overdueCapa ?? 0) : null,
      downtimeHours: Number(maintenance?.downtimeHours ?? 0),
      maintenanceCost: canViewCosts ? Number(maintenance?.cost ?? 0) : null,
      maintenanceCostApproved: canViewCosts ? Number(maintenance?.approvedCost ?? 0) : null,
      openSlaOverdue: canViewMaintenance ? Number(maintenance?.overdueSla ?? 0) : null,
      unassignedOpen: canViewMaintenance ? Number(maintenance?.unassignedOpen ?? 0) : null,
      nextPlanDue: canViewMaintenance ? (plan?.nextPlanDue ?? null) : null,
      nextExpiryDate: canViewFleet ? resolveNextExpiryDate(declaredExpiry, vehicleDocuments) : null,
      expiredDocumentTypes: canViewFleet ? expiredDocumentTypes(declaredExpiry, vehicleDocuments, today) : [],
      gpsOdometer: canViewFleet ? (gps?.odometer == null ? null : Number(gps.odometer)) : null,
      gpsHourMeter: canViewFleet ? (gps?.hourMeter == null ? null : Number(gps.hourMeter)) : null,
      gpsObservedAt: canViewFleet ? (gps?.observedAt ?? null) : null,
      gpsFuelLevel: canViewFleet ? (gps?.fuelLevel == null ? null : Number(gps.fuelLevel)) : null,
      fuelLiters: canViewFuel ? (fuel?.liters ?? 0) : null,
      fuelLoadCount: canViewFuel ? (fuel?.loadCount ?? 0) : null,
      lastFuelLoadAt: canViewFuel ? (fuel?.lastLoadAt ?? null) : null,
      fuelPerformanceValue: canViewFuel ? (fuel?.performanceValue ?? null) : null,
      fuelPerformanceUnit,
      flaggedLoads: canViewFuel ? (fuel?.flaggedLoads ?? 0) : null,
      openAnomalyCases: canViewFuel ? (fuel?.openCases ?? 0) : null,
      criticalOpenAnomalyCases: canViewFuel ? (fuel?.criticalOpenCases ?? 0) : null,
      fuelBilledAmount: canViewFuel && canViewCosts ? (fuel?.billedAmount ?? 0) : null,
      idleHours: canViewFuel ? (fuel?.idleHours ?? 0) : null,
      idlePct: canViewFuel ? (fuel?.idlePct ?? null) : null,
      litersIdle: canViewFuel ? (fuel?.litersIdle ?? null) : null,
      meterMismatch,
    }
  })
  const serviceAssets: OperationalAsset[] = instruments.map((instrument) => ({
    key: `service_equipment:${instrument.id}`,
    kind: "service_equipment",
    id: instrument.id,
    code: instrument.code,
    name: instrument.name,
    worksiteId: instrument.worksiteId,
    worksiteName: instrument.worksiteName,
    operationalStatus: instrument.isActive ? "operativo" : "inactivo",
    operationalStatusLabel: instrument.isActive ? "Operativo" : "Inactivo",
    stateMismatch: false,
    capabilities: ["service_requests"] as const,
    maintenanceCount: 0,
    openMaintenanceCount: 0,
    inspectionCount: 0,
    inspectionCompliancePercent: null,
    inspectionNonConforming: null,
    inspectionPartial: null,
    openFindings: null,
    criticalOpenFindings: null,
    overdueCapa: null,
    maintenanceCostApproved: null,
    openSlaOverdue: null,
    unassignedOpen: null,
    nextPlanDue: null,
    nextExpiryDate: null,
    expiredDocumentTypes: [],
    gpsOdometer: null,
    gpsHourMeter: null,
    gpsObservedAt: null,
    gpsFuelLevel: null,
    downtimeHours: 0,
    // Los instrumentos de servicio no tienen costo de mantención modelado
    // todavía; devolver null (no 0) fuerza a la UI a pintar "—" en vez de
    // "$0" — bug B-05. Cuando el módulo `service_requests` se conecte, esto
    // será un cálculo real.
    maintenanceCost: null,
    // Tampoco tienen serie de combustible: no son `fuel_vehicles` y no
    // aparecen en las cargas. Null, no 0, para no simular un historial vacío.
    fuelLiters: null,
    fuelLoadCount: null,
    lastFuelLoadAt: null,
    fuelPerformanceValue: null,
    fuelPerformanceUnit: null,
    flaggedLoads: null,
    openAnomalyCases: null,
    criticalOpenAnomalyCases: null,
    fuelBilledAmount: null,
    idleHours: null,
    idlePct: null,
    litersIdle: null,
    meterMismatch: false,
  }))

  const totalIntervalHours = availabilityRows.reduce((sum, row) => sum + Number(row.totalHours), 0)
  const operativeHours = availabilityRows.reduce((sum, row) => sum + Number(row.operativeHours), 0)
  const periodDays = Math.round(
    (Date.parse(`${period.to}T00:00:00Z`) - Date.parse(`${period.from}T00:00:00Z`)) / 86_400_000,
  ) + 1
  const calendarHours = vehicles.filter((vehicle) => vehicle.isActive).length * periodDays * 24
  const totalDowntime = maintenanceAgg.reduce((sum, row) => sum + Number(row.downtimeHours), 0)
  const correctiveDowntimeHours = maintenanceAgg.reduce((sum, row) => sum + Number(row.correctiveDowntimeHours), 0)
  const completedCorrective = maintenanceAgg.reduce((sum, row) => sum + Number(row.completedCorrective), 0)
  const preventiveCompleted = maintenanceAgg.reduce((sum, row) => sum + Number(row.preventiveCompleted), 0)
  const preventiveDue = maintenanceAgg.reduce((sum, row) => sum + Number(row.preventiveDue), 0)
  const attention: OperationalAttention = {
    stoppedVehicles: includeAttention && canViewFleet ? countStoppedVehicles(vehicles) : null,
    fleetDocuments: fleetSettings && documents
      ? {
          warningDays: fleetSettings.warningDays,
          ...countFleetDocumentExpiry(vehicles, documents, {
            today,
            warningWindowEnd: addDaysToPlainDate(today, fleetSettings.warningDays),
          }),
        }
      : null,
    openWorkOrders,
  }
  return {
    period,
    attention,
    degradedSources,
    assets: [...vehicleAssets, ...serviceAssets],
    metrics: calculateOperationalControlMetrics({
      totalIntervalHours,
      calendarHours,
      operativeHours,
      downtimeHours: totalDowntime,
      correctiveDowntimeHours,
      completedCorrective,
      preventiveCompleted,
      preventiveDue,
      backlog: vehicleAssets.reduce((sum, asset) => sum + asset.openMaintenanceCount, 0),
      maintenanceCost: maintenanceAgg.reduce((sum, row) => sum + Number(row.cost ?? 0), 0),
      maintenanceCostApproved: maintenanceAgg.reduce((sum, row) => sum + Number(row.approvedCost ?? 0), 0),
      plansDue: planAgg.reduce((sum, row) => sum + Number(row.plansDue ?? 0), 0),
      plansWithRecord: planAgg.reduce((sum, row) => sum + Number(row.plansWithRecord ?? 0), 0),
      overdueSla: maintenanceAgg.reduce((sum, row) => sum + Number(row.overdueSla ?? 0), 0),
      unassignedOpen: maintenanceAgg.reduce((sum, row) => sum + Number(row.unassignedOpen ?? 0), 0),
      canViewCosts,
    }),
    permissions: { canViewFleet, canViewMaintenance, canViewInspections, canViewCapa, canViewFuel, canViewCosts, canViewServiceEquipment },
  }
}
