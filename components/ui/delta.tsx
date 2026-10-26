import { ArrowDown, ArrowUp, Equals } from "@phosphor-icons/react/dist/ssr"
import { cn } from "@/lib/utils"

/**
 * Qué significa que la cifra suba. `up-bad` para gasto, atraso o backlog:
 * pintar verde un alza de costo la presentaba como éxito. `neutral` para
 * volúmenes que no son ni buenos ni malos por sí solos.
 */
export type DeltaPolarity = "up-good" | "up-bad" | "neutral"
export type DeltaTone = "positive" | "negative" | "neutral"

export function deltaTone(value: number, polarity: DeltaPolarity): DeltaTone {
  // 0 no es buena noticia ni mala: sin color (I-14).
  if (value === 0 || polarity === "neutral") return "neutral"
  return (value > 0) === (polarity === "up-good") ? "positive" : "negative"
}

const TONE_CLASSES: Record<DeltaTone, string> = {
  positive: "bg-[var(--color-success-tint)] text-[var(--color-success-ink)]",
  negative: "bg-[var(--color-danger-tint)] text-[var(--color-danger-ink)]",
  neutral: "bg-[var(--color-surface-2)] text-[var(--color-text-muted)]",
}

function formatDeltaValue(value: number, format: "percent" | "number" | "pp") {
  const abs = Math.abs(value)
  const text = Number.isInteger(abs) ? abs.toLocaleString("es-CL") : abs.toLocaleString("es-CL", { maximumFractionDigits: 1 })
  // Sin espacio, como la píldora histórica de `KpiCard` ("12%").
  if (format === "percent") return `${text}%`
  if (format === "pp") return `${text} pp`
  return text
}

/**
 * Variación de una cifra contra su período de comparación: flecha, valor
 * absoluto y rótulo ("↑ 3 vs. sep").
 *
 * Es la única forma de mostrar una variación en el tablero. Antes convivían la
 * píldora de `KpiCard` y textos sueltos como "-5 vs. mes anterior", con colores
 * y signos distintos para la misma idea.
 *
 * Server-safe (sin hooks). Con `value === null` no dibuja nada: sin período de
 * comparación no hay variación que inventar.
 */
export function Delta({
  value,
  format = "number",
  polarity = "up-good",
  comparisonLabel,
  size = "sm",
  className,
}: {
  value: number | null
  format?: "percent" | "number" | "pp"
  polarity?: DeltaPolarity
  /** "vs. sep", "vs. T3"… Se muestra atenuado junto a la cifra. */
  comparisonLabel?: string
  size?: "sm" | "md"
  className?: string
}) {
  if (value === null || !Number.isFinite(value)) return null
  const tone = deltaTone(value, polarity)
  const Icon = value > 0 ? ArrowUp : value < 0 ? ArrowDown : Equals
  const formatted = formatDeltaValue(value, format)
  const verb = value > 0 ? "Sube" : value < 0 ? "Baja" : "Sin variación"
  const spoken = value === 0 ? verb : `${verb} ${formatted}`

  return (
    <span data-delta={tone} className={cn("inline-flex items-center gap-1.5 whitespace-nowrap", className)}>
      <span
        aria-hidden
        className={cn(
          "inline-flex items-center gap-0.5 rounded-full font-semibold tabular-nums",
          size === "md" ? "px-2 py-0.5 text-xs" : "px-1.5 py-0.5 text-[11px]",
          TONE_CLASSES[tone],
        )}
      >
        <Icon size={size === "md" ? 12 : 11} weight="bold" />
        {formatted}
      </span>
      {comparisonLabel && (
        <span aria-hidden className="text-xs text-[var(--color-text-muted)]">{comparisonLabel}</span>
      )}
      <span className="sr-only">{comparisonLabel ? `${spoken} ${comparisonLabel}` : spoken}</span>
    </span>
  )
}
