import type { MantEquipmentState, MantUnit } from "@/lib/mantencion/types"

/**
 * Tipos del tablero de Mantención estilo Looker.
 *
 * La pestaña `hoy` es el Panel operativo de siempre; Planificación, Correctivo y Preventivo leen los
 * mismos datos con agregaciones propias, todas de UNA unidad (`unidad=km|h`, km por defecto). Los
 * filtros manuales (`faena`, `equipo`, `frecuencia`, período), los de Planificación (`estado`, `fecha*`),
 * la ficha de Preventivo (`ficha`, `pauta`) y los filtros cruzados (`x_*`) viajan en la URL: el servidor
 * consulta y el navegador sólo dibuja.
 */

export const LOOKER_TABS = ["hoy", "planificacion", "correctivo", "preventivo"] as const
export type LookerTab = (typeof LOOKER_TABS)[number]

/**
 * Valores de `pestana` que hubo antes del reajuste de 2026-11 («Por kilómetros» y «Por horas»). Hay enlaces
 * guardados con ellos: se leen como Correctivo en su unidad y la página redirige a la URL canónica.
 */
export const LEGACY_LOOKER_TABS = { camiones: "km", maquinas: "h" } as const satisfies Record<string, MantUnit>
export type LegacyLookerTab = keyof typeof LEGACY_LOOKER_TABS

export function isLookerTab(value: string | undefined): value is LookerTab {
  return value !== undefined && (LOOKER_TABS as readonly string[]).includes(value)
}

export function isLegacyLookerTab(value: string | undefined): value is LegacyLookerTab {
  return value !== undefined && Object.hasOwn(LEGACY_LOOKER_TABS, value)
}

/** Estado de un equipo en Planificación (`estado=`). Sale de `remainingTone`. */
export const PLANNING_STATES = ["vencida", "proxima", "al_dia", "sin_dato"] as const
export type PlanningState = (typeof PLANNING_STATES)[number]

/** Qué fecha filtra Planificación: la estimada de la próxima (por defecto) o la de la última mantención. */
export type PlanningDateField = "proxima" | "ultima"

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
  /** Unidad de control de Planificación, Correctivo y Preventivo (`unidad`; km por defecto). */
  unit: MantUnit
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
  /** Planificación: estado de la tira de cifras (`estado`). */
  planningState: PlanningState | null
  /** Planificación: qué fecha filtra el rango (`fecha`). */
  dateField: PlanningDateField
  /** Planificación: rango `fecha_desde`/`fecha_hasta`, ya validado (un valor inválido queda en `null`). */
  dateFrom: string | null
  dateTo: string | null
  /** Algún extremo del rango de fechas de Planificación llegó con un valor inválido y se ignoró. */
  invalidDateRange: boolean
  /** Preventivo: ficha abierta (`ficha=<vehicleId>`) y pauta elegida en ella (`pauta=<checkId>`). */
  sheetVehicleId: string | null
  sheetCheckId: string | null
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
  /** Uso diario de los últimos 30 días (km/día u h/día); `null` si no se puede estimar. Es referencia. */
  dailyUsage: number | null
  /** Fecha estimada de la próxima (pasada si ya venció); `null` sin estimación. Nunca cambia `state`. */
  estimatedDate: string | null
  /** Por qué no hay fecha estimada (va en el `title` del «—»); `null` cuando la hay. */
  estimateNote: string | null
}

export interface PlanningData {
  /** Filas de la unidad de la pestaña, con todos los filtros (incluidos `estado` y el rango de fechas). */
  rows: PlanningRow[]
  /** Conteo por estado con los DEMÁS filtros (sin `estado`): es la tira de cifras. */
  counts: Record<PlanningState, number> & { total: number }
  /** Equipo elegido por el filtro cruzado. */
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
  /** Conductores del trabajo, sin repetir (el histórico los trae como texto libre). */
  drivers: string[]
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
}

export interface EquipmentSeriesRow {
  vehicleId: string
  /** Lo que rotula el eje del gráfico: la patente (el código si el equipo no la tiene). */
  label: string
  code: string
  plate: string
  records: number
  hours: number
}

/** Un mes del período con su conteo (trabajos correctivos por mes). */
export interface MonthlyCount {
  /** `YYYY-MM`. */
  key: string
  label: string
  count: number
  /** El mes en curso: todavía no termina y su columna no se lee como una caída. */
  partial: boolean
}

/** La tira de cifras de Correctivo. */
export interface CorrectiveStats {
  total: number
  /** Horas de trabajo (las que declara cada OT o registro; lo que no las trae no suma). */
  hours: number
  /** Equipos distintos con al menos un trabajo. */
  equipment: number
  /** Trabajos que pueden llevar foto: las OT y los registros de la plataforma (el histórico no trae fotos). */
  photoEligible: number
  /** De ésos, los que no tienen foto de respaldo. */
  withoutPhoto: number
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
  /**
   * Las dos fotos de evidencia (filtros y sticker) están. Histórico: ambos enlaces con texto; nativo: una foto
   * `filtros` y una `sticker` en la plataforma. Una pauta cerrada sin ellas «no debió cerrarse».
   */
  photosComplete: boolean
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

export interface ComplianceByPlate extends Record<string, unknown> {
  vehicleId: string | null
  code: string
  plate: string
  worksiteId: string | null
  worksiteName: string | null
  percent: number | null
  checks: number
  levels: string[]
  /** Ítems «no realizados» sumados en todas las pautas del período. */
  notDone: number
  /** Fecha y mecánico de la pauta más reciente del período. */
  lastDate: string | null
  lastMechanic: string | null
  /** Pautas del período sin las dos fotos de evidencia. */
  withoutPhotos: number
}

export interface PreventiveCompliance {
  checks: ComplianceCheck[]
  byMonth: ComplianceBucket[]
  byWorksiteMechanic: ComplianceBucket[]
  byPlate: ComplianceByPlate[]
  average: number | null
  total: number
  /** Ítems «no realizados» sumados en todas las pautas. */
  notDone: number
  /** Pautas sin las dos fotos de evidencia. */
  withoutPhotos: number
}

export interface MatrixItem {
  name: string
  group: string | null
  sortOrder: number
}

export interface MatrixCheck {
  id: string
  source: "historial" | "registro"
  /** Para abrir la ficha del equipo en esta pauta. */
  vehicleId: string | null
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
