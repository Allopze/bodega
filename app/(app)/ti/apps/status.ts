import type { IntegrationStatus } from "@/lib/apps/metrics"

type BadgeVariant = "success" | "danger" | "warning" | "neutral"

/** Texto y tono de cada estado de integración, en lenguaje de usuario. */
export const INTEGRATION_STATUS_META: Record<IntegrationStatus, { label: string; variant: BadgeVariant; hint: string }> = {
  ok:      { label: "Al día",       variant: "success", hint: "La última corrida terminó bien y dentro de su plazo." },
  failing: { label: "Con falla",    variant: "danger",  hint: "La última corrida falló." },
  stale:   { label: "Detenida",     variant: "warning", hint: "No ha corrido bien dentro de su plazo: el planificador puede estar caído." },
  never:   { label: "Sin corridas", variant: "neutral", hint: "No hay corridas en los últimos 30 días; en este ambiente puede no estar programada." },
}

export const RUN_OUTCOME_LABEL: Record<string, string> = {
  success: "Correcta",
  skipped: "Omitida (otra corrida en curso)",
  failed:  "Falló",
  running: "En curso",
}

/** Filtros de la lista, que llegan por `?filtro=` desde la tira de cifras. */
export const APP_FILTERS = {
  integraciones: "Con integraciones con problemas",
  "sin-uso":     "Sin uso en 30 días",
  desactivadas:  "Desactivadas",
} as const

export type AppFilter = keyof typeof APP_FILTERS

export function parseAppFilter(raw: string | string[] | undefined): AppFilter | null {
  const value = Array.isArray(raw) ? raw[0] : raw
  return value && value in APP_FILTERS ? (value as AppFilter) : null
}
