import type { PerformanceFamily, PerformanceUnit } from "@/lib/combustibles/control/contracts"

/**
 * Ficha de equipo (`/combustibles/consumo/equipos/[id]`, rediseño 2026-10-31):
 * lo que antes estaba repartido en cinco pantallas —cargas, rendimiento contra
 * su modelo, motor en vacío, cadena de sellos y casos— reunido por equipo y por
 * período. Tipos puros: los usan el servicio, la página y las pruebas.
 */

export interface EquipmentFileVehicle {
  id: string
  code: string | null
  plate: string
  /** «CA-14 · KPRT14», o sólo la patente cuando no hay código. */
  label: string
  brand: string | null
  model: string | null
  year: number | null
  typeName: string
  /** Identificador del tipo de equipo (para el umbral de atípicos propio del tipo). */
  typeSlug: string
  family: PerformanceFamily | null
  /** `null` cuando el equipo no mide rendimiento. */
  unit: PerformanceUnit | null
  meterType: "odometer" | "hour_meter" | "none"
  tankCapacityLiters: number | null
  worksiteId: string
  worksiteName: string
  usualSupplierName: string | null
  isActive: boolean
}

export interface EquipmentFileLoad {
  id: string
  occurredAt: string
  liters: number
  meterType: "odometer" | "hour_meter" | null
  meterReading: number | null
  performanceValue: number | null
  /** Motivo en palabras cuando no hay rendimiento calculado; `null` si está calculado. */
  performanceNote: string | null
  /** «Formulario en terreno (QR)», «Registrada en la app», «Planilla de cargas»… */
  originLabel: string
  /** Estado de la fila de terreno («Por validar», «Validada»…); `null` en la planilla, que no tiene estado. */
  stateLabel: string | null
  reviewStatus: "ok" | "flagged" | "approved" | "rejected"
  /** Ficha de la carga (`fuelLoadHref`); `null` si no se puede armar. */
  href: string | null
}

export interface EquipmentFileLoads {
  /** Cargas que cuentan (sin anuladas, duplicadas ni rechazadas) y sus litros en el período. */
  count: number
  liters: number
  /** Las más recientes del período, con las rechazadas y por decidir a la vista (con su estado). */
  rows: EquipmentFileLoad[]
  /** Cuántas cargas del período no caben en `rows`. */
  hiddenCount: number
}

export interface EquipmentSeriesPoint {
  id: string
  occurredAt: string
  value: number
  /** Cae fuera del rango normal en la dirección mala (km/L: debajo; L/h: encima). */
  outOfRange: boolean
}

export interface EquipmentNormalRange {
  low: number
  high: number
  mean: number
  sd: number
  samples: number
  /** Cuántas desviaciones estándar abarca el rango. */
  k: number
}

export interface EquipmentFilePerformance {
  unit: PerformanceUnit
  /** Cargas válidas del período que forman el promedio. */
  n: number
  mean: number | null
  modelMean: number | null
  deltaModelPct: number | null
  worseThanModel: boolean
  historyMean: number | null
  deltaHistoryPct: number | null
  worseThanHistory: boolean
  /** «parejo» / «irregular» (variación > 25 %); `null` con menos de 2 cargas válidas. */
  regularity: "parejo" | "irregular" | null
  cv: number | null
  /** Últimas cargas con rendimiento calculado hasta el fin del período, de la más antigua a la más nueva. */
  series: EquipmentSeriesPoint[]
  normalRange: EquipmentNormalRange | null
  /** Desde cuándo rinde fuera de su rango, si las últimas cargas lo están. */
  outOfRangeSince: { at: string; count: number } | null
  /** Cargas por decidir con rendimiento calculado que no entran al promedio. */
  excludedInReview: number
}

export interface EquipmentFileIdle {
  operatingHours: number
  idleHours: number
  /** Horas en vacío ÷ horas de funcionamiento; `null` sin horas. */
  idlePct: number | null
  /** `null` cuando la telemetría no informa litros. */
  litersIdle: number | null
  activeDays: number
  /**
   * Un registro por día del período, en orden (CHART-024). Si dos fuentes informan el mismo día
   * manda la de más horas de motor (`dailyTelemetry`), así que sumarla da los totales de arriba.
   */
  daily: EquipmentFileIdleDay[]
}

export interface EquipmentFileIdleDay {
  /** «YYYY-MM-DD». */
  day: string
  operatingHours: number
  idleHours: number
  /** Horas en vacío ÷ horas de funcionamiento del día; `null` sin horas. */
  idlePct: number | null
}

export interface EquipmentFileSealIssue {
  submissionId: string
  loadedAt: string
  removedSeal: string | null
  expectedSeal: string | null
}

export interface EquipmentFileSeals {
  /** Cargas con sello evaluado en el período. */
  loads: number
  /** Cargas del período con el sello retirado distinto del instalado en la anterior. */
  mismatches: number
  /** Cargas del período sin sello retirado o instalado. */
  withoutSeal: number
  /** Sello instalado en la última carga del equipo, tenga o no fecha en el período. */
  lastInstalledSeal: string | null
  lastLoadAt: string | null
  /** Las primeras cargas con la cadena rota, las más recientes primero. */
  issues: EquipmentFileSealIssue[]
}

export interface EquipmentFileCaseItem {
  /** `kind:id` de la bandeja (`inboxRowKey`). */
  key: string
  kind: "carga" | "caso" | "pedido"
  title: string
  detail: string | null
  severity: "low" | "medium" | "high" | "critical" | null
  since: string
  /** Enlace a «Por revisar» con el ítem abierto (`fuelInboxHref`). */
  href: string
}

export interface EquipmentFileLitersMonth {
  /** Mes "YYYY-MM" en hora de Chile (la columna `month` de la carga). */
  month: string
  /** Litros de las cargas que cuentan ese mes; 0 si no hubo ninguna. */
  liters: number
  /** Cuántas cargas que cuentan hubo ese mes; 0 si no hubo ninguna. */
  loads: number
}

export interface EquipmentFile {
  vehicle: EquipmentFileVehicle
  loads: EquipmentFileLoads
  /** `null` cuando el equipo no mide rendimiento o no tuvo cargas contables en el período. */
  performance: EquipmentFilePerformance | null
  /**
   * Litros de los 12 meses que terminan en el del fin del período, del más antiguo al más
   * reciente y con ceros donde no hubo cargas que cuenten. No depende del período elegido
   * más que por el mes en que termina. `[]` si la consulta falló (`degraded` lo dice).
   */
  litersByMonth: EquipmentFileLitersMonth[]
  /** `null` cuando el equipo no tiene telemetría en el período. */
  idle: EquipmentFileIdle | null
  /** `null` cuando quien consulta no tiene `combustibles:tae_view` (los sellos son un dato de terreno). */
  seals: EquipmentFileSeals | null
  /** Cargas por decidir, casos vigentes y pedidos de revisión abiertos del equipo. */
  cases: EquipmentFileCaseItem[]
  /** Secciones que fallaron al cargar; la pantalla lo dice en vez de mostrar un cero falso. */
  degraded: string[]
  /** Cuántas secciones se consultaron, para «N de M fuentes». */
  sourceCount: number
}
