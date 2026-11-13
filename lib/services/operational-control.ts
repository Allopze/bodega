import type { Session } from "next-auth"
import { and, desc, eq, gte, inArray, isNotNull, isNull, lt, sql } from "drizzle-orm"
import { db } from "@/db"
import {
  fleetVehicleDocuments,
  fuelAnomalyRules,
  fuelEquipmentTypes,
  fuelMeterReadings,
  fuelVehicleOperationalIntervals,
  fuelVehicles,
  mantWorkOrders,
  preventionCapaActions,
  preventionInspectionFindings,
  preventionInspectionRuns,
  serviceEquipment,
  worksites,
} from "@/db/schema"
import { can } from "@/lib/auth/can"
import { serviceWorksiteScope, worksiteScopeSql } from "@/lib/auth/scope"
import { expiredDocumentTypes, resolveNextExpiryDate } from "@/lib/validation/fleet-documents"
import { getAssetFuelSummary, type AssetFuelSummary } from "@/lib/combustibles/control/queries/asset-fuel-summary"
import { getVehiclePurchaseSummary, type VehiclePurchaseSummary } from "@/lib/services/purchasing-module/vehicle-purchase-summary"
import { logger } from "@/lib/logger"
import { getFleetAdminSettings } from "@/lib/services/system-settings"
import { loadMergedGpsByVehicle } from "@/lib/services/fleet-gps-latest"
import { maxMeterRatePerDayOf, meterSeriesAdvance, meterSeriesCoversPeriod, type MeterSeriesPoint } from "@/lib/combustibles/meter-series"
import { loadFleet } from "@/lib/services/mantencion/fleet"
import {
  getVehicleWorkOrderMetrics,
  getWorkOrderGlobalMetrics,
  meanTimeToRepairHours,
  workOrderMetricsScope,
  type VehicleWorkOrderMetrics,
  type WorkOrderGlobalMetrics,
} from "@/lib/services/mantencion/work-orders/metrics"
import {
  canViewPurchaseCosts as sessionCanViewPurchaseCosts,
  canViewMaintenanceEquipment as sessionCanViewMaintenanceEquipment,
  canViewWorkOrders as sessionCanViewWorkOrders,
} from "@/lib/operational-control/capabilities"
import { addDaysToPlainDate, chileDayStartInstant, todayInChile } from "@/lib/utils"
import { civilDate } from "@/lib/validation/dates"
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
  /** Patente y tipo por separado, para `VehicleIdentity`; `name` ya los junta («Camión · patente») para la exportación y la búsqueda. */
  plate?: string | null
  typeName?: string | null
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
  capabilities: readonly ("fuel" | "inspections" | "service_requests")[]
  inspectionCount: number
  /** Promedio de cumplimiento de las inspecciones del período; `null` sin dato. */
  inspectionCompliancePercent: number | null
  /** Suma de no conformes y parciales de las inspecciones del período. */
  inspectionNonConforming: number | null
  inspectionPartial: number | null
  /** Hallazgos abiertos (`open` o `capa_linked`) del activo; no dependen del período. */
  openFindings: number | null
  criticalOpenFindings: number | null
  /** Hallazgos abiertos con una OT vigente vinculada (`inspection_finding_id`). */
  openFindingsWithWorkOrder: number | null
  /** Hallazgos abiertos que todavía no entraron a Mantención como OT. */
  openFindingsWithoutWorkOrder: number | null
  /** CAPA vencidas vinculadas a hallazgos de inspección; sólo con `prevention:capa:view`. */
  overdueCapa: number | null
  /** Próximo vencimiento documental del activo, con el criterio de Flota. */
  nextExpiryDate: string | null
  /** Tipos documentales vencidos; vacío si no hay ninguno. */
  expiredDocumentTypes: string[]
  gpsOdometer: number | null
  gpsHourMeter: number | null
  gpsObservedAt: string | null
  gpsFuelLevel: number | null
  /** Fuente que aportó la posición más reciente (`onway` o `wialon`). */
  gpsProvider: string | null
  /** Fuentes que reportaron el equipo; puede haber más de una. */
  gpsProviders: string[]
  /** La posición más reciente supera los 15 minutos. */
  gpsStale: boolean
  /** Hora del mensaje del dispositivo, no la de la consulta. */
  gpsReportedAt: string | null
  gpsOdometerAt: string | null
  gpsHourMeterAt: string | null
  gpsFuelLevelAt: string | null
  /** Última posición: velocidad y encendido, para cruzar uso con prevención. */
  gpsSpeedKph: number | null
  gpsIgnition: boolean | null
  /** Rendimiento calculado con la serie GPS del período; `null` si la cobertura no alcanza. */
  gpsPerformanceValue: number | null
  gpsPerformanceUnit: "km_per_liter" | "liters_per_hour" | null
  gpsPerformanceStatus: "ok" | "insufficient_series" | "insufficient_period" | "no_fuel" | "not_applicable"
  /** Costo total del período ÷ avance GPS; `null` sin costo completo o cobertura. */
  gpsCostPerUnit: number | null
  /** Serie de `fuel_meter_readings` con que se calculó el avance (VisionLink = horómetro oficial de Cat). */
  gpsMeterSource: "visionlink_api" | "gps_wialon" | "gps_onway" | null
  /** Proveedor del que salieron odómetro y horómetro; no se mezclan fuentes. */
  gpsMeterProvider: string | null
  /** Estimación de mantención con la lectura GPS; nunca reemplaza el estado oficial. */
  gpsMaintenanceState: import("@/lib/mantencion/types").MantEquipmentState | null
  gpsMaintenanceNextReading: number | null
  gpsMaintenanceRemaining: number | null
  gpsMaintenanceReadingAt: string | null
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
  /** Costo del período según el libro del proveedor (`fuel_provider_transactions`); sólo con `combustibles:view_costs`. */
  fuelBilledAmount: number | null
  /**
   * Mano de obra / taller externo: Σ `total_cost` de las OT cerradas del período, que
   * jefatura carga a mano. No incluye los repuestos ni los servicios comprados por OC
   * (van en `purchaseAmount`). $0 si el equipo no tiene OT cerradas con costo en el
   * período; `null` sólo sin la capacidad de OT o si su consulta falló.
   */
  maintenanceCost: number | null
  /**
   * Σ líneas de OC (no anuladas) emitidas en el período, de las solicitudes de repuestos o
   * servicios vinculadas al equipo. `null` sin `purchasing:view` o si la consulta falló.
   */
  purchaseAmount: number | null
  /** Combustible + mano de obra + compras; `null` si falta cualquiera de las tres series. */
  totalCost: number | null
  /** Horas de motor en vacío del período; `null` sin `combustibles:view`. */
  idleHours: number | null
  /** Σ vacío ÷ Σ funcionamiento del período. */
  idlePct: number | null
  /** Litros consumidos en vacío; `null` si la telemetría no trae el dato. */
  litersIdle: number | null
  /** La lectura de la carga y la telemetría discrepan para el mismo medidor. */
  meterMismatch: boolean
  /** OT abiertas del equipo (no dependen del período); `null` sin `mant:ot:view_*`. */
  openWorkOrders: number | null
  /** El equipo está hoy en el taller: OT en ejecución con ingreso y sin salida. */
  inWorkshop: boolean | null
  /** Horas en taller dentro del período (ingreso → salida recortado al período). */
  workshopHours: number | null
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
 * vehículos del alcance (activos e inactivos, como `/flota`).
 */
export interface OperationalAttention {
  stoppedVehicles: StoppedVehicles | null
  fleetDocuments: (FleetDocumentExpiry & { warningDays: number }) | null
  /** OT abiertas hoy, con las sin asignar y las de entrega vencida; `null` sin la capacidad de OT o si falló. */
  workOrders: WorkOrderGlobalMetrics | null
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
   * emiten sus consultas (documentos de flota y ajustes de aviso) ni
   * se cuentan los detenidos, y `attention` queda con todos sus campos en `null`.
   */
  includeAttention?: boolean
}

type GpsPerformanceStatus = "ok" | "insufficient_series" | "insufficient_period" | "no_fuel" | "not_applicable"

/**
 * Avance del medidor en el período. Se elige UNA fuente, la primera que cubra el
 * período completo: para horómetro, VisionLink (el acumulado oficial de Cat) y
 * después Wialon y OnWay; para odómetro, Wialon y OnWay. Nunca se encadenan
 * puntos de proveedores distintos, porque son medidores y calibraciones
 * distintas.
 */
type GpsAdvanceSource = "visionlink_api" | "gps_wialon" | "gps_onway"

function computeGpsAdvance(
  vehicle: { id: string; performanceUnit: string; equipmentTypeSlug: string | null },
  series: ReadonlyMap<string, MeterSeriesPoint[]>,
  period: { from: string; to: string },
  jumpRule: { config: string | null },
): { advance: number | null; source: GpsAdvanceSource | null; status: GpsPerformanceStatus } {
  if (vehicle.performanceUnit !== "km_per_liter" && vehicle.performanceUnit !== "liters_per_hour") {
    return { advance: null, source: null, status: "not_applicable" }
  }
  const meterType = vehicle.performanceUnit === "km_per_liter" ? "odometer" : "hour_meter"
  const candidates: GpsAdvanceSource[] = meterType === "hour_meter"
    ? ["visionlink_api", "gps_wialon", "gps_onway"]
    : ["gps_wialon", "gps_onway"]
  const pointsOf = (source: GpsAdvanceSource) => series.get(`${vehicle.id}:${source}:${meterType}`) ?? []
  // Primero la fuente que cubre el período COMPLETO: tener dos puntos de hace
  // tres días no sirve para dividir los 90 días de gasto.
  const source = candidates.find((candidate) => meterSeriesCoversPeriod(pointsOf(candidate), period.from, period.to)) ?? null
  if (!source) {
    // Se informa la fuente que existe para que la UI no diga «sin proveedor»;
    // el estado distingue serie insuficiente de período incompleto.
    const fallbackSource = candidates.find((candidate) => pointsOf(candidate).length >= 2) ?? null
    return { advance: null, source: fallbackSource, status: fallbackSource ? "insufficient_period" : "insufficient_series" }
  }

  const points = pointsOf(source)
  const maxPerDay = maxMeterRatePerDayOf(
    jumpRule,
    meterType === "odometer" ? "km" : "hora",
    vehicle.equipmentTypeSlug ?? undefined,
  )
  const advance = meterSeriesAdvance(points, maxPerDay).advance
  return advance != null && advance > 0
    ? { advance, source, status: "ok" }
    : { advance: null, source, status: "insufficient_series" }
}

export interface OperationalGpsCross {
  totalVehicles: number
  reporting24h: number
  withoutReport24h: number
  byProvider: { onway: number; wialon: number; both: number }
  meterMismatches: number
  fuelPerformance: { calculated: number; insufficient: number }
  maintenance: { overdue: number; upcoming: number; estimated: number }
  purchases: { calculated: number; insufficient: number }
  prevention: { overdueCapaAssets: number; overdueCapaTotal: number; operatingWithOverdueCapa: number }
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
  const canViewInspections = can(session, "prevention:inspections:view")
  const canViewCapa = can(session, "prevention:capa:view")
  const canViewCosts = can(session, "combustibles:view_costs")
  const canViewFuel = can(session, "combustibles:view")
  const canViewPurchaseCosts = sessionCanViewPurchaseCosts(session)
  const canViewServiceEquipment = can(session, "admin:service_equipment")
  // Las OT se ven con `mant:ot:view_*`; no abren el hub (el gate de abajo sigue
  // siendo flota, inspecciones o combustible) y su alcance es el de las OT.
  const canViewWorkOrders = sessionCanViewWorkOrders(session)
  const canViewMaintenance = sessionCanViewMaintenanceEquipment(session)
  const workOrderScope = canViewWorkOrders ? workOrderMetricsScope(session) : null
  if (!canViewFleet && !canViewInspections && !canViewFuel) throw new Error("Sin permisos para Control operacional")
  const vehicleScope = worksiteScopeSql(session, fuelVehicles.worksiteId)
  const serviceScope = worksiteScopeSql(session, serviceEquipment.worksiteId)
  const today = todayInChile()
  // Secciones que no se pudieron cargar; la página las anuncia en vez de
  // mostrar un vacío indistinguible de «no hay datos».
  const degradedSources: string[] = []

  const [vehicles, instruments, inspectionAgg, findingsAgg, capaAgg, availabilityRows, documents, fleetSettings, gpsRows, workOrders, gpsJumpRules] = await Promise.all([
    canViewFleet || canViewInspections || canViewFuel
      ? db.select({ id: fuelVehicles.id, code: fuelVehicles.code, plate: fuelVehicles.plate, type: fuelVehicles.type, typeName: fuelEquipmentTypes.name, equipmentTypeSlug: fuelEquipmentTypes.slug, performanceUnit: fuelVehicles.performanceUnit, meterType: fuelVehicles.meterType, worksiteId: fuelVehicles.worksiteId, worksiteName: worksites.name, operationalStatus: fuelVehicles.operationalStatus, intervalStatus: fuelVehicleOperationalIntervals.status, isActive: fuelVehicles.isActive, soapExpiresAt: fuelVehicles.soapExpiresAt, technicalReviewExpiresAt: fuelVehicles.technicalReviewExpiresAt, circulationPermitExpiresAt: fuelVehicles.circulationPermitExpiresAt, insuranceExpiresAt: fuelVehicles.insuranceExpiresAt })
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
      // El vínculo hallazgo → OT ya se escribe (`inspection_finding_id`), pero
      // ningún agregado lo leía: el panel no distinguía el trabajo que ya está
      // en Mantención del que sigue esperando una orden.
      openFindingsWithWorkOrder: sql<number>`(COUNT(*) FILTER (WHERE EXISTS (
        SELECT 1 FROM ${mantWorkOrders}
        WHERE ${mantWorkOrders.inspectionFindingId} = ${preventionInspectionFindings.id}
          AND ${mantWorkOrders.status} <> 'anulada'
      )))::int`,
      openFindingsWithoutWorkOrder: sql<number>`(COUNT(*) FILTER (WHERE NOT EXISTS (
        SELECT 1 FROM ${mantWorkOrders}
        WHERE ${mantWorkOrders.inspectionFindingId} = ${preventionInspectionFindings.id}
          AND ${mantWorkOrders.status} <> 'anulada'
      )))::int`,
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
        // Mismo criterio que el filtro «Vencidas» de /prevencion/capa: una CAPA
        // ya verificada está cerrada en los hechos, aunque falte el cierre
        // administrativo. Antes el panel la contaba y el tablero no.
        sql`${preventionCapaActions.status} NOT IN ('verified', 'closed', 'cancelled')`,
        sql`${preventionCapaActions.targetDate} < ${today}`,
      ))
      .groupBy(preventionInspectionRuns.subjectVehicleId) : [],
    // La disponibilidad es un indicador de Flota: se consulta sólo con
    // `flota:view`. Entrar al hub por inspección o combustible no habilita este
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
    // Última telemetría por vehículo, colapsada entre OnWay y Wialon. La
    // posición sale del dispositivo más fresco y cada medidor de su lectura
    // más reciente; nunca se suman series de proveedores distintos.
    canViewFleet ? settleAttention("telemetría GPS", () => loadMergedGpsByVehicle(session), degradedSources) : [],
    // Cifras de OT: por equipo (columna y horas en taller del período) y, sólo
    // para el panel, las globales del tile. Una sola sección degradable: si
    // falla, el resto del panel sigue y las cifras de OT quedan en null.
    workOrderScope ? settleAttention("órdenes de trabajo", async () => {
      const [byVehicle, global] = await Promise.all([
        getVehicleWorkOrderMetrics(workOrderScope, { period }),
        includeAttention ? getWorkOrderGlobalMetrics(workOrderScope, { today }) : Promise.resolve(null),
      ])
      return { byVehicle, global }
    }, degradedSources) : null,
    // Cota de avance para descartar saltos imposibles también en la serie GPS.
    canViewFleet
      ? settleAttention("reglas de medidor", () => db.select({ config: fuelAnomalyRules.config })
          .from(fuelAnomalyRules)
          .where(eq(fuelAnomalyRules.code, "salto_medidor_implausible"))
          .limit(1), degradedSources)
      : [],
  ])

  // Lo comprado por OC para cada equipo (repuestos y servicios vinculados) se pide en
  // paralelo con el combustible y degrada igual: si falla, la cifra queda en «sin
  // dato» (`null`), no en 0, y el panel lo anuncia. Sin `purchasing:view` no se consulta.
  const purchaseSummaryPending = canViewPurchaseCosts && vehicles.length > 0
    ? settleAttention(
        "compras",
        () => getVehiclePurchaseSummary(session, period, vehicles.map((vehicle) => vehicle.id)),
        degradedSources,
      )
    : null
  // El agregado de combustible se pide después de conocer los vehículos del
  // alcance: una consulta agrupada por vehículo, no una por fila. Sin
  // `combustibles:view` no se ejecuta y los campos quedan en null.
  // La consulta de combustible entra en el mismo patrón de degradación que el
  // resto del panel: si falla, las cifras de combustible quedan en «sin dato»
  // y flota, OT e inspecciones siguen renderizando. Antes rechazaba el hub
  // completo y el usuario perdía todo el panel por una sola fuente.
  const fuelSummary = canViewFuel && vehicles.length > 0
    ? await settleAttention(
        "combustible",
        () => getAssetFuelSummary(session, period, vehicles.map((vehicle) => vehicle.id)),
        degradedSources,
      )
    : new Map<string, AssetFuelSummary>()
  const fuelUnavailable = canViewFuel && vehicles.length > 0 && fuelSummary === null
  const fuelByVehicle = fuelSummary ?? new Map<string, AssetFuelSummary>()
  /** `null` cuando la consulta de combustible falló: no se convierte el fallo en 0. */
  const fuelValue = <T,>(value: T | undefined, fallback: T): T | null =>
    fuelUnavailable ? null : (value ?? fallback)

  const purchaseSummary = purchaseSummaryPending ? await purchaseSummaryPending : new Map<string, VehiclePurchaseSummary>()
  /** `null` cuando la consulta de compras falló: tampoco se convierte en 0. */
  const purchaseUnavailable = purchaseSummaryPending !== null && purchaseSummary === null
  const purchaseByVehicle = purchaseSummary ?? new Map<string, VehiclePurchaseSummary>()

  // La serie de medidores GPS se filtra por instantes de día chileno: el
  // período es una fecha civil, no un corte UTC.
  const gpsPeriodStart = chileDayStartInstant(period.from)
  const gpsPeriodEnd = chileDayStartInstant(addDaysToPlainDate(period.to, 1))
  const gpsChileDay = sql`(${fuelMeterReadings.occurredAt}::timestamptz at time zone 'America/Santiago')::date`

  // Serie de medidores GPS del período. Se lee de `fuel_meter_readings`, que ya
  // distingue la fuente; no se mezcla con Copec ni entre proveedores.
  const gpsMeterRows = canViewFleet && vehicles.length > 0
    ? await settleAttention("medidores GPS", () => db.selectDistinctOn(
        [
          fuelMeterReadings.vehicleId,
          fuelMeterReadings.source,
          fuelMeterReadings.meterType,
          gpsChileDay,
        ],
        {
          vehicleId: fuelMeterReadings.vehicleId,
          source: fuelMeterReadings.source,
          meterType: fuelMeterReadings.meterType,
          occurredAt: fuelMeterReadings.occurredAt,
          value: fuelMeterReadings.value,
        },
      )
        .from(fuelMeterReadings)
        .innerJoin(fuelVehicles, eq(fuelVehicles.id, fuelMeterReadings.vehicleId))
        .where(and(
          inArray(fuelMeterReadings.source, ["gps_wialon", "gps_onway", "visionlink_api"]),
          inArray(fuelMeterReadings.vehicleId, vehicles.map((vehicle) => vehicle.id)),
          // Rango sobre la columna indexada; el día sólo se usa para reducir a
          // una lectura diaria por fuente y medidor, no para filtrar.
          gte(fuelMeterReadings.occurredAt, gpsPeriodStart),
          lt(fuelMeterReadings.occurredAt, gpsPeriodEnd),
        ))
        .orderBy(
          fuelMeterReadings.vehicleId,
          fuelMeterReadings.source,
          fuelMeterReadings.meterType,
          gpsChileDay,
          desc(fuelMeterReadings.occurredAt),
        ), degradedSources)
    : []

  const gpsSeries = new Map<string, MeterSeriesPoint[]>()
  for (const row of gpsMeterRows ?? []) {
    if (!row.vehicleId) continue
    const key = `${row.vehicleId}:${row.source}:${row.meterType}`
    const points = gpsSeries.get(key) ?? []
    points.push({ value: Number(row.value), occurredAt: row.occurredAt })
    gpsSeries.set(key, points)
  }
  const gpsJumpRule = { config: (gpsJumpRules ?? [])[0]?.config ?? null }

  // Estimación de mantención por GPS: se apoya en las reglas puras de
  // Mantención, pero no escribe ni reemplaza la lectura oficial.
  const maintenanceEstimates = canViewFleet && canViewMaintenance && vehicles.length > 0
    ? await settleAttention("mantención GPS", () => loadFleet({
        scope: serviceWorksiteScope(session),
        vehicleIds: vehicles.map((vehicle) => vehicle.id),
        readingsPerEquipment: 1,
        includeGpsEstimate: true,
      }), degradedSources)
    : []
  const maintenanceByVehicle = new Map((maintenanceEstimates ?? []).map((row) => [row.vehicleId, row]))

  const inspectionsByVehicle = new Map(inspectionAgg.filter((row) => row.vehicleId).map((row) => [row.vehicleId!, row]))
  const findingsByVehicle = new Map(findingsAgg.filter((row) => row.vehicleId).map((row) => [row.vehicleId!, row]))
  const capaByVehicle = new Map(capaAgg.filter((row) => row.vehicleId).map((row) => [row.vehicleId!, row]))
  const documentsByVehicle = new Map<string, Array<{ documentType: string; expiresAt: string | null }>>()
  for (const document of documents ?? []) {
    const list = documentsByVehicle.get(document.vehicleId)
    if (list) list.push({ documentType: document.documentType, expiresAt: document.expiresAt })
    else documentsByVehicle.set(document.vehicleId, [{ documentType: document.documentType, expiresAt: document.expiresAt }])
  }
  const workOrdersByVehicle: Map<string, VehicleWorkOrderMetrics> | null = workOrders?.byVehicle ?? null
  const gpsByVehicle = new Map((gpsRows ?? []).filter((row) => row.vehicleId).map((row) => [row.vehicleId!, row]))
  const vehicleAssets: OperationalAsset[] = vehicles.map((vehicle) => {
    const inspections = inspectionsByVehicle.get(vehicle.id)
    const findings = findingsByVehicle.get(vehicle.id)
    const capa = capaByVehicle.get(vehicle.id)
    const fuel = fuelByVehicle.get(vehicle.id)
    const vehicleDocuments = documentsByVehicle.get(vehicle.id) ?? []
    const gps = gpsByVehicle.get(vehicle.id)
    const gpsAdvance = computeGpsAdvance(vehicle, gpsSeries, period, gpsJumpRule)
    const maintenance = maintenanceByVehicle.get(vehicle.id)
    const workOrder = workOrdersByVehicle?.get(vehicle.id)
    const fuelBilledAmount = canViewFuel && canViewCosts ? fuelValue(fuel?.billedAmount, 0) : null
    // Sin OT cerradas con costo en el período, la mano de obra del equipo es $0 de
    // verdad, no un dato faltante (decisión 2026-11-07): antes quedaba `null` y el
    // «Costo total» salía «—» para casi toda la flota. Sólo es `null` sin la
    // capacidad de OT o si su consulta falló (`workOrdersByVehicle` en null).
    const maintenanceCost = workOrdersByVehicle ? (workOrder?.maintenanceCostInPeriod ?? 0) : null
    const purchaseAmount = canViewPurchaseCosts
      ? (purchaseUnavailable ? null : (purchaseByVehicle.get(vehicle.id)?.purchaseAmount ?? 0))
      : null
    // Un total sólo existe con las tres series: sumar sólo dos y llamarlo «total» lo
    // subestimaría sin avisar. Una serie es `null` sólo sin su capacidad o si su
    // consulta falló; un equipo sin movimientos en una serie aporta $0.
    const totalCost = fuelBilledAmount != null && maintenanceCost != null && purchaseAmount != null
      ? fuelBilledAmount + maintenanceCost + purchaseAmount
      : null
    const gpsAdvanceValue = gpsAdvance.status === "ok" ? gpsAdvance.advance : null
    const gpsPerformanceStatus: GpsPerformanceStatus = gpsAdvance.status !== "ok"
      ? gpsAdvance.status
      : (fuel?.liters ?? 0) > 0 ? "ok" : "no_fuel"
    const gpsPerformanceValue = gpsPerformanceStatus === "ok" && gpsAdvanceValue != null && fuel
      ? vehicle.performanceUnit === "km_per_liter"
        ? gpsAdvanceValue / fuel.liters
        : fuel.liters / gpsAdvanceValue
      : null
    const gpsCostPerUnit = totalCost != null && gpsAdvanceValue != null ? totalCost / gpsAdvanceValue : null
    const declaredExpiry = {
      soapExpiresAt: vehicle.soapExpiresAt,
      technicalReviewExpiresAt: vehicle.technicalReviewExpiresAt,
      circulationPermitExpiresAt: vehicle.circulationPermitExpiresAt,
      insuranceExpiresAt: vehicle.insuranceExpiresAt,
    }
    const rawStatus = vehicle.isActive ? vehicle.operationalStatus : "inactivo"
    const fuelPerformanceUnit = canViewFuel && !fuelUnavailable && (vehicle.performanceUnit === "km_per_liter" || vehicle.performanceUnit === "liters_per_hour")
      ? vehicle.performanceUnit
      : null
    // La lectura de la carga y la telemetría sólo son comparables si hablan
    // del mismo medidor, son recientes entre sí y la diferencia supera el
    // ruido normal de dos fuentes distintas (2 h / 5 km).
    const gpsMeter = vehicle.meterType === "hour_meter" ? gps?.hourMeter : vehicle.meterType === "odometer" ? gps?.odometer : null
    const gpsMeterAt = vehicle.meterType === "hour_meter" ? gps?.hourMeterAt : vehicle.meterType === "odometer" ? gps?.odometerAt : null
    const meterMismatch = canViewFleet && canViewFuel && !fuelUnavailable
      && vehicle.meterType !== "none"
      && fuel?.lastMeterReading != null
      && fuel.lastMeterType === vehicle.meterType
      && fuel.lastMeterAt != null
      && gpsMeterAt != null
      && gpsMeter != null
      && Math.abs(Date.parse(gpsMeterAt) - Date.parse(fuel.lastMeterAt)) <= 7 * 86_400_000
      && Math.abs(Number(gpsMeter) - fuel.lastMeterReading) > (vehicle.meterType === "hour_meter" ? 2 : 5)
    return {
      key: `vehicle:${vehicle.id}`,
      kind: "vehicle",
      id: vehicle.id,
      code: vehicle.code ?? vehicle.plate,
      name: `${vehicle.typeName ?? vehicle.type} · ${vehicle.plate}`,
      plate: vehicle.plate,
      typeName: vehicle.typeName ?? vehicle.type,
      worksiteId: vehicle.worksiteId,
      worksiteName: vehicle.worksiteName,
      operationalStatus: rawStatus,
      operationalStatusLabel: vehicle.isActive
        ? formatFuelVehicleStatus(vehicle.operationalStatus)
        : "Inactivo",
      stateMismatch: vehicle.isActive
        && vehicle.intervalStatus != null
        && vehicle.intervalStatus !== vehicle.operationalStatus,
      capabilities: ["fuel", "inspections"] as const,
      inspectionCount: Number(inspections?.count ?? 0),
      inspectionCompliancePercent: canViewInspections
        ? (inspections?.compliance == null ? null : Number(inspections.compliance))
        : null,
      inspectionNonConforming: canViewInspections ? Number(inspections?.nonConforming ?? 0) : null,
      inspectionPartial: canViewInspections ? Number(inspections?.partial ?? 0) : null,
      openFindings: canViewInspections ? Number(findings?.openFindings ?? 0) : null,
      criticalOpenFindings: canViewInspections ? Number(findings?.criticalOpenFindings ?? 0) : null,
      openFindingsWithWorkOrder: canViewInspections ? Number(findings?.openFindingsWithWorkOrder ?? 0) : null,
      openFindingsWithoutWorkOrder: canViewInspections ? Number(findings?.openFindingsWithoutWorkOrder ?? 0) : null,
      overdueCapa: canViewInspections && canViewCapa ? Number(capa?.overdueCapa ?? 0) : null,
      nextExpiryDate: canViewFleet ? resolveNextExpiryDate(declaredExpiry, vehicleDocuments) : null,
      expiredDocumentTypes: canViewFleet ? expiredDocumentTypes(declaredExpiry, vehicleDocuments, today) : [],
      gpsOdometer: canViewFleet ? (gps?.odometer == null ? null : Number(gps.odometer)) : null,
      gpsHourMeter: canViewFleet ? (gps?.hourMeter == null ? null : Number(gps.hourMeter)) : null,
      gpsObservedAt: canViewFleet ? (gps?.observedAt ?? null) : null,
      gpsFuelLevel: canViewFleet ? (gps?.fuelLevel == null ? null : Number(gps.fuelLevel)) : null,
      gpsProvider: canViewFleet ? (gps?.primaryProvider ?? null) : null,
      gpsProviders: canViewFleet ? (gps?.providers ?? []) : [],
      gpsStale: canViewFleet ? (gps?.gpsIsStale ?? false) : false,
      gpsReportedAt: canViewFleet ? (gps?.gpsReportedAt ?? null) : null,
      gpsOdometerAt: canViewFleet ? (gps?.odometerAt ?? null) : null,
      gpsHourMeterAt: canViewFleet ? (gps?.hourMeterAt ?? null) : null,
      gpsFuelLevelAt: canViewFleet ? (gps?.fuelLevelAt ?? null) : null,
      gpsSpeedKph: canViewFleet ? (gps?.speedKph ?? null) : null,
      gpsIgnition: canViewFleet && gps?.ignitionKnown ? (gps.ignition ?? null) : null,
      gpsPerformanceValue,
      gpsPerformanceUnit: gpsAdvanceValue != null && (vehicle.performanceUnit === "km_per_liter" || vehicle.performanceUnit === "liters_per_hour")
        ? vehicle.performanceUnit
        : null,
      gpsPerformanceStatus,
      gpsCostPerUnit,
      gpsMeterSource: gpsAdvance.source,
      gpsMeterProvider: canViewFleet ? (gps?.meterProvider ?? null) : null,
      gpsMaintenanceState: maintenance?.gpsStatus?.state ?? null,
      gpsMaintenanceNextReading: maintenance?.gpsStatus?.nextReading ?? null,
      gpsMaintenanceRemaining: maintenance?.gpsStatus?.remaining ?? null,
      gpsMaintenanceReadingAt: maintenance?.gpsReadingAt ?? null,
      fuelLiters: canViewFuel ? fuelValue(fuel?.liters, 0) : null,
      fuelLoadCount: canViewFuel ? fuelValue(fuel?.loadCount, 0) : null,
      lastFuelLoadAt: canViewFuel ? fuelValue(fuel?.lastLoadAt, null) : null,
      fuelPerformanceValue: canViewFuel ? fuelValue(fuel?.performanceValue, null) : null,
      fuelPerformanceUnit,
      flaggedLoads: canViewFuel ? fuelValue(fuel?.flaggedLoads, 0) : null,
      openAnomalyCases: canViewFuel ? fuelValue(fuel?.openCases, 0) : null,
      criticalOpenAnomalyCases: canViewFuel ? fuelValue(fuel?.criticalOpenCases, 0) : null,
      fuelBilledAmount,
      maintenanceCost,
      purchaseAmount,
      totalCost,
      idleHours: canViewFuel ? fuelValue(fuel?.idleHours, 0) : null,
      idlePct: canViewFuel ? fuelValue(fuel?.idlePct, null) : null,
      litersIdle: canViewFuel ? fuelValue(fuel?.litersIdle, null) : null,
      meterMismatch,
      openWorkOrders: workOrdersByVehicle ? (workOrder?.openCount ?? 0) : null,
      inWorkshop: workOrdersByVehicle ? (workOrder?.inWorkshopNow ?? false) : null,
      workshopHours: workOrdersByVehicle ? (workOrder?.workshopHoursInPeriod ?? 0) : null,
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
    inspectionCount: 0,
    inspectionCompliancePercent: null,
    inspectionNonConforming: null,
    inspectionPartial: null,
    openFindings: null,
    criticalOpenFindings: null,
    openFindingsWithWorkOrder: null,
    openFindingsWithoutWorkOrder: null,
    overdueCapa: null,
    nextExpiryDate: null,
    expiredDocumentTypes: [],
    gpsOdometer: null,
    gpsHourMeter: null,
    gpsObservedAt: null,
    gpsFuelLevel: null,
    gpsProvider: null,
    gpsProviders: [],
    gpsStale: false,
    gpsReportedAt: null,
    gpsOdometerAt: null,
    gpsHourMeterAt: null,
    gpsFuelLevelAt: null,
    gpsSpeedKph: null,
    gpsIgnition: null,
    gpsPerformanceValue: null,
    gpsPerformanceUnit: null,
    gpsPerformanceStatus: "not_applicable",
    gpsCostPerUnit: null,
    gpsMeterSource: null,
    gpsMeterProvider: null,
    gpsMaintenanceState: null,
    gpsMaintenanceNextReading: null,
    gpsMaintenanceRemaining: null,
    gpsMaintenanceReadingAt: null,
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
    maintenanceCost: null,
    // Los instrumentos de servicio no son `fuel_vehicles`: sus solicitudes apuntan a
    // `service_equipment`, no al vehículo, y no entran a esta suma.
    purchaseAmount: null,
    totalCost: null,
    idleHours: null,
    idlePct: null,
    litersIdle: null,
    meterMismatch: false,
    // Los instrumentos de servicio no son `fuel_vehicles`: no tienen OT.
    openWorkOrders: null,
    inWorkshop: null,
    workshopHours: null,
  }))

  const totalIntervalHours = availabilityRows.reduce((sum, row) => sum + Number(row.totalHours), 0)
  const operativeHours = availabilityRows.reduce((sum, row) => sum + Number(row.operativeHours), 0)

  const activeVehicleAssets = vehicleAssets.filter((asset) => asset.operationalStatus !== "inactivo")
  const reporting24h = activeVehicleAssets.filter((asset) => {
    const reportedAt = asset.gpsReportedAt ?? asset.gpsObservedAt
    if (!reportedAt) return false
    const observed = Date.parse(reportedAt)
    return Number.isFinite(observed) && Date.now() - observed <= 86_400_000
  }).length
  const byProvider = { onway: 0, wialon: 0, both: 0 }
  for (const asset of activeVehicleAssets) {
    const hasOnway = asset.gpsProviders.includes("onway")
    const hasWialon = asset.gpsProviders.includes("wialon")
    if (hasOnway && hasWialon) byProvider.both++
    else if (hasOnway) byProvider.onway++
    else if (hasWialon) byProvider.wialon++
  }
  const gpsCross: OperationalGpsCross = {
    totalVehicles: activeVehicleAssets.length,
    reporting24h,
    withoutReport24h: activeVehicleAssets.length - reporting24h,
    byProvider,
    meterMismatches: vehicleAssets.filter((asset) => asset.meterMismatch).length,
    fuelPerformance: {
      calculated: activeVehicleAssets.filter((asset) => asset.gpsPerformanceValue != null).length,
      insufficient: activeVehicleAssets.filter((asset) => asset.gpsPerformanceStatus !== "not_applicable" && asset.gpsPerformanceValue == null).length,
    },
    maintenance: {
      overdue: vehicleAssets.filter((asset) => asset.gpsMaintenanceState === "vencida").length,
      upcoming: vehicleAssets.filter((asset) => asset.gpsMaintenanceState === "proxima").length,
      estimated: vehicleAssets.filter((asset) => asset.gpsMaintenanceState != null).length,
    },
    purchases: {
      calculated: activeVehicleAssets.filter((asset) => asset.gpsCostPerUnit != null).length,
      insufficient: activeVehicleAssets.filter((asset) => asset.gpsPerformanceStatus !== "not_applicable" && asset.gpsCostPerUnit == null).length,
    },
    prevention: {
      overdueCapaAssets: vehicleAssets.filter((asset) => (asset.overdueCapa ?? 0) > 0).length,
      overdueCapaTotal: vehicleAssets.reduce((sum, asset) => sum + (asset.overdueCapa ?? 0), 0),
      operatingWithOverdueCapa: vehicleAssets.filter((asset) =>
        (asset.overdueCapa ?? 0) > 0 && !asset.gpsStale && ((asset.gpsSpeedKph ?? 0) > 0 || asset.gpsIgnition === true),
      ).length,
    },
  }

  const periodDays = Math.round(
    (Date.parse(`${period.to}T00:00:00Z`) - Date.parse(`${period.from}T00:00:00Z`)) / 86_400_000,
  ) + 1
  const calendarHours = vehicles.filter((vehicle) => vehicle.isActive).length * periodDays * 24
  // Horas en taller y MTTR: sobre los equipos del alcance de la sesión que
  // listan los activos (un equipo con OT de otra faena no suma al panel que no lo muestra).
  const assetIds = new Set(vehicles.map((vehicle) => vehicle.id))
  let workshopHours = 0
  let repairClosed = 0
  let repairWorkshopHours = 0
  for (const [vehicleId, metrics] of workOrdersByVehicle ?? []) {
    if (!assetIds.has(vehicleId)) continue
    workshopHours += metrics.workshopHoursInPeriod
    repairClosed += metrics.repairClosedInPeriod
    repairWorkshopHours += metrics.repairClosedWorkshopHours
  }
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
    workOrders: includeAttention ? (workOrders?.global ?? null) : null,
  }
  return {
    period,
    attention,
    degradedSources,
    gpsCross,
    assets: [...vehicleAssets, ...serviceAssets],
    metrics: {
      ...calculateOperationalControlMetrics({
        totalIntervalHours,
        calendarHours,
        operativeHours,
      }),
      // `null` sin la capacidad de OT o si su consulta falló; 0 h es un dato válido (nadie ingresó al taller).
      workshopHours: workOrdersByVehicle ? workshopHours : null,
      // MTTR = horas en taller de las OT de reparación cerradas ÷ cuántas son. Sin ninguna cerrada no hay qué promediar.
      mttrHours: workOrdersByVehicle ? meanTimeToRepairHours(repairClosed, repairWorkshopHours) : null,
    },
    permissions: { canViewFleet, canViewInspections, canViewCapa, canViewFuel, canViewCosts, canViewServiceEquipment, canViewWorkOrders, canViewPurchaseCosts, canViewMaintenance },
  }
}
