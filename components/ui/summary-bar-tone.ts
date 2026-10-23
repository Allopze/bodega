import type { SummaryStat } from "./summary-bar"

/**
 * Qué tono pinta de verdad una cifra de `SummaryBar`, o `null` si ninguno.
 *
 * Por defecto un tono es una alerta de conteo: sólo se enciende con un valor
 * numérico > 0 («3 vencidas»), y un cero queda atenuado. Una cifra donde lo malo
 * es *poco* —disponibilidad 0 %— necesita el tono justo cuando vale 0, y ahí el
 * llamador lo pide con `toneWhenZero`. `isText` (valor-frase) nunca se tiñe.
 */
export function activeSummaryTone(stat: SummaryStat, { isText = false }: { isText?: boolean } = {}): "signal" | "danger" | null {
  if (!stat.tone || isText) return null
  const numeric = typeof stat.value === "number" ? stat.value : Number.parseFloat(String(stat.value)) || 0
  return stat.toneWhenZero || numeric > 0 ? stat.tone : null
}

/** Siempre la variante `-ink`: los tokens base de signal/danger no alcanzan AA como texto (AGENTS, regla 8). */
export const SUMMARY_TONE_TEXT = {
  signal: "text-[var(--color-signal-ink)]",
  danger: "text-[var(--color-danger-ink)]",
} as const
