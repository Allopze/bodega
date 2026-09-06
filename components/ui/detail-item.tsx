import * as React from "react"
import { cn } from "@/lib/utils"

/**
 * Par etiqueta/valor para las superficies de detalle (workbenches, fichas,
 * drawers). Reemplaza las nueve copias locales (`DetailLine`, `AmountLine`,
 * `DataRow`, `Info`) que habían divergido en jerarquía tipográfica y en si el
 * dato ausente se decía con "—".
 *
 * Dos geometrías documentadas en el repo:
 * - `inline` (default): etiqueta a la izquierda, valor a la derecha — compras,
 *   recepción, equipos. El wrapper típico es un `<dl>` con `divide-y`.
 * - `stacked`: etiqueta arriba (`text-eyebrow`), valor abajo — bodega/guias,
 *   mantenciones. El wrapper típico es una grilla `space-y-*` / grid.
 *
 * `value: null | undefined` se dice con "—" (contrato `VALUE_MISSING`); para un
 * valor vacío con texto propio usa `value=""`.
 *
 * Componente de servidor: no usa hooks ni eventos.
 */
export type DetailItemLayout = "inline" | "stacked"

interface DetailItemProps {
  label: string
  value: React.ReactNode
  /** `inline` (default) o `stacked` (etiqueta arriba). */
  layout?: DetailItemLayout
  /** Valor numérico/monético: `font-mono tabular-nums`. */
  mono?: boolean
  /** Atenuar el valor (subtotales secundarios). */
  muted?: boolean
  className?: string
}

const VALUE_MISSING = "—"

export function DetailItem({ label, value, layout = "inline", mono = false, muted = false, className }: DetailItemProps) {
  const valueClasses = cn(
    mono && "font-mono tabular-nums",
    muted ? "text-[var(--color-text-subtle)]" : "text-[var(--color-text)]",
  )

  if (layout === "stacked") {
    return (
      <div className={className}>
        <dt className="text-eyebrow">{label}</dt>
        <dd className={cn("mt-0.5 font-medium", valueClasses)}>{value ?? VALUE_MISSING}</dd>
      </div>
    )
  }

  return (
    <div className={cn("flex items-center justify-between gap-3 py-2.5", className)}>
      <dt className="shrink-0 text-xs text-[var(--color-text-subtle)]">{label}</dt>
      <dd className={cn("text-right text-xs font-medium", valueClasses)}>{value ?? VALUE_MISSING}</dd>
    </div>
  )
}
