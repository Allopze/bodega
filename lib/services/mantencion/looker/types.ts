import type { MantEquipmentState, MantUnit } from "@/lib/mantencion/types"

/**
 * Tipos del tablero de Mantención estilo Looker.
 *
 * La pestaña `hoy` es el Panel operativo de siempre; las otras tres leen los mismos datos con
 * agregaciones propias. Los filtros manuales (`faena`, `equipo`, `frecuencia`, período) y los
 * filtros cruzados (`x_*`) viajan en la URL: el servidor consulta y el navegador sólo dibuja.
 */

export const LOOKER_TABS = ["hoy", "planificacion", "camiones", "maquinas"] as const
export type LookerTab = (typeof LOOKER_TABS)[number]

export function isLookerTab(value: string | undefined): value is LookerTab {
  return value !== undefined && (LOOKER_TABS as readonly string[]).includes(value)
}

/** Dimensión que un bloque puede emitir (y, por lo tanto, ignorar en su propia consulta). */
export type CrossDimension = "equipment" | "work" | "check" | "month" | "conductor" | "worksite" | "mechanic"

export interface RawCrossFilters {
  equipment?: string
  work?: string
  check?: string
  conductor?: string
  month?: string
  worksite?: string
  mechanic?: string
}

export interface LookerFilters {
  tab: LookerTab
  /** Período efectivo, ya cortado en hoy. */
  from: string
  to: string
  /** Lo que pidió la URL (o el default), sin cortar: es lo que muestra el control. */
  requestedFrom: string
  requestedTo: string
  invalidPeriod: boolean
  /** Filtros manuales. */
  worksiteIds: string[]
  equipmentIds: string[]
  frequencies: number[]
  page: number
  cross: RawCrossFilters
}

export interface LookerEquipmentOption {
  id: string
  code: string
  plate: string
  label: string
  worksiteId: string
  worksiteName: string
  typeName: string
  unit: MantUnit | null
  scheduleId: string | null
  scheduleName: string | null
  /** Intervalos activos de su pauta publicada. */
  intervals: number[]
  /** Último intervalo preventivo (firmado o declarado), para reflejarlo en los controles. */
  frequency: number | null
}

export interface LookerFrequencyOption {
  value: number
  unit: MantUnit
  label: string
}

export interface LookerOptions {
  worksites: Array<{ id: string; name: string }>
  equipment: LookerEquipmentOption[]
  frequencies: LookerFrequencyOption[]
}

export interface ResolvedEquipment {
  id: string
  code: string
  plate: string
  label: string
  worksiteId: string
  worksiteName: string
  unit: MantUnit | null
  intervals: number[]
  /** Intervalo de la última preventiva; es la «frecuencia» que muestran los controles. */
  frequency: number | null
  /** El equipo viene derivado de una OT o de una mantención, no de `x_equipo`. */
  derivedFrom?: "work" | "check"
}

export interface ResolvedWork {
  id: string
  label: string
  equipmentId: string | null
  worksiteId: string | null
}

export interface ResolvedCheck {
  id: string
  label: string
  equipmentId: string | null
  worksiteId: string | null
  month: string | null
  level: string | null
}

export interface ResolvedCrossFilters {
  equipment?: ResolvedEquipment
  work?: ResolvedWork
  check?: ResolvedCheck
  conductor?: { key: string; label: string }
  month?: { key: string; label: string }
  worksite?: { id: string; name: string }
  mechanic?: { key: string; label: string }
}

/**
 * Filtros efectivos de una consulta. Los valores cruzados reemplazan al filtro manual de la misma
 * dimensión (es lo que hace Looker al hacer clic); el bloque que emitió la dimensión la ignora.
 */
export interface QueryFilters {
  worksiteIds: string[]
  equipmentIds: string[]
  frequencies: number[]
  month: string | null
  conductorKey: string | null
  mechanicKey: string | null
  workId: string | null
  checkId: string | null
  unit: MantUnit | null
}

export interface FilterChip {
  key: string
  label: string
  value: string
  displayValue: string
  /** Parámetro de URL que lleva el filtro. */
  param: string
}

/** Fila de las dos tablas de Planificación. */
export interface PlanningRow extends Record<string, unknown> {
  vehicleId: string
  code: string
  plate: string
  label: string
  typeName: string
  worksiteId: string
  worksiteName: string
  unit: MantUnit
  scheduleName: string | null
  intervals: number[]
  /** Intervalo de la última preventiva (la «frecuencia» de la fila). */
  frequency: number | null
  lastDate: string | null
  /** Km/h programados de la última mantención (A). */
  programmed: number | null
  /** Km/h reales de la última mantención (B). */
  real: number | null
  current: number | null
  next: number | null
  /** A − B. */
  delta: number | null
  /** Próxima − actual. Negativo = vencida. */
  remaining: number | null
  base: number | null
  state: MantEquipmentState
  /** La última preventiva es anterior a la plataforma y está declarada con respaldo. */
  declared: boolean
  evidence: string | null
  /** El jefe de mantención eligió otro intervalo del sugerido. */
  manual: boolean
  manualReason: string | null
  /** La última mantención queda fuera del rango pedido (la fila igual se muestra). */
  outOfRange: boolean
}

export interface PlanningData {
  km: PlanningRow[]
  hours: PlanningRow[]
  /** Equipo elegido por el filtro cruzado, si es de la unidad de la tabla. */
  selectedId: string | null
}

export interface CorrectiveWorkRow {
  /** `ot:<id>`, `h:<sourceKey>` o `r:<id>`. */
  id: string
  source: "ot" | "historial" | "registro"
  date: string
  vehicleId: string | null
  recordId: string | null
  code: string
  plate: string
  typeName: string
  unit: MantUnit | null
  reading: number | null
  readingText: string | null
  reference: string
  workPerformed: string
  worksiteId: string | null
  worksiteName: string | null
  hours: number | null
  /** Foto `correctiva` del registro enlazado (sólo registros de la plataforma). */
  photoId: string | null
  /** Enlace de respaldo del formulario histórico, si existe. */
  photoUrl: string | null
}

export interface CorrectivePage {
  rows: CorrectiveWorkRow[]
  total: number
  page: number
  pageSize: number
}

export interface DriverRow {
  /** `nameKey` del nombre: es la clave del filtro cruzado. */
  key: string
  label: string
  records: number
  /** Horas prorrateadas entre los conductores del registro. */
  hours: number
  /** Ids normalizados de los trabajos donde aparece; filtran la tabla de OT. */
  workIds: string[]
}

export interface EquipmentSeriesRow {
  vehicleId: string
  label: string
  records: number
  hours: number
}

export interface CorrectiveSummary {
  drivers: DriverRow[]
  series: EquipmentSeriesRow[]
  selectedDriver: DriverRow | null
}

export interface ComplianceCheck {
  /** `h:<sourceKey>` o `r:<recordId>`. */
  id: string
  source: "historial" | "registro"
  date: string
  month: string
  vehicleId: string | null
  code: string
  plate: string
  worksiteId: string | null
  worksiteName: string | null
  /** Nivel de pauta: «40.000 KM» en el histórico, «40.000» en el nativo. */
  level: string
  levelValue: number | null
  mechanic: string | null
  mechanicKey: string | null
  done: number
  notDone: number
  notApplicable: number
  /** 0–100; `null` si la pauta no trae realizados ni no realizados. */
  percent: number | null
}

export interface ComplianceBucket {
  key: string
  label: string
  /** Promedio de los % de cada pauta (no pooled). */
  percent: number | null
  checks: number
  /** Para el clic de una barra faena + mecánico. */
  worksiteId?: string | null
  worksiteName?: string | null
  mechanicKey?: string | null
  mechanicLabel?: string | null
}

export interface ComplianceByPlate {
  vehicleId: string | null
  code: string
  plate: string
  worksiteId: string | null
  worksiteName: string | null
  percent: number | null
  checks: number
  levels: string[]
}

export interface PreventiveCompliance {
  checks: ComplianceCheck[]
  byMonth: ComplianceBucket[]
  byWorksiteMechanic: ComplianceBucket[]
  byPlate: ComplianceByPlate[]
  average: number | null
  total: number
}

export interface MatrixItem {
  name: string
  group: string | null
  sortOrder: number
}

export interface MatrixCheck {
  id: string
  source: "historial" | "registro"
  date: string
  label: string
  code: string
  plate: string
  worksiteName: string | null
  level: string
  mechanic: string | null
  /** Fotos nativas: se abren en el visor existente. */
  photoIds: Array<{ id: string; caption: string; stampedAt: string; receivedAt: string }>
  /** Enlaces de respaldo históricos (Google Drive): no se descargan. */
  photoUrls: Array<{ label: string; url: string }>
  observations: string | null
  /** Resultado por nombre de ítem. */
  items: Record<string, "realizado" | "no_realizado" | "no_aplica">
  /** Orden de los ítems dentro de esta pauta. */
  itemOrder: Record<string, number>
  /** Sistema del ítem (sólo el registro nativo lo trae). */
  itemGroups: Record<string, string | null>
}

export interface ChecklistMatrix {
  checks: MatrixCheck[]
  items: MatrixItem[]
  /** Pautas históricas del período que no traen detalle por ítem. */
  withoutDetail: number
}

export interface LookerContext {
  filters: LookerFilters
  options: LookerOptions
  cross: ResolvedCrossFilters
}
