import type { Session } from "next-auth"
import { and, desc, eq, sql } from "drizzle-orm"
import { db } from "@/db"
import {
  fuelImportBatches,
  fuelVehicleOperationalIntervals,
  fuelVehicles,
  maintenanceRecords,
  preventionInspectionRuns,
  serviceEquipment,
  worksites,
} from "@/db/schema"
import { can } from "@/lib/auth/can"
import { worksiteScopeSql } from "@/lib/auth/scope"
import { addDaysToPlainDate, todayInChile } from "@/lib/utils"
import { civilDate } from "@/lib/validation/dates"
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
  capabilities: readonly ("fuel" | "inspections" | "maintenance" | "service_requests")[]
  maintenanceCount: number
  openMaintenanceCount: number
  inspectionCount: number
  downtimeHours: number
  maintenanceCost: number | null
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

export interface OperationalControlMetricInputs {
  totalIntervalHours: number
  operativeHours: number
  downtimeHours: number
  correctiveDowntimeHours: number
  completedCorrective: number
  preventiveCompleted: number
  preventiveDue: number
  backlog: number
  maintenanceCost: number
  canViewCosts: boolean
}

export function calculateOperationalControlMetrics(input: OperationalControlMetricInputs) {
  return {
    availabilityPercent: input.totalIntervalHours > 0 ? (input.operativeHours / input.totalIntervalHours) * 100 : null,
    mttrHours: input.completedCorrective > 0 ? input.correctiveDowntimeHours / input.completedCorrective : null,
    mtbfHours: input.completedCorrective > 0 ? input.operativeHours / input.completedCorrective : null,
    preventiveCompliancePercent: input.preventiveDue > 0 ? (input.preventiveCompleted / input.preventiveDue) * 100 : null,
    downtimeHours: input.downtimeHours,
    backlog: input.backlog,
    maintenanceCost: input.canViewCosts ? input.maintenanceCost : null,
  }
}

export function resolveOperationalControlPeriod(input: Partial<OperationalControlPeriod> = {}): OperationalControlPeriod {
  const to = civilDate().safeParse(input.to).success ? input.to! : todayInChile()
  const from = civilDate().safeParse(input.from).success ? input.from! : addDaysToPlainDate(to, -89)
  if (from > to) throw new Error("El inicio del período no puede ser posterior al término")
  return { from, to }
}

/** Read model común: unifica navegación y métricas sin borrar las diferencias de dominio. */
export async function getOperationalControlHub(session: Session, input: Partial<OperationalControlPeriod> = {}) {
  const period = resolveOperationalControlPeriod(input)
  const canViewFleet = can(session, "flota:view")
  const canViewMaintenance = can(session, "mantenciones:view")
  const canViewInspections = can(session, "prevention:inspections:view")
  const canViewCosts = can(session, "combustibles:view_costs")
  const canViewServiceEquipment = can(session, "admin:service_equipment")
  if (!canViewFleet && !canViewMaintenance && !canViewInspections) throw new Error("Sin permisos para Control operacional")
  const vehicleScope = worksiteScopeSql(session, fuelVehicles.worksiteId)
  const serviceScope = worksiteScopeSql(session, serviceEquipment.worksiteId)

  const [vehicles, instruments, maintenanceAgg, inspectionAgg, availabilityRows, latestImport] = await Promise.all([
    canViewFleet || canViewMaintenance || canViewInspections
      ? db.select({ id: fuelVehicles.id, code: fuelVehicles.code, plate: fuelVehicles.plate, type: fuelVehicles.type, worksiteId: fuelVehicles.worksiteId, worksiteName: worksites.name, operationalStatus: fuelVehicles.operationalStatus, isActive: fuelVehicles.isActive })
          .from(fuelVehicles).innerJoin(worksites, eq(worksites.id, fuelVehicles.worksiteId)).where(vehicleScope).orderBy(fuelVehicles.plate)
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
      downtimeHours: sql<number>`COALESCE(SUM(EXTRACT(EPOCH FROM (${maintenanceRecords.downtimeEndedAt} - ${maintenanceRecords.downtimeStartedAt})) / 3600) FILTER (WHERE ${maintenanceRecords.downtimeEndedAt} IS NOT NULL AND ${maintenanceRecords.downtimeStartedAt} IS NOT NULL), 0)`,
      correctiveDowntimeHours: sql<number>`COALESCE(SUM(EXTRACT(EPOCH FROM (${maintenanceRecords.downtimeEndedAt} - ${maintenanceRecords.downtimeStartedAt})) / 3600) FILTER (WHERE ${maintenanceRecords.status} = 'completed' AND ${maintenanceRecords.maintenanceType} = 'correctiva' AND ${maintenanceRecords.downtimeEndedAt} IS NOT NULL AND ${maintenanceRecords.downtimeStartedAt} IS NOT NULL), 0)`,
      cost: sql<number>`COALESCE(SUM(${maintenanceRecords.totalAmount}) FILTER (WHERE ${maintenanceRecords.status} <> 'cancelled'), 0)`,
      preventiveCompleted: sql<number>`COUNT(*) FILTER (WHERE ${maintenanceRecords.status} = 'completed' AND ${maintenanceRecords.maintenanceType} = 'preventiva')`,
      preventiveDue: sql<number>`COUNT(*) FILTER (WHERE ${maintenanceRecords.maintenanceType} = 'preventiva' AND ${maintenanceRecords.status} <> 'cancelled')`,
    }).from(maintenanceRecords).innerJoin(fuelVehicles, eq(fuelVehicles.id, maintenanceRecords.vehicleId)).where(and(
      vehicleScope,
      sql`${maintenanceRecords.maintenanceDate} BETWEEN ${period.from} AND ${period.to}`,
    )).groupBy(maintenanceRecords.vehicleId) : [],
    canViewInspections ? db.select({ vehicleId: preventionInspectionRuns.subjectVehicleId, count: sql<number>`COUNT(*) FILTER (WHERE ${preventionInspectionRuns.status} <> 'cancelled')` })
      .from(preventionInspectionRuns).innerJoin(fuelVehicles, eq(fuelVehicles.id, preventionInspectionRuns.subjectVehicleId)).where(and(vehicleScope, sql`${preventionInspectionRuns.scheduledFor} BETWEEN ${period.from} AND ${period.to}`)).groupBy(preventionInspectionRuns.subjectVehicleId) : [],
    db.select({
      vehicleId: fuelVehicleOperationalIntervals.vehicleId,
      totalHours: sql<number>`COALESCE(SUM(EXTRACT(EPOCH FROM (LEAST(COALESCE(${fuelVehicleOperationalIntervals.endedAt}, (${period.to}::date + INTERVAL '1 day')), (${period.to}::date + INTERVAL '1 day')) - GREATEST(${fuelVehicleOperationalIntervals.startedAt}, ${period.from}::date))) / 3600) FILTER (WHERE ${fuelVehicleOperationalIntervals.startedAt} < (${period.to}::date + INTERVAL '1 day') AND COALESCE(${fuelVehicleOperationalIntervals.endedAt}, (${period.to}::date + INTERVAL '1 day')) > ${period.from}::date), 0)`,
      operativeHours: sql<number>`COALESCE(SUM(EXTRACT(EPOCH FROM (LEAST(COALESCE(${fuelVehicleOperationalIntervals.endedAt}, (${period.to}::date + INTERVAL '1 day')), (${period.to}::date + INTERVAL '1 day')) - GREATEST(${fuelVehicleOperationalIntervals.startedAt}, ${period.from}::date))) / 3600) FILTER (WHERE ${fuelVehicleOperationalIntervals.status} = 'operativo' AND ${fuelVehicleOperationalIntervals.startedAt} < (${period.to}::date + INTERVAL '1 day') AND COALESCE(${fuelVehicleOperationalIntervals.endedAt}, (${period.to}::date + INTERVAL '1 day')) > ${period.from}::date), 0)`,
    }).from(fuelVehicleOperationalIntervals).innerJoin(fuelVehicles, eq(fuelVehicles.id, fuelVehicleOperationalIntervals.vehicleId)).where(vehicleScope).groupBy(fuelVehicleOperationalIntervals.vehicleId),
    db.select({ id: fuelImportBatches.id, status: fuelImportBatches.estado, createdAt: fuelImportBatches.createdAt, validRows: fuelImportBatches.filasValidas, invalidRows: fuelImportBatches.filasInvalidas, source: fuelImportBatches.fuente })
      .from(fuelImportBatches).where(worksiteScopeSql(session, fuelImportBatches.worksiteId)).orderBy(desc(fuelImportBatches.createdAt)).limit(1),
  ])

  const maintenanceByVehicle = new Map(maintenanceAgg.map((row) => [row.vehicleId, row]))
  const inspectionsByVehicle = new Map(inspectionAgg.filter((row) => row.vehicleId).map((row) => [row.vehicleId!, row]))
  const vehicleAssets: OperationalAsset[] = vehicles.map((vehicle) => {
    const maintenance = maintenanceByVehicle.get(vehicle.id)
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
      capabilities: ["fuel", "inspections", "maintenance"] as const,
      maintenanceCount: Number(maintenance?.count ?? 0),
      openMaintenanceCount: Number(maintenance?.openCount ?? 0),
      inspectionCount: Number(inspections?.count ?? 0),
      downtimeHours: Number(maintenance?.downtimeHours ?? 0),
      maintenanceCost: canViewCosts ? Number(maintenance?.cost ?? 0) : null,
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
    maintenanceCount: 0,
    openMaintenanceCount: 0,
    inspectionCount: 0,
    downtimeHours: 0,
    // Los instrumentos de servicio no tienen costo de mantención modelado
    // todavía; devolver null (no 0) fuerza a la UI a pintar "—" en vez de
    // "$0" — bug B-05. Cuando el módulo `service_requests` se conecte, esto
    // será un cálculo real.
    maintenanceCost: null,
  }))

  const totalIntervalHours = availabilityRows.reduce((sum, row) => sum + Number(row.totalHours), 0)
  const operativeHours = availabilityRows.reduce((sum, row) => sum + Number(row.operativeHours), 0)
  const totalDowntime = maintenanceAgg.reduce((sum, row) => sum + Number(row.downtimeHours), 0)
  const correctiveDowntimeHours = maintenanceAgg.reduce((sum, row) => sum + Number(row.correctiveDowntimeHours), 0)
  const completedCorrective = maintenanceAgg.reduce((sum, row) => sum + Number(row.completedCorrective), 0)
  const preventiveCompleted = maintenanceAgg.reduce((sum, row) => sum + Number(row.preventiveCompleted), 0)
  const preventiveDue = maintenanceAgg.reduce((sum, row) => sum + Number(row.preventiveDue), 0)
  return {
    period,
    assets: [...vehicleAssets, ...serviceAssets],
    metrics: calculateOperationalControlMetrics({
      totalIntervalHours,
      operativeHours,
      downtimeHours: totalDowntime,
      correctiveDowntimeHours,
      completedCorrective,
      preventiveCompleted,
      preventiveDue,
      backlog: vehicleAssets.reduce((sum, asset) => sum + asset.openMaintenanceCount, 0),
      maintenanceCost: maintenanceAgg.reduce((sum, row) => sum + Number(row.cost), 0),
      canViewCosts,
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
    permissions: { canViewFleet, canViewMaintenance, canViewInspections, canViewCosts, canViewServiceEquipment },
  }
}
