/**
 * Tipos y constantes compartidas de la bitácora de combustible.
 * Separado de fuel-log.ts para que los Client Components puedan importar
 * tipos y constantes SIN arrastrar el módulo `db` → `postgres` → `fs`.
 *
 * Ver: https://nextjs.org/docs/app/building-your-application/rendering/composition-patterns
 */

import { FLAG_REASON_LABELS, type FlagReason } from "@/lib/combustibles/control/contracts"

export type FuelLogSource = "tae_pwa" | "invoiced" | "operation_manual"

export const FUEL_LOG_SOURCE_LABEL: Record<FuelLogSource, string> = {
  tae_pwa: "Registro en terreno",
  invoiced: "Factura",
  operation_manual: "Planilla de cargas",
}

/**
 * «Cómo llegó» una carga, en palabras (rediseño 2026-10-31). `tae_pwa` se abre
 * en tres según `fuel_tae_submissions.source`, que antes salían todas como
 * «TAE (PWA)». La clave es el valor del filtro `como` en la URL.
 */
export const FUEL_LOAD_ORIGIN_LABEL = {
  qr: "Formulario en terreno (QR)",
  app: "Registrada en la app",
  historico: "Histórico de sellos",
  planilla: "Planilla de cargas",
  factura: "Factura",
} as const
export type FuelLoadOriginSlug = keyof typeof FUEL_LOAD_ORIGIN_LABEL
export const FUEL_LOAD_ORIGIN_SLUGS = Object.keys(FUEL_LOAD_ORIGIN_LABEL) as FuelLoadOriginSlug[]

/** `fuel_tae_submissions.source` → origen visible. */
export const TAE_SUBMISSION_SOURCE_TO_ORIGIN: Record<string, FuelLoadOriginSlug> = {
  public_pwa: "qr",
  internal_app: "app",
  legacy_xlsx: "historico",
}

/** Estado de una carga en la URL (`estado=`) → valor guardado, por tabla de origen. */
export const FUEL_LOAD_STATE_SLUGS = {
  "por-validar": { tae: "submitted" },
  "con-observacion": { tae: "observed" },
  validada: { tae: "validated" },
  anulada: { tae: "voided", invoiced: "cancelled" },
  borrador: { invoiced: "draft" },
  registrada: { invoiced: "registered" },
  conciliada: { invoiced: "reconciled" },
} as const satisfies Record<string, { tae?: string; invoiced?: string }>
export type FuelLoadStateSlug = keyof typeof FUEL_LOAD_STATE_SLUGS

/** Rótulo del estado de una carga en el filtro `estado` (mismo vocabulario que `StateBadge`). */
export const FUEL_LOAD_STATE_LABEL: Record<FuelLoadStateSlug, string> = {
  "por-validar": "Por validar",
  "con-observacion": "Con observación",
  validada: "Validada",
  anulada: "Anulada",
  borrador: "Borrador",
  registrada: "Registrada",
  conciliada: "Conciliada",
}

/** Orígenes que son un registro en terreno (`fuel_tae_submissions`). */
export const FUEL_TERRENO_ORIGIN_SLUGS = ["qr", "app", "historico"] as const satisfies readonly FuelLoadOriginSlug[]

/** `como=qr,app` → orígenes válidos, sin repetidos y en el orden del catálogo. Vacío = todos. */
export function parseFuelLoadOrigins(raw: string | string[] | undefined | null): FuelLoadOriginSlug[] {
  const text = (Array.isArray(raw) ? raw.join(",") : raw ?? "").toLowerCase()
  const wanted = new Set(text.split(",").map((part) => part.trim()).filter(Boolean))
  return FUEL_LOAD_ORIGIN_SLUGS.filter((slug) => wanted.has(slug))
}

/** `estado=validada` → el slug, o `undefined` si no existe (un valor fuera del catálogo se descarta, no filtra a cero). */
export function parseFuelLoadState(raw: string | string[] | undefined | null): FuelLoadStateSlug | undefined {
  const value = (Array.isArray(raw) ? raw[0] : raw)?.trim()
  return value && Object.hasOwn(FUEL_LOAD_STATE_SLUGS, value) ? (value as FuelLoadStateSlug) : undefined
}

/** Origen visible → tabla de la que sale la fila. */
export function fuelLogSourceForOrigin(origin: FuelLoadOriginSlug): FuelLogSource {
  if (origin === "factura") return "invoiced"
  if (origin === "planilla") return "operation_manual"
  return "tae_pwa"
}

/**
 * Qué ramas aporta cada combinación de `source`, `como` y `estado`. Una rama que
 * el filtro descarta ni se consulta: es más barato y evita un `where false`.
 */
export function fuelLogBranchesFor(filters: Pick<FuelLogFilters, "source" | "origins" | "stateSlug" | "registeredBy">): { tae: boolean; invoiced: boolean; operation: boolean } {
  let tae = true
  let invoiced = true
  let operation = true
  if (filters.source) {
    tae = filters.source === "tae_pwa"
    invoiced = filters.source === "invoiced"
    operation = filters.source === "operation_manual"
  }
  if (filters.origins?.length) {
    tae = tae && FUEL_TERRENO_ORIGIN_SLUGS.some((slug) => filters.origins!.includes(slug))
    invoiced = invoiced && filters.origins.includes("factura")
    operation = operation && filters.origins.includes("planilla")
  }
  if (filters.registeredBy) {
    invoiced = false
    operation = false
  }
  if (filters.stateSlug) {
    const states = FUEL_LOAD_STATE_SLUGS[filters.stateSlug] as { tae?: string; invoiced?: string }
    tae = tae && Boolean(states.tae)
    invoiced = invoiced && Boolean(states.invoiced)
    operation = false
  }
  return { tae, invoiced, operation }
}

/** Lo que espera una decisión en una fila de Cargas: «Pendiente» en la lista. */
export type FuelLogPendingKind = "decide" | "observed" | "requested" | "case"

export const FUEL_LOG_PENDING_LABEL: Record<FuelLogPendingKind, string> = {
  decide: "Por decidir",
  observed: "Con observación",
  requested: "Revisión pedida",
  case: "Caso abierto",
}

/**
 * Lo que ve en lugar del nombre de una persona quien no tiene
 * `combustibles:view_personal` (D-10). El servidor ya entrega `null`; la UI
 * rotula ese vacío con esto y no con "—", que se leería como "sin dato".
 */
export const PERSONAL_DATA_LABEL = "Reservado"

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
  /** `null` también cuando la sesión no tiene `combustibles:view_personal`: se enmascara en la consulta. */
  driverName: string | null
  /** Ídem `driverName`. */
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
  /** `true` si el registro tiene un pedido de revisión ABIERTO. `null` cuando no existe (el SQL retorna NULL). */
  reviewMark: boolean | null
  /** Nota del pedido de revisión abierto, si existe. */
  reviewMarkNotes: string | null
  /** ID del pedido de revisión abierto (para retirarlo o abrirlo en la bandeja). */
  reviewMarkId: string | null
  /** Quién pidió el pedido de revisión abierto (id de usuario). */
  reviewMarkedBy: string | null
  /** Cómo llegó la carga: formulario en terreno (QR), app, histórico de sellos, planilla o factura. */
  origin: FuelLoadOriginSlug
  /** Faena de la carga (`null` en una fila de planilla cuya faena no se pudo vincular). */
  worksiteId: string | null
  /** Equipo de la flota (`null` cuando la patente no está vinculada). */
  vehicleId: string | null
  /** Fila en `fuel_equipment_loads` (la que decide la bandeja); `null` en facturas y cargas aún sin proyectar. */
  equipmentLoadId: string | null
  /** La plataforma dejó la carga «por decidir» (`review_status='flagged'`); `null` si no hay fila proyectada. */
  reviewFlagged: boolean | null
  /** Primer motivo de la marca (código de `FLAG_REASONS`). */
  reviewFlagReason: string | null
}

/**
 * Qué espera una decisión en esta fila, en orden de importancia: una carga por
 * decidir, una con observación y un pedido de revisión abierto. Vacío = nada
 * pendiente. `label` ya está en palabras (el motivo de la marca, no su código).
 */
export function fuelLogPending(row: Pick<FuelLogRow, "source" | "statusLabel" | "reviewMark" | "reviewFlagged" | "reviewFlagReason"> & { anomalyCount?: number | null }): Array<{ kind: FuelLogPendingKind; label: string }> {
  const out: Array<{ kind: FuelLogPendingKind; label: string }> = []
  if (row.reviewFlagged) {
    const reason = row.reviewFlagReason && Object.hasOwn(FLAG_REASON_LABELS, row.reviewFlagReason) ? FLAG_REASON_LABELS[row.reviewFlagReason as FlagReason] : null
    out.push({ kind: "decide", label: reason ?? FUEL_LOG_PENDING_LABEL.decide })
  }
  if (row.source === "tae_pwa" && row.statusLabel === "observed") out.push({ kind: "observed", label: FUEL_LOG_PENDING_LABEL.observed })
  if (row.reviewMark) out.push({ kind: "requested", label: FUEL_LOG_PENDING_LABEL.requested })
  // Un caso de anomalía abierto también espera a una persona (se decide en «Por revisar»).
  const cases = row.anomalyCount ?? 0
  if (cases > 0) out.push({ kind: "case", label: cases === 1 ? FUEL_LOG_PENDING_LABEL.case : `${cases} casos abiertos` })
  return out
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
  /** Sólo filas con un pedido de revisión abierto. */
  hasReviewMark?: boolean
  /** Cómo llegó (varios a la vez). Vacío o ausente = todos. Se combina con `source` (ambos deben cumplirse). */
  origins?: FuelLoadOriginSlug[]
  /** Estado de la carga en palabras (`FUEL_LOAD_STATE_SLUGS`). La planilla no tiene estado: con este filtro no aporta filas. */
  stateSlug?: FuelLoadStateSlug
  /** Sólo cargas con algo pendiente: por decidir, con observación o con un pedido de revisión abierto. */
  onlyPending?: boolean
  /** Equipo de la flota (`fuel_vehicles.id`). */
  vehicleId?: string
  /**
   * Sólo las cargas que registró esta persona (`fuel_tae_submissions.registered_by`): `mias=si` en la URL.
   * Las de planilla y factura no son «de» nadie, así que con este filtro sólo quedan las de terreno.
   */
  registeredBy?: string
  /** Sólo registros en terreno con el sello retirado o el instalado sin informar. */
  sealIncomplete?: boolean
  /** Sólo registros en terreno con menos de las 4 fotos. */
  photosIncomplete?: boolean
}
