"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { SelectableCard, SelectableCardDescription, SelectableCardTitle } from "./selectable-card"

export type ChoiceCardOption<T extends string | number> = { value: T; title: string; description?: string }

/**
 * Grupo de radio hecho de `SelectableCard`. `SelectableCard` deja en manos de
 * quien lo usa el patrón de radio del WAI-ARIA (una sola tarjeta en el orden de
 * tabulación, flechas, Home y End para moverse y elegir); este componente lo
 * implementa una vez. Lo usan P×C, «¿Está controlado?» y «¿Rutinaria?» de la MIPER.
 *
 * El nombre de cada tarjeta es su título y el texto largo va como descripción
 * (`aria-describedby`). Sin eso, el nombre de cada tarjeta de P y C era el
 * criterio completo del RE-04.
 */
export function ChoiceCardGroup<T extends string | number>({ label, options, value, onChange, disabled = false, className }: {
  label: string
  options: ReadonlyArray<ChoiceCardOption<T>>
  value: T | null
  onChange: (value: T) => void
  disabled?: boolean
  className?: string
}) {
  const refs = React.useRef<Array<HTMLButtonElement | null>>([])
  const idBase = React.useId()
  const selectedIndex = options.findIndex((option) => option.value === value)
  const tabbable = selectedIndex === -1 ? 0 : selectedIndex

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
    <div role="radiogroup" aria-label={label} aria-disabled={disabled || undefined} className={cn("grid gap-2 sm:grid-cols-3", className)}>
      {options.map((option, index) => {
        const titleId = `${idBase}-${index}-titulo`
        const descriptionId = option.description ? `${idBase}-${index}-descripcion` : undefined
        return (
          <SelectableCard
            key={String(option.value)}
            ref={(node) => { refs.current[index] = node }}
            selected={option.value === value}
            tabIndex={index === tabbable ? 0 : -1}
            disabled={disabled}
            aria-labelledby={titleId}
            aria-describedby={descriptionId}
            onClick={() => { if (option.value !== value) onChange(option.value) }}
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
