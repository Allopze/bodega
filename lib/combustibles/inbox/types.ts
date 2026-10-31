/**
 * Bandeja única «Por revisar» (rediseño 2026-10-31). Junta en una lista lo que
 * espera la decisión de una persona y que antes vivía en dos colas y una marca
 * suelta de la bitácora:
 *   - `carga`   cargas de `fuel_equipment_loads` en `review_status='flagged'` (por decidir);
 *   - `caso`    casos de anomalía vigentes (`open`, `in_review`, `reopened`);
 *   - `patente` patentes o equipos de una importación que no están en la flota;
 *   - `pedido`  pedidos de revisión con nota (`fuel_review_marks` en `status='open'`).
 *
 * Módulo puro: lo usan la página, la hoja de decisión (cliente) y el Panel.
 */
export const FUEL_INBOX_KINDS = ["carga", "caso", "patente", "pedido"] as const
export type FuelInboxKind = (typeof FUEL_INBOX_KINDS)[number]

export const FUEL_INBOX_KIND_LABELS: Record<FuelInboxKind, string> = {
  carga: "Cargas por decidir",
  caso: "Casos",
  patente: "Patentes sin vincular",
  pedido: "Pedidas por una persona",
}

export interface FuelInboxDecided {
  /** «Cuenta», «No cuenta», «Resuelto», «Descartado», «Vinculada», «Revisado». */
  outcome: string
  byName: string | null
  at: string
  note: string | null
}

export interface FuelInboxRow {
  /** `${kind}:${id}`; el `id` de una patente es `${batchKind}:${batchId}:${plate}`. */
  key: string
  kind: FuelInboxKind
  id: string
  worksiteId: string | null
  worksiteName: string | null
  /** «CA-14 · KPRT·14», o la patente cuando no hay equipo. */
  equipmentLabel: string
  vehicleId: string | null
  /** Qué pasó, en palabras: «Lectura menor a la anterior», «Caso · Sello repetido». */
  title: string
  reasonCodes: string[]
  reasonLabel: string
  /** El dato que lo explica: «182.310 km; la carga anterior marcó 182.900 km». */
  datum: string
  /** Mes del dato ("YYYY-MM"): define la fecha límite. */
  dataMonth: string
  /** Último día de `dataMonth`: lo que cambia las cifras del mes debería resolverse antes del cierre. */
  dueDate: string
  /** Desde cuándo espera (instante ISO). */
  waitingSince: string
  severity?: "low" | "medium" | "high" | "critical" | null
  assignee?: { id: string; name: string | null } | null
  decided?: FuelInboxDecided | null
  /** Ficha de la carga, del equipo o del lote al que se refiere. */
  href: string | null
  /** La sesión puede decidirlo (permiso + alcance). */
  canAct: boolean
}

export type FuelInboxView = "pendientes" | "decididas"

export interface FuelInboxFilters {
  view: FuelInboxView
  kind?: FuelInboxKind
  worksiteId?: string
  /** En «Decididas»: `cuenta` / `no-cuenta` para cargas. */
  decision?: string
  page: number
  pageSize?: number
}

export interface FuelInboxPage {
  rows: FuelInboxRow[]
  total: number
  page: number
  pageSize: number
}

export interface FuelInboxSummary {
  /** `null` cuando una consulta falló: nunca se afirma un cero falso. */
  total: number | null
  byKind: Record<FuelInboxKind, number | null>
  /** Instante ISO del pendiente más antiguo. */
  oldestWaitingSince: string | null
}

/** El dato que explica cada caso, para la hoja de decisión. */
export type FuelInboxEvidence =
  | { type: "readings"; unit: "km" | "h"; points: { at: string; reading: number; current: boolean }[] }
  | { type: "duplicate"; loads: { at: string; liters: number; reading: number | null; originLabel: string; href: string | null }[]; windowMinutes: number; litersTolerance: number }
  | { type: "capacity"; liters: number; capacity: number }
  | { type: "range"; value: number; unit: string; low: number; high: number; samples: number; lowerIsBetter: boolean }
  | { type: "late_entry"; loadedAt: string; registeredAt: string; reason: string }
  | { type: "text"; text: string }

export interface FuelInboxItemDetail {
  row: FuelInboxRow
  evidence: FuelInboxEvidence[]
  /** Comentarios de un caso o la nota de un pedido. */
  history: { at: string; byName: string | null; text: string }[]
}

function pad(n: number): string {
  return String(n).padStart(2, "0")
}

/** Último día del mes "YYYY-MM". */
export function inboxDueDate(dataMonth: string): string {
  const [year = 0, month = 1] = dataMonth.split("-").map(Number)
  return `${dataMonth}-${pad(new Date(Date.UTC(year, month, 0)).getUTCDate())}`
}

/** Fecha límite ascendente y, a igual fecha, lo que lleva más tiempo esperando primero. */
export function compareInboxRows(a: Pick<FuelInboxRow, "dueDate" | "waitingSince" | "key">, b: Pick<FuelInboxRow, "dueDate" | "waitingSince" | "key">): number {
  return a.dueDate.localeCompare(b.dueDate) || a.waitingSince.localeCompare(b.waitingSince) || a.key.localeCompare(b.key)
}

export function inboxRowKey(kind: FuelInboxKind, id: string): string {
  return `${kind}:${id}`
}

export function parseInboxRowKey(key: string | undefined | null): { kind: FuelInboxKind; id: string } | null {
  if (!key) return null
  const index = key.indexOf(":")
  if (index < 0) return null
  const kind = key.slice(0, index) as FuelInboxKind
  const id = key.slice(index + 1)
  return (FUEL_INBOX_KINDS as readonly string[]).includes(kind) && id ? { kind, id } : null
}
