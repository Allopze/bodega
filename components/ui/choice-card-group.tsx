"use client"

import * as React from "react"
import { Check } from "@phosphor-icons/react"
import { cn } from "@/lib/utils"
import { SelectableCard, SelectableCardDescription, SelectableCardTitle } from "./selectable-card"

/**
 * `tone` sólo se usa en la variante `compact`: dice qué color toma la opción
 * cuando está elegida (conforme / no conforme / neutra). Sin `tone` es neutra.
 */
export type ChoiceCardTone = "positive" | "negative" | "neutral"
export type ChoiceCardOption<T extends string | number> = { value: T; title: string; description?: string; tone?: ChoiceCardTone }

/** El grupo necesita un nombre accesible: o un texto (`label`) o el id de un rótulo que ya está en pantalla. */
type ChoiceCardGroupName =
  | { label: string; "aria-labelledby"?: undefined }
  | { label?: undefined; "aria-labelledby": string }

/**
 * Tinte, línea y tinta de la opción elegida en la variante compacta. El texto
 * usa SIEMPRE la variante `-ink` (los tokens base no llegan a 4.5:1 como texto)
 * y el anillo lleva el color de superficie del tono.
 */
const COMPACT_SELECTED_TONE: Record<ChoiceCardTone, string> = {
  positive: "border-[var(--color-success-line)] bg-[var(--color-success-tint)] text-[var(--color-success-ink)] ring-2 ring-[var(--color-success)]",
  negative: "border-[var(--color-danger-line)] bg-[var(--color-danger-tint)] text-[var(--color-danger-ink)] ring-2 ring-[var(--color-danger)]",
  neutral: "border-[var(--color-border-strong)] bg-[var(--color-surface-3)] text-[var(--color-text)] ring-2 ring-[var(--color-text-muted)]",
}

/**
 * Grupo de radio hecho de `SelectableCard`. `SelectableCard` deja en manos de
 * quien lo usa el patrón de radio del WAI-ARIA (una sola tarjeta en el orden de
 * tabulación, flechas, Home y End para moverse y elegir); este componente lo
 * implementa una vez. Lo usan P×C, «¿Está controlado?» y «¿Rutinaria?» de la MIPER.
 *
 * El nombre de cada tarjeta es su título y el texto largo va como descripción
 * (`aria-describedby`). Sin eso, el nombre de cada tarjeta de P y C era el
 * criterio completo del RE-04.
 *
 * `variant="compact"` es la fila de botones de una sola línea (Cumple / No
 * cumple / No aplica): el elegido se distingue por tono, anillo e ícono de
 * check, de modo que no depende sólo del color. La variante por defecto
 * (`card`) no cambia.
 */
export function ChoiceCardGroup<T extends string | number>({
  label, "aria-labelledby": labelledBy, options, value, onChange, disabled = false, className, variant = "card",
}: ChoiceCardGroupName & {
  options: ReadonlyArray<ChoiceCardOption<T>>
  value: T | null
  onChange: (value: T) => void
  disabled?: boolean
  className?: string
  variant?: "card" | "compact"
}) {
  const refs = React.useRef<Array<HTMLButtonElement | null>>([])
  const idBase = React.useId()
  const selectedIndex = options.findIndex((option) => option.value === value)
  const tabbable = selectedIndex === -1 ? 0 : selectedIndex
  const compact = variant === "compact"

  /** Flechas: la vecina, dando la vuelta. Home/End: la primera y la última. */
  function targetIndex(key: string, index: number): number | null {
    switch (key) {
      case "ArrowRight": case "ArrowDown": return (index + 1) % options.length
      case "ArrowLeft": case "ArrowUp": return (index - 1 + options.length) % options.length
      case "Home": return 0
      case "End": return options.length - 1
      default: return null
    }
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    const next = targetIndex(event.key, index)
    if (next === null || disabled) return
    event.preventDefault()
    refs.current[next]?.focus()
    // La ya elegida no se vuelve a avisar: cada aviso es un guardado.
    if (options[next]!.value !== value) onChange(options[next]!.value)
  }

  return (
    <div
      role="radiogroup"
      aria-label={label}
      aria-labelledby={labelledBy}
      aria-disabled={disabled || undefined}
      className={cn(
        compact ? "grid grid-cols-[repeat(auto-fit,minmax(5rem,1fr))] gap-1.5" : "grid gap-2 sm:grid-cols-3",
        className,
      )}
    >
      {options.map((option, index) => {
        const titleId = `${idBase}-${index}-titulo`
        const descriptionId = option.description ? `${idBase}-${index}-descripcion` : undefined
        const selected = option.value === value

        if (compact) {
          return (
            <button
              key={String(option.value)}
              ref={(node) => { refs.current[index] = node }}
              type="button"
              role="radio"
              aria-checked={selected}
              tabIndex={index === tabbable ? 0 : -1}
              disabled={disabled}
              aria-labelledby={titleId}
              aria-describedby={descriptionId}
              onClick={() => { if (!selected) onChange(option.value) }}
              onKeyDown={(event) => onKeyDown(event, index)}
              className={cn(
                "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-[var(--radius-md)] border px-2 text-sm font-medium transition-colors sm:min-h-9",
                "disabled:cursor-not-allowed disabled:opacity-50",
                selected
                  ? COMPACT_SELECTED_TONE[option.tone ?? "neutral"]
                  : "border-[var(--color-border-control)] bg-[var(--color-surface)] text-[var(--color-text)] enabled:hover:border-[var(--color-border-control-hover)] enabled:hover:bg-[var(--color-surface-2)]",
              )}
            >
              {selected && <Check aria-hidden="true" weight="bold" className="size-4 shrink-0" />}
              <span id={titleId}>{option.title}</span>
              {option.description && <span id={descriptionId} className="sr-only">{option.description}</span>}
            </button>
          )
        }

        return (
          <SelectableCard
            key={String(option.value)}
            ref={(node) => { refs.current[index] = node }}
            selected={selected}
            tabIndex={index === tabbable ? 0 : -1}
            disabled={disabled}
            aria-labelledby={titleId}
            aria-describedby={descriptionId}
            onClick={() => { if (!selected) onChange(option.value) }}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            <SelectableCardTitle id={titleId} className="whitespace-normal">{option.title}</SelectableCardTitle>
            {option.description && <SelectableCardDescription id={descriptionId} className="mt-1">{option.description}</SelectableCardDescription>}
          </SelectableCard>
        )
      })}
    </div>
  )
}
