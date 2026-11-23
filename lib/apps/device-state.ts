/**
 * lib/apps/device-state.ts — En qué estado está un teléfono según su último aviso.
 *
 * Puro: lo usan las lecturas de TI y la pantalla. Los umbrales salen del diseño
 * (docs/superpowers/specs/2026-11-22-apps-de-terreno-ti-design.md §5.4 y §6).
 */
const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

/** Pendientes más viejos que esto, en un teléfono que sí avisó, están atascados. */
export const STUCK_AFTER_MS = HOUR_MS
/** Un aviso más viejo que esto ya no prueba que el teléfono tenga señal. */
export const FRESH_REPORT_MS = DAY_MS
/** Sin pendientes, tantos días sin avisar es un teléfono que no se abre. */
export const SILENT_AFTER_MS = 7 * DAY_MS
/** «Teléfono activo»: avisó en esta ventana. */
export const ACTIVE_WINDOW_MS = 7 * DAY_MS
/** Teléfonos sin aviso hace más que esto no se muestran. */
export const FORGET_AFTER_MS = 90 * DAY_MS
/** «Dejó de enviar»: hubo envíos en los 30 días previos a los últimos 7, y ninguno en esos 7. */
export const STOPPED_RECENT_DAYS = 7
export const STOPPED_PRIOR_DAYS = 30
/** Un acceso (credencial o enlace) que vence dentro de estos días está por vencer. */
export const ACCESS_EXPIRING_DAYS = 7
/** Un acceso sin uso en estos días se marca. */
export const ACCESS_UNUSED_DAYS = 14

export type DeviceState = "error" | "stuck" | "silent" | "ok"

export interface DeviceSnapshot {
  lastSeenAt:      string
  pendingCount:    number
  failedCount:     number
  oldestPendingAt: string | null
}

export function deviceState(device: DeviceSnapshot, now: Date): DeviceState {
  if (device.failedCount > 0) return "error"
  const lastSeen = new Date(device.lastSeenAt).getTime()
  const sinceReport = now.getTime() - lastSeen
  if (device.pendingCount > 0) {
    if (sinceReport > FRESH_REPORT_MS) return "silent"
    const oldest = device.oldestPendingAt ? new Date(device.oldestPendingAt).getTime() : null
    if (oldest !== null && lastSeen - oldest > STUCK_AFTER_MS) return "stuck"
  }
  if (sinceReport > SILENT_AFTER_MS) return "silent"
  return "ok"
}

export function isVersionBehind(version: string, current: string): boolean {
  return version !== current
}

type BadgeVariant = "danger" | "warning" | "neutral" | "success"

export const DEVICE_STATE_META: Record<DeviceState, { label: string; variant: BadgeVariant; hint: string }> = {
  error:  { label: "Con error",             variant: "danger",  hint: "El servidor rechazó envíos de este teléfono: alguien tiene que revisarlos." },
  stuck:  { label: "Atascado",              variant: "warning", hint: "Tuvo señal para avisar, pero tiene envíos de hace más de una hora sin poder mandarlos." },
  silent: { label: "Sin señal / sin abrir", variant: "neutral", hint: "Hace rato que no avisa: está sin señal o no se ha abierto la app." },
  ok:     { label: "Al día",                variant: "success", hint: "Sin envíos atascados ni rechazados." },
}
