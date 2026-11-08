import type { SettingSource } from "@/lib/services/encrypted-settings"
import { formatDateTime } from "@/lib/utils"

/**
 * Lo que «Integraciones» dice de la última corrida de cada actualización
 * automática, en lenguaje de usuario. Puro: la página le pasa la fila de
 * `getCronJobHealth` y las pruebas lo ejercen sin base de datos.
 */

export const INTEGRATION_JOBS = {
  copec: "fuel-copec-sync",
  visionlink: "fuel-visionlink-sync",
} as const

export type IntegrationKey = keyof typeof INTEGRATION_JOBS

export interface IntegrationRun {
  startedAt: string | null
  outcome: string | null
}

type OutcomeVariant = "success" | "danger" | "info" | "neutral"

export function cronOutcomeBadge(outcome: string | null | undefined): { label: string; variant: OutcomeVariant } {
  switch (outcome) {
    case "success": return { label: "Al día", variant: "success" }
    case "failed": return { label: "Falló", variant: "danger" }
    case "running": return { label: "En curso", variant: "info" }
    case "skipped": return { label: "Sin cambios", variant: "neutral" }
    default: return { label: "Sin corridas", variant: "neutral" }
  }
}

/** «28-10-2026 05:31 · terminó bien», o que no hubo corridas en el último mes. */
export function lastRunText(run: IntegrationRun | null | undefined): string {
  if (!run?.startedAt) return "No hay corridas en los últimos 30 días."
  const when = formatDateTime(run.startedAt)
  switch (run.outcome) {
    case "success": return `Última corrida: ${when} · terminó bien.`
    case "failed": return `Última corrida: ${when} · falló. El detalle está en Fuentes de datos.`
    case "running": return `Corriendo desde ${when}.`
    case "skipped": return `Última corrida: ${when} · se saltó porque había otra en curso.`
    default: return `Última corrida: ${when}.`
  }
}

/**
 * De dónde salen las credenciales de una integración, en palabras: «guardadas
 * en la plataforma», «del servidor» o las dos (usuario del servidor y clave
 * guardada, por ejemplo). `null` si ninguna está configurada.
 */
export function credentialsOriginText(sources: readonly SettingSource[]): string | null {
  const stored = sources.includes("system_settings")
  const server = sources.includes("environment")
  if (stored && server) return "guardadas en la plataforma y del servidor"
  if (stored) return "guardadas en la plataforma"
  if (server) return "del servidor"
  return null
}
