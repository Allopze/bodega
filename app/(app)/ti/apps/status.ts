import { ACTIVE_WINDOW_MS } from "@/lib/apps/device-state"
import { formatQty } from "@/lib/utils"
import type { FieldAppSummary, FieldDeviceRow } from "@/lib/services/field-apps/types"

type BadgeVariant = "success" | "danger" | "warning" | "neutral"

/** Filtros de la tabla de teléfonos, que llegan por `?estado=` desde la tira de cifras. */
export const DEVICE_FILTERS = {
  activos:      "Teléfonos activos",
  atencion:     "Atascados o con error",
  version:      "Con versión atrasada",
  "sin-senal":  "Sin señal / sin abrir",
} as const

export type DeviceFilter = keyof typeof DEVICE_FILTERS

export function parseDeviceFilter(raw: string | string[] | undefined): DeviceFilter | null {
  const value = Array.isArray(raw) ? raw[0] : raw
  return value && value in DEVICE_FILTERS ? (value as DeviceFilter) : null
}

/** Una sola definición para la cifra de la tira y para la fila que la explica. */
export function matchesDeviceFilter(row: FieldDeviceRow, filter: DeviceFilter | null, now: Date): boolean {
  switch (filter) {
    case "activos":    return now.getTime() - new Date(row.lastSeenAt).getTime() <= ACTIVE_WINDOW_MS
    case "atencion":   return row.state === "error" || row.state === "stuck"
    case "version":    return row.versionBehind
    case "sin-senal":  return row.state === "silent"
    default:           return true
  }
}

/**
 * Insignia de la tarjeta de una app. Precedencia: Desactivada > Sin avisos aún >
 * Requiere atención > Al día. «Sin avisos» no es «nadie la usa»: sólo dice que no
 * ha llegado ningún aviso desde que existe el aviso.
 */
export function appStatusBadge(summary: FieldAppSummary): { label: string; variant: BadgeVariant; hint: string } {
  if (!summary.enabled) {
    return { label: "Desactivada", variant: "neutral", hint: "Se activa en Administración › Módulos." }
  }
  if (summary.firstReportAt === null) {
    return { label: "Sin avisos aún", variant: "neutral", hint: "Todavía no llega ningún aviso: empiezan cuando alguien abre la app con la versión publicada." }
  }
  if (needsAttention(summary)) {
    return {
      label: "Requiere atención",
      variant: summary.byState.error > 0 ? "danger" : "warning",
      hint: "Hay teléfonos con error o atascados, con versión atrasada, o accesos por vencer o sin uso.",
    }
  }
  return { label: "Al día", variant: "success", hint: "Sin teléfonos con problemas ni accesos por revisar." }
}

export function needsAttention(summary: FieldAppSummary): boolean {
  return summary.byState.error > 0
    || summary.byState.stuck > 0
    || summary.versionBehind > 0
    || summary.accessesNeedingAttention > 0
}

/** «hace 12 min», «hace 3 h», «hace 4 días»: para avisos y envíos recientes. */
export function formatSince(iso: string | null, now: Date): string {
  if (!iso) return "—"
  const ms = now.getTime() - new Date(iso).getTime()
  if (!Number.isFinite(ms)) return "—"
  const minutes = Math.max(0, Math.round(ms / 60_000))
  if (minutes < 1) return "hace un momento"
  if (minutes < 60) return `hace ${minutes} min`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `hace ${hours} h`
  return `hace ${Math.round(hours / 24)} días`
}

/** Duración en minutos, legible: «40 min», «3,5 h», «2 días». */
export function formatMinutes(minutes: number | null): string {
  if (minutes === null || !Number.isFinite(minutes)) return "—"
  if (minutes < 60) return `${Math.round(minutes)} min`
  const hours = minutes / 60
  if (hours < 48) return `${formatQty(hours, undefined, { maximumFractionDigits: 1 })} h`
  return `${Math.round(hours / 24)} días`
}
