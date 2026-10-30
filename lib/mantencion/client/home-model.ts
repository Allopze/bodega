import type { CatalogObservation, MantCatalog } from "../contracts"
import { recordKindText } from "../format"
import type { MantUnit } from "../types"
import { formatDate, formatDateTime, todayInChile } from "@/lib/utils"
import type { QueueItem, QueueRecordItem, QueueStatus } from "./types"

/** Lo que muestra «Mis últimos registros»: lo que el servidor ya conoce más lo que el teléfono aún no envió. */

export type RecentState = "sent" | "sending" | "pending" | "needs_login" | "rejected"

export interface RecentRow {
  id: string
  kind: "P" | "C"
  equipmentCode: string
  equipmentPlate: string
  title: string
  /** ISO del momento de recepción (servidor) o de la firma (teléfono). */
  when: string
  folio: string | null
  state: RecentState
  voided: boolean
  rejection: string | null
}

const STATE_OF: Record<QueueStatus, RecentState> = { pending: "pending", sending: "sending", sent: "sent", rejected: "rejected", needs_login: "needs_login" }

export const RECENT_STATE_LABEL: Record<RecentState, string> = {
  sent: "Enviado",
  sending: "Enviando…",
  pending: "En el teléfono",
  needs_login: "Falta entrar",
  rejected: "Rechazado",
}

/** «hoy 14:05» si es de hoy, y la fecha dd-mm-aaaa si no. */
export function shortWhen(iso: string, now: number = Date.now()): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ""
  return todayInChile(date) === todayInChile(new Date(now)) ? `hoy ${formatDateTime(date).slice(-5)}` : formatDate(date)
}

export function recentTitle(kind: "P" | "C", intervalValue: number | null, unit: MantUnit): string {
  return recordKindText(kind, intervalValue, unit)
}

export function buildRecent(catalog: MantCatalog | null | undefined, queue: readonly QueueItem[], userId: string, limit = 5): RecentRow[] {
  const rows = new Map<string, RecentRow>()
  for (const record of catalog?.myRecords ?? []) {
    rows.set(record.id, {
      id: record.id, kind: record.kind, equipmentCode: record.equipmentCode, equipmentPlate: record.equipmentPlate,
      title: recentTitle(record.kind, record.intervalValue, record.unit), when: record.receivedAt, folio: record.folio,
      state: "sent", voided: record.status === "anulado", rejection: null,
    })
  }
  for (const item of queue) {
    if (item.type !== "record" || item.authorUserId !== userId) continue
    const known = rows.get(item.id)
    // Si el servidor ya lo conoce y el teléfono también lo da por enviado, manda el dato del servidor.
    if (known && item.status === "sent") continue
    rows.set(item.id, {
      id: item.id, kind: item.summary.kind, equipmentCode: item.summary.equipmentCode, equipmentPlate: item.summary.equipmentPlate,
      title: recentTitle(item.summary.kind, item.summary.intervalValue, item.summary.unit), when: item.sentAt ?? item.createdAt,
      folio: item.folio, state: STATE_OF[item.status], voided: false, rejection: item.rejection?.message ?? null,
    })
  }
  return [...rows.values()].sort((a, b) => b.when.localeCompare(a.when)).slice(0, limit)
}

export function rejectedRecords(queue: readonly QueueItem[], userId: string): QueueRecordItem[] {
  return queue.filter((item): item is QueueRecordItem => item.type === "record" && item.authorUserId === userId && item.status === "rejected")
}

/** Observaciones que esperan respuesta: sin respuesta del servidor y sin respuesta guardada en el teléfono. */
export function openObservations(catalog: MantCatalog | null | undefined, queue: readonly QueueItem[]): CatalogObservation[] {
  const answered = new Set(queue.filter((item) => item.type === "reply" && item.status !== "rejected").map((item) => (item.type === "reply" ? item.payload.observationId : "")))
  return (catalog?.observations ?? []).filter((observation) => observation.response === null && !answered.has(observation.id))
}

export function observedRecordCount(observations: readonly CatalogObservation[]): number {
  return new Set(observations.map((observation) => observation.recordId)).size
}

/** «Toca la de 40.000 km · faltan 141 km» ya viene de `dueText`; aquí sólo la unidad en el resumen del taller. */
export function daysInWorkshopText(days: number | null): string {
  if (days === null) return "En taller"
  return days === 0 ? "Entró hoy a taller" : `En taller hace ${days} ${days === 1 ? "día" : "días"}`
}

export interface WorksiteSummary {
  /** «Faena Biodiversa» si es una; «6 faenas» si son varias. */
  text: string
  /** Con varias, el resumen no dice cuáles: la pantalla ofrece verlas. */
  many: boolean
}

/** Las faenas del mecánico en una línea corta. Una lista de seis nombres no cabe en el encabezado (ocupaba tres líneas en mayúscula). */
export function worksiteSummary(names: readonly string[]): WorksiteSummary | null {
  const [first, second] = names
  if (first === undefined) return null
  if (second === undefined) return { text: `Faena ${first}`, many: false }
  return { text: `${names.length} faenas`, many: true }
}
