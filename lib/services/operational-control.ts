import type { Session } from "next-auth"
import { and, desc, eq, isNotNull, sql } from "drizzle-orm"
import { db } from "@/db"
import {
  fleetVehicleDocuments,
  fuelImportBatches,
  fuelVehicleOperationalIntervals,
  fuelVehicles,
  preventionInspectionRuns,
  serviceEquipment,
  worksites,
} from "@/db/schema"
import { can } from "@/lib/auth/can"
import { worksiteScopeSql } from "@/lib/auth/scope"
import { logger } from "@/lib/logger"
import { getFleetAdminSettings } from "@/lib/services/system-settings"
import { addDaysToPlainDate, todayInChile } from "@/lib/utils"
import { civilDate } from "@/lib/validation/dates"
import {
  countFleetDocumentExpiry,
  countStoppedVehicles,
  type FleetDocumentExpiry,
  type StoppedVehicles,
} from "@/lib/operational-control/attention"
import {
  FUEL_IMPORT_SOURCE_HEALTH,
  formatFuelImportBatchStatus,
  formatFuelVehicleStatus,
  type FuelImportSourceHealth,
} from "@/lib/combustibles/validation"

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
  capabilities: readonly ("fuel" | "inspections" | "service_requests")[]
  inspectionCount: number
}

export type OperationalSourceHealthItem = {
  key: string
  label: string
  status: FuelImportSourceHealth
  /** Etiqueta humana del estado (regla A6). */
  statusLabel: string
  lastRunAt: string | null
  detail: string
  /** Identificador del último batch, para enlazar al detalle cuando esté
   *  disponible. Es null cuando no hay ejecuciones. */
  lastBatchId: string | null
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
 * Las cifras se miden con el criterio de la lista a la que enlaza cada tile:
 * detenidos y documentos usan todos los vehículos del alcance (activos e
 * inactivos, como `/flota`).
 */
export interface OperationalAttention {
  stoppedVehicles: StoppedVehicles | null
  fleetDocuments: (FleetDocumentExpiry & { warningDays: number }) | null
}

/** Una consulta de atención que falla se registra y se vuelve `null`; no rechaza el panel entero. */
async function settleAttention<T>(label: string, run: () => PromiseLike<T>): Promise<T | null> {
  try {
    return await run()
  } catch (error) {
    logger.error(`[control-operacional] conteo de atención «${label}» falló`, error)
    return null
  }
}

export interface OperationalControlMetricInputs {
  totalIntervalHours: number
  operativeHours: number
}

export function calculateOperationalControlMetrics(input: OperationalControlMetricInputs) {
  return {
    availabilityPercent: input.totalIntervalHours > 0 ? (input.operativeHours / input.totalIntervalHours) * 100 : null,
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
  // La salud de importación es del dominio Combustibles: un actor que entra al
  // hub por flota o inspecciones no debe ver estado de un lote que no le
  // corresponde. Se decide antes de consultar, no al renderizar.
  const canViewFuelImport = can(session, "combustibles:view")
  const canViewServiceEquipment = can(session, "admin:service_equipment")
  if (!canViewFleet && !canViewInspections) throw new Error("Sin permisos para Control operacional")
  const vehicleScope = worksiteScopeSql(session, fuelVehicles.worksiteId)
  const serviceScope = worksiteScopeSql(session, serviceEquipment.worksiteId)

  const [vehicles, instruments, inspectionAgg, availabilityRows, latestImport, fleetDocumentData] = await Promise.all([
    canViewFleet || canViewInspections
      ? db.select({ id: fuelVehicles.id, code: fuelVehicles.code, plate: fuelVehicles.plate, type: fuelVehicles.type, worksiteId: fuelVehicles.worksiteId, worksiteName: worksites.name, operationalStatus: fuelVehicles.operationalStatus, isActive: fuelVehicles.isActive, soapExpiresAt: fuelVehicles.soapExpiresAt, technicalReviewExpiresAt: fuelVehicles.technicalReviewExpiresAt, circulationPermitExpiresAt: fuelVehicles.circulationPermitExpiresAt, insuranceExpiresAt: fuelVehicles.insuranceExpiresAt })
          .from(fuelVehicles).innerJoin(worksites, eq(worksites.id, fuelVehicles.worksiteId)).where(vehicleScope).orderBy(fuelVehicles.plate)
      : [],
    canViewServiceEquipment
      ? db.select({ id: serviceEquipment.id, code: serviceEquipment.code, name: serviceEquipment.name, kind: serviceEquipment.kind, worksiteId: serviceEquipment.worksiteId, worksiteName: worksites.name, isActive: serviceEquipment.isActive })
          .from(serviceEquipment).innerJoin(worksites, eq(worksites.id, serviceEquipment.worksiteId)).where(serviceScope).orderBy(serviceEquipment.code)
      : [],
    canViewInspections ? db.select({ vehicleId: preventionInspectionRuns.subjectVehicleId, count: sql<number>`COUNT(*) FILTER (WHERE ${preventionInspectionRuns.status} <> 'cancelled')` })
      .from(preventionInspectionRuns).innerJoin(fuelVehicles, eq(fuelVehicles.id, preventionInspectionRuns.subjectVehicleId)).where(and(vehicleScope, sql`${preventionInspectionRuns.scheduledFor} BETWEEN ${period.from} AND ${period.to}`)).groupBy(preventionInspectionRuns.subjectVehicleId) : [],
    // La disponibilidad es un indicador de Flota: se consulta sólo con
    // `flota:view`. Entrar al hub por inspecciones no habilita este
    // subdominio.
    canViewFleet ? db.select({
      vehicleId: fuelVehicleOperationalIntervals.vehicleId,
      totalHours: sql<number>`COALESCE(SUM(EXTRACT(EPOCH FROM (LEAST(COALESCE(${fuelVehicleOperationalIntervals.endedAt}, (${period.to}::date + INTERVAL '1 day')), (${period.to}::date + INTERVAL '1 day')) - GREATEST(${fuelVehicleOperationalIntervals.startedAt}, ${period.from}::date))) / 3600) FILTER (WHERE ${fuelVehicleOperationalIntervals.startedAt} < (${period.to}::date + INTERVAL '1 day') AND COALESCE(${fuelVehicleOperationalIntervals.endedAt}, (${period.to}::date + INTERVAL '1 day')) > ${period.from}::date), 0)`,
      operativeHours: sql<number>`COALESCE(SUM(EXTRACT(EPOCH FROM (LEAST(COALESCE(${fuelVehicleOperationalIntervals.endedAt}, (${period.to}::date + INTERVAL '1 day')), (${period.to}::date + INTERVAL '1 day')) - GREATEST(${fuelVehicleOperationalIntervals.startedAt}, ${period.from}::date))) / 3600) FILTER (WHERE ${fuelVehicleOperationalIntervals.status} = 'operativo' AND ${fuelVehicleOperationalIntervals.startedAt} < (${period.to}::date + INTERVAL '1 day') AND COALESCE(${fuelVehicleOperationalIntervals.endedAt}, (${period.to}::date + INTERVAL '1 day')) > ${period.from}::date), 0)`,
    }).from(fuelVehicleOperationalIntervals).innerJoin(fuelVehicles, eq(fuelVehicles.id, fuelVehicleOperationalIntervals.vehicleId)).where(vehicleScope).groupBy(fuelVehicleOperationalIntervals.vehicleId) : [],
    canViewFuelImport ? db.select({ id: fuelImportBatches.id, status: fuelImportBatches.estado, createdAt: fuelImportBatches.createdAt, validRows: fuelImportBatches.filasValidas, invalidRows: fuelImportBatches.filasInvalidas, source: fuelImportBatches.fuente })
      .from(fuelImportBatches).where(worksiteScopeSql(session, fuelImportBatches.worksiteId)).orderBy(desc(fuelImportBatches.createdAt)).limit(1) : [],
    // «Requiere atención»: lo que `/flota?vencimiento=vencidos` cuenta. Mismo
    // origen que `getFleetOverviewPage`: documentos vigentes con fecha de los
    // vehículos del alcance, y los días de aviso que configura Flota.
    includeAttention && canViewFleet ? settleAttention("documentos de flota", async () => {
      const [documents, settings] = await Promise.all([
        db.select({
          vehicleId: fleetVehicleDocuments.vehicleId,
          documentType: fleetVehicleDocuments.documentType,
          expiresAt: fleetVehicleDocuments.expiresAt,
        }).from(fleetVehicleDocuments)
          .innerJoin(fuelVehicles, eq(fuelVehicles.id, fleetVehicleDocuments.vehicleId))
          .where(and(
            isNotNull(fleetVehicleDocuments.expiresAt),
            eq(fleetVehicleDocuments.status, "current"),
            vehicleScope,
          )),
        getFleetAdminSettings(),
      ])
      return { documents, warningDays: settings.warningDays }
    }) : null,
  ])

  const inspectionsByVehicle = new Map(inspectionAgg.filter((row) => row.vehicleId).map((row) => [row.vehicleId!, row]))
  const vehicleAssets: OperationalAsset[] = vehicles.map((vehicle) => {
    const inspections = inspectionsByVehicle.get(vehicle.id)
    const rawStatus = vehicle.isActive ? vehicle.operationalStatus : "inactivo"
    return {
      key: `vehicle:${vehicle.id}`,
      kind: "vehicle",
      id: vehicle.id,
      code: vehicle.code ?? vehicle.plate,
      name: `${vehicle.type} · ${vehicle.plate}`,
      worksiteId: vehicle.worksiteId,
      worksiteName: vehicle.worksiteName,
      operationalStatus: rawStatus,
      operationalStatusLabel: vehicle.isActive
        ? formatFuelVehicleStatus(vehicle.operationalStatus)
        : "Inactivo",
      capabilities: ["fuel", "inspections"] as const,
      inspectionCount: Number(inspections?.count ?? 0),
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
    capabilities: ["service_requests"] as const,
    inspectionCount: 0,
  }))

  const totalIntervalHours = availabilityRows.reduce((sum, row) => sum + Number(row.totalHours), 0)
  const operativeHours = availabilityRows.reduce((sum, row) => sum + Number(row.operativeHours), 0)
  const today = todayInChile()
  const attention: OperationalAttention = {
    stoppedVehicles: includeAttention && canViewFleet ? countStoppedVehicles(vehicles) : null,
    fleetDocuments: fleetDocumentData
      ? {
          warningDays: fleetDocumentData.warningDays,
          ...countFleetDocumentExpiry(vehicles, fleetDocumentData.documents, {
            today,
            warningWindowEnd: addDaysToPlainDate(today, fleetDocumentData.warningDays),
          }),
        }
      : null,
  }
  return {
    period,
    attention,
    assets: [...vehicleAssets, ...serviceAssets],
    metrics: calculateOperationalControlMetrics({
      totalIntervalHours,
      operativeHours,
    }),
    sourceHealth: (() => {
      const last = latestImport[0]
      const rawStatus: FuelImportSourceHealth = (last?.status && (FUEL_IMPORT_SOURCE_HEALTH as readonly string[]).includes(last.status))
        ? (last.status as FuelImportSourceHealth)
        : "sin_ejecucion"
      return [{
        key: "fuel_import",
        label: "Importación combustible",
        status: rawStatus,
        statusLabel: formatFuelImportBatchStatus(rawStatus),
        lastRunAt: last?.createdAt ?? null,
        lastBatchId: last?.id ?? null,
        detail: last
          ? `${last.validRows} válidas · ${last.invalidRows} observadas`
          : "No hay lotes visibles",
      }]
    })(),
    permissions: { canViewFleet, canViewInspections, canViewFuelImport, canViewServiceEquipment },
  }
}
