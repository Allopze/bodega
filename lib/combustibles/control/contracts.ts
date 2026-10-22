/**
 * Contratos compartidos del submódulo de control de combustible.
 *
 * Vocabulario, etiquetas en español y firmas que comparten el cálculo, la
 * proyección, las vistas y los importadores. Ver GAP_MODULO_COMBUSTIBLE.md §6.
 * Las etiquetas viven aquí para que ninguna pantalla muestre un enum crudo.
 */

export const PERFORMANCE_FAMILIES = ["camiones", "cargadores_camionetas", "maquinaria"] as const
export type PerformanceFamily = (typeof PERFORMANCE_FAMILIES)[number]

export const PERFORMANCE_FAMILY_LABELS: Record<PerformanceFamily, string> = {
  camiones: "Camiones y tracto camiones",
  cargadores_camionetas: "Cargadores y camionetas",
  maquinaria: "Retroexcavadoras, excavadoras y maquinaria",
}

/** Segmento de URL de cada familia: `/combustibles/control/rendimiento/<slug>`. */
export const PERFORMANCE_FAMILY_SLUGS: Record<PerformanceFamily, string> = {
  camiones: "camiones",
  cargadores_camionetas: "cargadores-camionetas",
  maquinaria: "maquinaria",
}

export function familyFromSlug(slug: string): PerformanceFamily | null {
  const entry = Object.entries(PERFORMANCE_FAMILY_SLUGS).find(([, value]) => value === slug)
  return entry ? (entry[0] as PerformanceFamily) : null
}

export type PerformanceUnit = "km_per_liter" | "liters_per_hour"

export const PERFORMANCE_UNIT_LABELS: Record<PerformanceUnit, string> = {
  km_per_liter: "km/L",
  liters_per_hour: "L/h",
}

/** Nombre completo para `title`/tooltip (regla A6: abreviaturas de dominio). */
export const PERFORMANCE_UNIT_TITLES: Record<PerformanceUnit, string> = {
  km_per_liter: "Kilómetros recorridos por litro (equipos con odómetro)",
  liters_per_hour: "Litros consumidos por hora de motor (equipos con horómetro)",
}

export type LoadSource = "operations_import" | "field" | "legacy_tae"

export const LOAD_SOURCE_LABELS: Record<LoadSource, string> = {
  operations_import: "Planilla de cargas",
  field: "Registro en terreno",
  legacy_tae: "Histórico de sellos",
}

export type PerformanceStatus =
  | "computed"
  | "first_load"
  | "no_meter"
  | "meter_regression"
  | "meter_reset"
  | "zero_delta"
  | "not_applicable"
  | "excluded"

export const PERFORMANCE_STATUS_LABELS: Record<PerformanceStatus, string> = {
  computed: "Calculado",
  first_load: "Primera carga del equipo",
  no_meter: "Sin lectura de medidor",
  meter_regression: "Lectura menor a la anterior",
  meter_reset: "Inicio de serie (cambio de medidor)",
  zero_delta: "Medidor sin avance",
  not_applicable: "El equipo no mide rendimiento",
  excluded: "Excluida (anulada, duplicada o rechazada)",
}

export type ReviewStatus = "ok" | "flagged" | "approved" | "rejected"

export const REVIEW_STATUS_LABELS: Record<ReviewStatus, string> = {
  ok: "Sin observaciones",
  flagged: "En revisión",
  approved: "Aprobada",
  rejected: "Rechazada",
}

export const FLAG_REASONS = [
  "outlier",
  "implausible",
  "meter_regression",
  "over_capacity",
  "filler_value",
  "duplicate",
  "unknown_vehicle",
] as const
export type FlagReason = (typeof FLAG_REASONS)[number]

export const FLAG_REASON_LABELS: Record<FlagReason, string> = {
  outlier: "Rendimiento atípico para el equipo",
  implausible: "Rendimiento fuera de rango físico",
  meter_regression: "Lectura de medidor menor a la anterior",
  over_capacity: "Litros sobre la capacidad del estanque",
  filler_value: "Valor de relleno (sello o fecha inventados)",
  duplicate: "Posible carga duplicada",
  unknown_vehicle: "Equipo sin ficha en el catálogo",
}

/** Lugar de carga (tipo de punto). `tae` y `other` son legados. */
export type LoadingPointType = "fixed_dispenser" | "truck_dispenser" | "pickup_tank" | "jerrycan" | "card_station" | "tae" | "other"

export const LOADING_POINT_TYPE_LABELS: Record<LoadingPointType, string> = {
  fixed_dispenser: "Surtidor fijo",
  truck_dispenser: "Camión surtidor",
  pickup_tank: "Estanque de camioneta",
  jerrycan: "Bidón",
  card_station: "Estación de servicio con tarjeta",
  tae: "Punto TAE",
  other: "Otro",
}

/** Supuesto S-3: cómo cuenta cada lugar en la conciliación por mandante (C-02). */
export type DeliveryMode = "direct" | "via_tank"

export function deliveryModeFor(type: LoadingPointType | null | undefined): DeliveryMode {
  return type === "pickup_tank" || type === "truck_dispenser" || type === "jerrycan" ? "via_tank" : "direct"
}

export type SupplyMediumKind = "card" | "provider_station" | "mandante_dispenser" | "own_tank" | "other"

export const SUPPLY_MEDIUM_KIND_LABELS: Record<SupplyMediumKind, string> = {
  card: "Tarjeta de combustible",
  provider_station: "Estación del proveedor",
  mandante_dispenser: "Surtidor del mandante",
  own_tank: "Estanque propio",
  other: "Otro",
}

export type SealChainStatus = "not_evaluated" | "ok" | "mismatch" | "no_previous" | "no_seal"

export const SEAL_CHAIN_STATUS_LABELS: Record<SealChainStatus, string> = {
  not_evaluated: "Sin evaluar",
  ok: "Cadena correcta",
  mismatch: "El sello retirado no es el instalado en la carga anterior",
  no_previous: "Primera carga con sello",
  no_seal: "Carga sin sello (con motivo)",
}

/** Umbrales del control de rendimiento (clave `combustibles.control.performance` en `system_settings`). */
export interface PerformanceControlSettings {
  /** k: una carga es atípica si |x − media| > k·σ de su propio historial. Sale de la regla `rendimiento_fuera_historico`. */
  thresholdStdDevs: number
  /** Cargas previas válidas necesarias para juzgar si una es atípica. */
  minSamples: number
  /** Cotas físicas: sobre esto la carga es implausible aunque el historial sea corto. */
  maxKmPerLiter: number
  maxLitersPerHour: number
  /** Ventana para considerar duplicada una carga del mismo equipo llegada por otro canal (S-7). */
  duplicateWindowMinutes: number
  duplicateLitersTolerance: number
}

export const DEFAULT_PERFORMANCE_CONTROL_SETTINGS: PerformanceControlSettings = {
  thresholdStdDevs: 2,
  minSamples: 5,
  maxKmPerLiter: 25,
  maxLitersPerHour: 80,
  duplicateWindowMinutes: 15,
  duplicateLitersTolerance: 0.5,
}

export const PERFORMANCE_SETTINGS_KEY = "combustibles.control.performance"

/** Valor de una celda de estadística que no se puede calcular (n < 2 para σ). */
export const STAT_MISSING = "—"
