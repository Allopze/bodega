/**
 * Tipos y constantes compartidas de la bitácora de combustible.
 * Separado de fuel-log.ts para que los Client Components puedan importar
 * tipos y constantes SIN arrastrar el módulo `db` → `postgres` → `fs`.
 *
 * Ver: https://nextjs.org/docs/app/building-your-application/rendering/composition-patterns
 */

export type FuelLogSource = "tae_pwa" | "invoiced" | "operation_manual"

export const FUEL_LOG_SOURCE_LABEL: Record<FuelLogSource, string> = {
  tae_pwa: "TAE (PWA)",
  invoiced: "Facturación",
  operation_manual: "Log operacional",
}

export interface FuelLogRow {
  /** Identidad real de la fila — única incluso cuando varias filas comparten `detailId` (log operacional). */
  id: string
  /** Adónde navega "Abrir detalle": el registro mismo (TAE/facturación) o el lote que lo contiene (log operacional, sin página propia por fila). */
  detailId: string
  source: FuelLogSource
  occurredAt: string
  worksiteName: string | null
  supplierId: string | null
  supplierName: string | null
  loadingPointName: string | null
  equipmentCode: string | null
  plate: string | null
  equipmentTypeId: string | null
  equipmentTypeName: string | null
  driverName: string | null
  supervisorName: string | null
  productId: string | null
  productName: string | null
  liters: number
  meterReading: number | null
  meterLabel: string | null
  performanceValue: number | null
  performanceUnit: string | null
  sealRemoved: string | null
  sealInstalled: string | null
  evidenceCount: number | null
  notes: string | null
  statusLabel: string | null
  createdByName: string | null
  updatedByName: string | null
  createdAt: string | null
  updatedAt: string | null
  /** Cantidad de anomalías abiertas/en revisión/reabiertas para este registro. */
  anomalyCount: number | null
  /** `true` si el registro tiene una marca de revisión activa. `null` cuando no existe (el SQL retorna NULL). */
  reviewMark: boolean | null
  /** Nota de la marca de revisión, si existe. */
  reviewMarkNotes: string | null
  /** ID de la marca de revisión (para toggle desde la tabla). */
  reviewMarkId: string | null
}

export interface FuelLogFilters {
  worksiteId?: string
  source?: FuelLogSource
  q?: string
  from?: string // "YYYY-MM-DD"
  to?: string   // "YYYY-MM-DD"
  supplierId?: string
  productId?: string
  equipmentTypeId?: string
  hasNotes?: boolean
  /** Filtro por marca de vehículo (columna en fuel_vehicles.brand). */
  brand?: string
  /** Filtro por modelo de vehículo (columna en fuel_vehicles.model). */
  model?: string
  /** Filtro por nombre de conductor. Aplica a TAE (driverNameSnapshot) y log operacional (operador); la facturación no tiene conductor por carga. */
  driverName?: string
  /** Filtro por nombre de supervisor. Aplica igual que driverName. */
  supervisorName?: string
  /** Filtro por lugar de carga (sólo TAE). */
  loadingPointId?: string
  /** Filtro por unidad de rendimiento (km_per_liter, liters_per_hour). */
  performanceUnit?: string
  /** Filtro por estado operativo del equipo (operativo, inactivo_mantencion, etc.). */
  operationalStatus?: string
  /** Filtro por número de sello retirado (sólo TAE). */
  sealRemoved?: string
  /** Filtro por número de sello instalado (sólo TAE). */
  sealInstalled?: string
  /** Filtro por tipo de evidencia (sólo TAE). Uno de: odometer, liter_meter, removed_seal, installed_seal. */
  evidenceKind?: string
  /** Sólo filas con al menos un caso de anomalía abierto/en revisión/reabierto. */
  hasAnomaly?: boolean
  /** Filtro por código de regla de anomalía (fuel_anomaly_rules.code). */
  anomalyRuleCode?: string
  /** Filtro por severidad de anomalía (low/medium/high/critical). */
  anomalySeverity?: string
  /** Filtro por responsable asignado al caso de anomalía. */
  anomalyAssigneeId?: string
  /** Sólo filas marcadas para revisión por algún usuario. */
  hasReviewMark?: boolean
}
