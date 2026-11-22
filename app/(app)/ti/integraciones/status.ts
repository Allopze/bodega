import type { IntegrationStatus } from "@/lib/integrations/health"

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

const ESTADOS: readonly IntegrationStatus[] = ["ok", "failing", "stale", "never"]

/** Filtro de la lista, que llega por `?estado=` desde la tira de cifras. */
export function parseEstadoFilter(raw: string | string[] | undefined): IntegrationStatus | null {
  const value = Array.isArray(raw) ? raw[0] : raw
  return ESTADOS.find((estado) => estado === value) ?? null
}
