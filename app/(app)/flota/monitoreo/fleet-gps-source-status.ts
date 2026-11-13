import type { FleetGpsProviderRun } from "@/lib/services/fleet-gps"
import { providerLabel } from "./fleet-gps-labels"

/**
 * Estado de las fuentes GPS (OnWay y Wialon) para el bloque «Estado de las
 * fuentes» de Monitoreo. Antes eran hasta ocho avisos apilados —atraso, falla,
 * parcial, sin vincular, por proveedor—, uno de ellos con un código de error
 * (`ONWAY_SNAPSHOT_EMPTY`) y todos con cursivas. Un proveedor es una fila, con
 * su veredicto, lo que pasó en lenguaje de usuario y lo que se puede hacer.
 *
 * Datos puros: la pantalla los pinta. Nada de esto toca autorización: lo que
 * sólo ve quien administra el GPS (corridas, sin vincular) llega ya en `null`
 * para el resto.
 */

export type SourceVerdict = "ok" | "stale" | "failed" | "partial" | "unlinked" | "nodata"

export interface SourceAction {
  label: string
  /** `settings` abre la pestaña «Configuración»; `link` navega. */
  kind: "settings" | "link"
  href?: string
}

export interface SourceStatusRow {
  provider: "onway" | "wialon"
  name: string
  verdict: SourceVerdict
  /** Última captura real de la fuente (la hora la pinta la pantalla). */
  latestAt: string | null
  /** Veredicto corto de la insignia. */
  badge: string
  tone: "success" | "warning" | "danger" | "neutral"
  /** Frases en lenguaje de usuario, de la más grave a la menos. */
  messages: string[]
  actions: SourceAction[]
  /** Código técnico de la última falla, sólo para quien administra: va en un `<details>`. */
  technicalDetail: string | null
}

/** Lo que cada código de error significa para quien administra el GPS. */
const FAILURE_MESSAGE: Record<string, string> = {
  ONWAY_CREDENTIALS_REQUIRED: "Faltan las credenciales de OnWay.",
  ONWAY_CREDENTIALS_INVALID: "Las credenciales configuradas no son válidas.",
  ONWAY_AUTH_REJECTED: "OnWay rechazó el usuario o la contraseña.",
  ONWAY_INTERACTIVE_AUTH_REQUIRED: "OnWay pide una verificación en su portal: ingresa una vez y vuelve a intentar más tarde.",
  ONWAY_PORTAL_TIMEOUT: "OnWay no respondió a tiempo.",
  ONWAY_RESPONSE_INVALID: "OnWay respondió con un formato que la plataforma no reconoce.",
  ONWAY_SNAPSHOT_EMPTY: "OnWay aceptó la cuenta, pero no devolvió ningún equipo. Revisa que la cuenta configurada tenga la flota asignada en su portal.",
  ONWAY_SYNC_FAILED: "No se pudo actualizar el monitoreo.",
  WIALON_AUTH_FAILED: "Wialon rechazó el token.",
  WIALON_SESSION_EXPIRED: "La sesión con Wialon venció.",
  WIALON_ACCESS_DENIED: "El token de Wialon no tiene acceso a las unidades.",
  WIALON_RATE_LIMITED: "Wialon pidió esperar antes de volver a consultar.",
  WIALON_HTTP_ERROR: "Wialon respondió con un error.",
  WIALON_BAD_RESPONSE: "Wialon respondió con un formato que la plataforma no reconoce.",
  WIALON_TIMEOUT: "Wialon no respondió a tiempo.",
  WIALON_API_ERROR: "Wialon devolvió un error.",
  WIALON_INVALID_BASE_URL: "La dirección de Wialon configurada no es válida.",
}

export function failureMessage(code: string | null): string {
  return (code && FAILURE_MESSAGE[code]) || "No se pudo completar la última actualización."
}

/** Hace cuánto: minutos, horas o días; pasados el día se deja de contar en minutos. */
export function staleSinceLabel(observedAt: string, now: number = Date.now()): string {
  const diffMs = now - Date.parse(observedAt)
  if (!Number.isFinite(diffMs) || diffMs <= 0) return "un momento"
  const minutes = Math.round(diffMs / 60_000)
  if (minutes < 60) return minutes === 1 ? "1 minuto" : `${minutes} minutos`
  const hours = Math.round(diffMs / 3_600_000)
  if (hours < 24) return hours === 1 ? "1 hora" : `${hours} horas`
  const days = Math.round(diffMs / 86_400_000)
  return days === 1 ? "1 día" : `${days} días`
}

const plural = (n: number, singular: string, pluralForm: string) => (n === 1 ? singular : pluralForm)

export interface SourceStatusInput {
  provider: "onway" | "wialon"
  /** Última captura real de la fuente; `null` si nunca llegó una. */
  latestAt: string | null
  stale: boolean
  /** Sólo para quien administra el GPS. */
  run: FleetGpsProviderRun | null
  unmatched: number | null
  canManage: boolean
}

/**
 * Una fila por fuente, o ninguna si la fuente nunca existió (ni captura, ni
 * corrida, ni dispositivos por vincular): un proveedor que nadie configuró no
 * necesita una fila que diga que no hay nada.
 */
export function buildSourceStatusRow(input: SourceStatusInput, now: number = Date.now()): SourceStatusRow | null {
  const { provider, latestAt, stale, run, unmatched, canManage } = input
  const name = providerLabel(provider)
  const failed = canManage && run?.status === "failed"
  const unmatchedCount = canManage ? (unmatched ?? 0) : 0
  // En OnWay, un parcial con dispositivos sin vincular se explica por esos dispositivos: avisarlo dos veces era ruido.
  const partial = canManage && run?.status === "partial" && !(provider === "onway" && unmatchedCount > 0)
  if (!latestAt && !run && unmatchedCount === 0) return null

  const messages: string[] = []
  const actions: SourceAction[] = []

  if (failed) {
    messages.push(`La última actualización falló. ${failureMessage(run?.errorCode ?? null)}`)
    actions.push({ label: provider === "onway" ? "Revisar credenciales" : "Revisar token", kind: "settings" })
  }
  if (stale && latestAt) {
    messages.push(`Sin posiciones nuevas desde hace ${staleSinceLabel(latestAt, now)}: lo que se ve es el último reporte recibido, no una lectura en tiempo real.`)
    if (canManage && !failed) actions.push({ label: "Ver configuración", kind: "settings" })
  }
  if (partial) {
    messages.push(provider === "onway"
      ? "La última actualización llegó incompleta: pueden faltar telemetría, alertas o historial."
      : "Llegaron más unidades de las que se procesan en una corrida: revisa el límite de unidades.")
    if (!actions.some((action) => action.kind === "settings")) actions.push({ label: "Ver configuración", kind: "settings" })
  }
  if (unmatchedCount > 0) {
    // Los dos proveedores se resuelven igual: vínculo manual o exclusión con motivo.
    if (provider === "onway") {
      messages.push(`${unmatchedCount} ${plural(unmatchedCount, "dispositivo", "dispositivos")} sin una patente única en el catálogo de Flota: ${plural(unmatchedCount, "vincúlalo a mano o exclúyelo si no es", "vincúlalos a mano o exclúyelos si no son")} de la flota.`)
      actions.push({ label: "Vincular dispositivos", kind: "settings" })
    } else {
      messages.push(`${unmatchedCount} ${plural(unmatchedCount, "unidad", "unidades")} sin vehículo: la posición se conserva, pero no entra al panel hasta vincularla o excluirla.`)
      actions.push({ label: "Vincular unidades", kind: "settings" })
    }
  }

  const verdict: SourceVerdict = failed ? "failed"
    : stale ? "stale"
      : partial ? "partial"
        : unmatchedCount > 0 ? "unlinked"
          : latestAt ? "ok" : "nodata"
  const { badge, tone } = {
    failed: { badge: "Falló", tone: "danger" as const },
    stale: { badge: "Atrasada", tone: "warning" as const },
    partial: { badge: "Incompleta", tone: "warning" as const },
    unlinked: { badge: "Con pendientes", tone: "warning" as const },
    ok: { badge: "Al día", tone: "success" as const },
    nodata: { badge: "Sin datos", tone: "neutral" as const },
  }[verdict]

  return {
    provider,
    name,
    latestAt,
    verdict,
    badge,
    tone,
    messages,
    actions,
    technicalDetail: failed && run?.errorCode ? run.errorCode : null,
  }
}
