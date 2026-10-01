"use client"

import { CONSEQUENCE_LEVELS, PROBABILITY_LEVELS, isScaleValue, type MiperScaleValue } from "@/lib/prevention/miper/methodology"
import { cn } from "@/lib/utils"

/**
 * Probabilidad o consecuencia RE-04. `<select>` nativo a propósito: en una
 * grilla de cientos de filas un popover por celda pesa, y el nativo ya da
 * teclado y lector de pantalla. El criterio del nivel va en `title` (grilla) o
 * visible debajo (`showDescription`, en la ficha de la fila).
 */
export function PcSelect({ kind, value, onChange, id, ariaLabel, disabled, showDescription, className, invalidMessage }: {
  kind: "probability" | "consequence"
  value: number | null
  onChange: (value: MiperScaleValue | null) => void
  id?: string
  ariaLabel: string
  disabled?: boolean
  showDescription?: boolean
  className?: string
  /** Motivo por el que falta el valor; marca la celda como incompleta. */
  invalidMessage?: string
}) {
  const levels = kind === "probability" ? PROBABILITY_LEVELS : CONSEQUENCE_LEVELS
  const selected = levels.find((level) => level.value === value)
  return (
    <div className="min-w-0">
      <select
        id={id}
        aria-label={ariaLabel}
        title={invalidMessage ?? selected?.description}
        aria-invalid={invalidMessage ? true : undefined}
        disabled={disabled}
        value={value ?? ""}
        onChange={(event) => {
          const next = Number(event.target.value)
          onChange(isScaleValue(next) ? next : null)
        }}
        className={cn("h-8 w-full rounded-md border border-[var(--color-border)] bg-white px-1.5 text-sm disabled:opacity-60 aria-[invalid=true]:border-[var(--color-danger)] aria-[invalid=true]:bg-[var(--color-danger-tint)]", className)}
      >
        <option value="">—</option>
        {levels.map((level) => <option key={level.value} value={level.value} title={level.description}>{`${level.label.split(" (")[0]} (${level.value})`}</option>)}
      </select>
      {showDescription && selected ? <p className="mt-1 text-xs text-[var(--color-text-subtle)]">{selected.description}</p> : null}
    </div>
  )
}
