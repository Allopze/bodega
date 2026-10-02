"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { SelectableCard, SelectableCardDescription, SelectableCardTitle } from "./selectable-card"

export type ChoiceCardOption<T extends string | number> = { value: T; title: string; description?: string }

/**
 * Grupo de radio hecho de `SelectableCard`. `SelectableCard` deja en manos de
 * quien lo usa el patrón de radio del WAI-ARIA (una sola tarjeta en el orden de
 * tabulación, flechas para moverse y elegir); este componente lo implementa una
 * vez. Lo usan P×C, «¿Está controlado?» y «¿Rutinaria?» de la MIPER.
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
  const selectedIndex = options.findIndex((option) => option.value === value)
  const tabbable = selectedIndex === -1 ? 0 : selectedIndex

  function onKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    const delta = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0
    if (delta === 0 || disabled) return
    event.preventDefault()
    const next = (index + delta + options.length) % options.length
    refs.current[next]?.focus()
    onChange(options[next]!.value)
  }

  return (
    <div role="radiogroup" aria-label={label} aria-disabled={disabled || undefined} className={cn("grid gap-2 sm:grid-cols-3", className)}>
      {options.map((option, index) => (
        <SelectableCard
          key={String(option.value)}
          ref={(node) => { refs.current[index] = node }}
          selected={option.value === value}
          tabIndex={index === tabbable ? 0 : -1}
          disabled={disabled}
          onClick={() => { if (option.value !== value) onChange(option.value) }}
          onKeyDown={(event) => onKeyDown(event, index)}
        >
          <SelectableCardTitle className="whitespace-normal">{option.title}</SelectableCardTitle>
          {option.description && <SelectableCardDescription className="mt-1">{option.description}</SelectableCardDescription>}
        </SelectableCard>
      ))}
    </div>
  )
}
